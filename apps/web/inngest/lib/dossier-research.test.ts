// @vitest-environment node

import {
  createCase,
  createDb,
  createProjectFromCase,
  linkDossierDocuments,
  requireTestDatabase,
  upsertResearchDocument,
  ensureFirstChannel,
} from '@boom-busters/db'
import type { CorpusDocument, LLMTaskRequest } from '@boom-busters/providers'
import {
  BudgetExceededError,
  DOSSIER_DOCUMENT_TOKENS,
  FIRST_CHANNEL_IN_USE,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnswerComplete } from '@/lib/answer'
import {
  gateSubject,
  gateSummary,
  loadCorpus,
  replayedCase,
  researchDossier as research,
  splitRange,
  unfetchedClaims,
} from './dossier-research'
import { inlineSteps, type Steps } from './steps'

/**
 * The four research passes over a small corpus, then the grounding, with a
 * fake call that answers each pass, and each part of a split pass, from
 * fixture JSON. No provider, and no
 * database but for the corpus loader's own suite: the passes write nothing;
 * the save steps do, and the runner's and reviser's tests cover them.
 */

/** The research as the stage runs it, reading the first channel's bible in each step. */
const researchDossier = (
  steps: Steps,
  given: Parameters<typeof research>[1],
  deps: Partial<Parameters<typeof research>[2]> = {},
) => research(steps, given, { bible: async () => FIRST_CHANNEL_IN_USE, ...deps })

const replaying = (stored: Record<string, unknown>): Steps => ({
  run: async <T>(id: string) => stored[id] as T,
})

const CASE = {
  title: 'Wirecard: the billions that were never there',
  category: 'con',
  angle: null,
  demandNotes: null,
  subject: 'Wirecard',
  people: ['Markus Braun'],
}
const ENTITY = {
  qid: 'Q1',
  titles: ['Wirecard'],
  cik: null,
  ticker: null,
  website: null,
  people: [],
  unresolved: false,
  subject: null,
  sourceUrls: [],
}

const DOCUMENTS: CorpusDocument[] = [
  {
    id: 'doc-ft',
    url: 'https://www.ft.com/content/wirecard',
    kind: 'reporting',
    title: 'Wirecard files for insolvency',
    publishedAt: '2020-06-25',
    text:
      'Wirecard filed for insolvency in Munich on 25 June 2020, owing creditors almost four billion euros.\n\n' +
      'Markus Braun told investors the growth story would outlast every short seller.',
    archivedUrl: null,
    httpStatus: 200,
  },
  {
    id: 'doc-reuters',
    url: 'https://www.reuters.com/wirecard',
    kind: 'reporting',
    title: 'Wirecard applies for insolvency',
    publishedAt: '2020-06-25',
    text: 'The payments company applied for insolvency proceedings at the Munich district court on Thursday.',
    archivedUrl: null,
    httpStatus: 200,
  },
]

const input = {
  projectId: '01J0000000000000000000000P',
  caseContext: CASE,
  round: 0,
  entity: ENTITY,
  documents: DOCUMENTS,
  corpus: { read: 2, unread: 1, failed: 1 },
}

const BRIEF = {
  summary:
    'Wirecard was a German payments company. It collapsed in June 2020 after EY refused to sign.',
  turningPoint: 'EY refused to sign the 2019 accounts.',
  cast: [
    {
      name: 'Markus Braun',
      role: 'Chief executive',
      wanted: 'To make the growth story outlast the short sellers.',
      scene: { doc: 1, quote: 'told investors the growth story would outlast every short seller' },
    },
  ],
  toldAlready: [],
  openQuestions: ['Where did the 1.9 billion euros go?', 'Who signed off on the escrow accounts?'],
}
const SCENES = {
  scenes: [
    {
      when: 'June 2020',
      who: 'Wirecard',
      what: 'Filed for insolvency in Munich.',
      why: 'The end of the company the story follows.',
      doc: 1,
      quote: 'Wirecard filed for insolvency in Munich on 25 June 2020',
    },
  ],
}
const CLAIM = {
  text: 'Wirecard filed for insolvency in June 2020.',
  supports: [
    { doc: 1, quote: 'Wirecard filed for insolvency in Munich on 25 June 2020' },
    { doc: 2, quote: 'applied for insolvency proceedings at the Munich district court' },
  ],
  legal: null,
  series: null,
}
const CLAIM_2 = {
  text: 'The insolvency application went to the Munich district court.',
  supports: [{ doc: 2, quote: 'applied for insolvency proceedings at the Munich district court' }],
  legal: null,
  series: null,
}
/** The answers pass runs in two parts here, one question each. */
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
}
const ANSWERS_2 = {
  answers: [{ index: 2, question: 'Who signed off on the escrow accounts?', answer: null }],
  claims: [],
}

type Pass = 'brief' | 'scenes' | 'claims' | 'answers'
/** A pass, or one part of a split pass: `claims-2` is the claims pass's second part. */
type Key = Pass | `${'claims' | 'answers'}-${number}`

const OPENINGS: [string, Pass][] = [
  ['Read the documents and write the case brief', 'brief'],
  ['Now find the scenes', 'scenes'],
  ['Now extract the facts', 'claims'],
  ['Your brief raised open questions', 'answers'],
]

/** Which pass a request is, read from its instructions (a retry adds its reason after them). */
function passOf(request: LLMTaskRequest): Pass {
  for (const message of [...request.messages].reverse()) {
    const found = OPENINGS.find(([opening]) => message.content.startsWith(opening))
    if (found) return found[1]
  }
  throw new Error('Unknown pass')
}

/** Which part of a split pass a request is, from its instructions; 1 for an unsplit pass. */
function partOf(request: LLMTaskRequest): number {
  for (const message of [...request.messages].reverse()) {
    const found = /This is part (\d+) of/.exec(message.content)
    if (found) return Number(found[1])
  }
  return 1
}

// Both claims parts answer CLAIM by default, so every run also merges a repeat.
const FIXTURES: Partial<Record<Key, unknown>> = {
  brief: BRIEF,
  scenes: SCENES,
  claims: { claims: [CLAIM] },
  answers: ANSWERS,
  'answers-2': ANSWERS_2,
}

/** A part's own fixture first, then its pass's, each overridden by `over`. */
function fixtureFor(request: LLMTaskRequest, over: Partial<Record<Key, unknown>> = {}): string {
  const pass = passOf(request)
  const part: Key = `${pass}-${partOf(request)}` as Key
  return JSON.stringify(over[part] ?? over[pass] ?? FIXTURES[part] ?? FIXTURES[pass])
}

const answering =
  (over: Partial<Record<Key, unknown>> = {}): AnswerComplete =>
  async (request) => ({ text: fixtureFor(request, over) })

describe('researchDossier over the corpus', () => {
  it('runs the passes part by part, passes the note to every call, and grounds the result', async () => {
    const seen: string[] = []
    const complete: AnswerComplete = async (request) => {
      seen.push(request.messages.at(-1)!.content)
      return { text: fixtureFor(request) }
    }

    const result = await researchDossier(
      inlineSteps,
      { ...input, note: 'Less about the auditors' },
      { complete, mocked: false },
    )

    // Brief, scenes, two claims parts and two answers parts.
    expect(seen).toHaveLength(6)
    expect(
      seen.every((m) => m.includes('The human asks for changes: Less about the auditors')),
    ).toBe(true)
    expect(result.claims.some((c) => c.confidence === 'sourced')).toBe(true)
    expect(result.claims[0]!.supports.map((s) => s.documentId)).toEqual(['doc-ft', 'doc-reuters'])
    expect(result.research.entity).toEqual(ENTITY)
    expect(result.research.corpus).toEqual({ read: 2, unread: 1, failed: 1 })
    expect(result.research.scenes[0]!.ref).toMatchObject({ documentId: 'doc-ft', found: true })
    expect(result.budgetGate).toBeUndefined()
  })

  it("opens every pass on the case's subject and people, then its working title", async () => {
    const openings: string[] = []
    const complete: AnswerComplete = async (request) => {
      openings.push(request.messages[0]!.content)
      return { text: fixtureFor(request) }
    }

    await researchDossier(inlineSteps, input, { complete, mocked: false })

    expect(openings).toHaveLength(6)
    for (const opening of openings) {
      expect(opening).toBe(openings[0])
      expect(opening).toMatch(
        /^Subject: Wirecard \(company\)\nPeople: Markus Braun\nWorking title: Wirecard: the billions that were never there\nCategory: con\n/,
      )
    }
  })

  it('reads the bible inside each pass, and prompts with the bible it reads', async () => {
    const other = {
      ...FIRST_CHANNEL_IN_USE,
      bible: {
        ...FIRST_CHANNEL_IN_USE.bible,
        subjectNoun: { singular: 'idea', plural: 'ideas' },
      },
    }
    const reads = vi.fn(async () => other)
    const requests: LLMTaskRequest[] = []
    const complete: AnswerComplete = async (request) => {
      requests.push(request)
      return { text: fixtureFor(request) }
    }

    await researchDossier(inlineSteps, input, { complete, mocked: false, bible: reads })

    // Brief, scenes, two claims parts and two answers parts: one read each.
    expect(reads).toHaveBeenCalledTimes(6)
    expect(requests).toHaveLength(6)
    for (const request of requests) {
      expect(request.system).toContain('Real ideas and living people')
      expect(request.messages[0]!.content).toContain('Subject: Wirecard (idea)')
    }
  })

  it('runs each pass and the grounding under its own step id for the round', async () => {
    const ids: string[] = []
    const recording: Steps = {
      run: (id, fn) => {
        ids.push(id)
        return fn()
      },
    }

    await researchDossier(
      recording,
      { ...input, round: 2 },
      { complete: answering(), mocked: false },
    )

    expect(ids).toEqual([
      'research-brief-2',
      'research-scenes-2',
      'research-claims-2-1',
      'research-claims-2-2',
      'research-answers-2-1',
      'research-answers-2-2',
      'research-ground-2',
    ])
  })

  it('gives each claims part its documents and each answers part its questions', async () => {
    const asked: Record<string, string> = {}
    const complete: AnswerComplete = async (request) => {
      asked[`${passOf(request)}-${partOf(request)}`] = request.messages.at(-1)!.content
      return { text: fixtureFor(request) }
    }

    await researchDossier(inlineSteps, input, { complete, mocked: false })

    const flat = (key: string) => (asked[key] ?? '').replace(/\s+/g, ' ')
    expect(flat('claims-1')).toContain(
      'This is part 1 of 2: extract claims whose FIRST support is one of documents [D1] to [D1].',
    )
    expect(flat('claims-2')).toContain(
      'This is part 2 of 2: extract claims whose FIRST support is one of documents [D2] to [D2].',
    )
    expect(flat('answers-1')).toContain('This is part 1 of 2; answer only the questions listed.')
    expect(asked['answers-1']).toContain('1. Where did the 1.9 billion euros go?')
    expect(asked['answers-1']).not.toContain('Who signed off')
    expect(flat('answers-2')).toContain('This is part 2 of 2; answer only the questions listed.')
    expect(asked['answers-2']).toContain('2. Who signed off on the escrow accounts?')
    expect(asked['answers-2']).not.toContain('Where did the 1.9 billion')
  })

  it("merges the claims parts, dropping a later part's repeats, and joins the answers", async () => {
    const result = await researchDossier(inlineSteps, input, {
      complete: answering({
        'claims-2': {
          claims: [{ ...CLAIM, text: 'WIRECARD filed for insolvency in June, 2020.' }, CLAIM_2],
        },
      }),
      mocked: false,
    })

    expect(result.claims.map((c) => c.text)).toEqual([CLAIM.text, CLAIM_2.text])
    expect(result.research.answers.map((a) => a.index)).toEqual([1, 2])
  })

  it("adds only the answers pass's new claims, folding text to find the repeats", async () => {
    const result = await researchDossier(inlineSteps, input, {
      complete: answering({
        'answers-1': {
          ...ANSWERS,
          claims: [
            { ...CLAIM, text: 'wirecard filed for INSOLVENCY in June, 2020' },
            { ...CLAIM, text: 'Wirecard owed creditors almost four billion euros.' },
          ],
        },
      }),
      mocked: false,
    })

    expect(result.claims.map((c) => c.text)).toEqual([
      CLAIM.text,
      'Wirecard owed creditors almost four billion euros.',
    ])
  })

  it('skips the answers pass when the brief raised no questions', async () => {
    const complete = vi.fn(answering({ brief: { ...BRIEF, openQuestions: [] } }))

    const result = await researchDossier(inlineSteps, input, { complete, mocked: false })

    expect(complete).toHaveBeenCalledTimes(4)
    expect(result.research.answers).toEqual([])
  })

  it('asks a refused pass once more with its reason, then carries on', async () => {
    const calls: string[] = []
    let refusedOnce = false
    const complete: AnswerComplete = async (request, call) => {
      calls.push(call)
      if (passOf(request) === 'brief' && !refusedOnce) {
        refusedOnce = true
        return { text: JSON.stringify({ ...BRIEF, summary: 'It collapsed.' }) }
      }
      return { text: fixtureFor(request) }
    }

    const result = await researchDossier(inlineSteps, input, { complete, mocked: false })

    expect(result.research.brief.summary).toBe(BRIEF.summary)
    expect(calls).toEqual([
      'answer',
      'retry: refused',
      'answer',
      'answer',
      'answer',
      'answer',
      'answer',
    ])
  })

  it('stops the stage with the reason after a second refusal, with no blind retry', async () => {
    const complete = vi.fn(answering({ brief: { ...BRIEF, summary: 'It collapsed.' } }))

    const stopped = researchDossier(inlineSteps, input, { complete, mocked: false })

    await expect(stopped).rejects.toBeInstanceOf(NonRetriableError)
    await expect(stopped).rejects.toThrow(
      /^The research brief could not be written: The model's case brief did not match the expected shape/,
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it("carries each pass's repairs, then the grounding's", async () => {
    const result = await researchDossier(inlineSteps, input, {
      complete: answering({
        brief: { ...BRIEF, summary: 'Wirecard grew fast. '.repeat(300) },
        claims: {
          claims: [
            CLAIM,
            {
              ...CLAIM,
              text: 'A claim citing a document the list does not have.',
              supports: [{ doc: 9, quote: 'a quote from nowhere at all' }],
            },
          ],
        },
      }),
      mocked: false,
    })

    expect(result.repairs).toEqual([
      { action: 'trimmed', field: "the brief's summary" },
      {
        action: 'dropped',
        field: 'claim 2 support 1',
        reason: 'cites a document that was not given',
      },
    ])
  })

  it("carries every part's repairs in part order", async () => {
    const result = await researchDossier(inlineSteps, input, {
      complete: answering({
        'claims-1': { claims: [CLAIM, { ...CLAIM, text: 'A'.repeat(1001) }] },
        'claims-2': { claims: [{ ...CLAIM_2, text: 'B'.repeat(1001) }, CLAIM_2] },
        'answers-2': {
          ...ANSWERS_2,
          answers: [
            { ...ANSWERS_2.answers[0], answer: 'The escrow was never audited. '.repeat(120) },
          ],
        },
      }),
      mocked: false,
    })

    expect(result.repairs).toEqual([
      { action: 'dropped', field: 'claim 2', reason: 'its text ran over 1,000 characters' },
      { action: 'dropped', field: 'claim 1', reason: 'its text ran over 1,000 characters' },
      { action: 'trimmed', field: 'the answer to question 2' },
    ])
  })

  it('reads replayed step results stored without repairs as none, and calls nothing', async () => {
    const complete = vi.fn(answering())
    const grounded = { research: { entity: ENTITY }, claims: [], repairs: [] }

    const result = await researchDossier(
      replaying({
        'research-brief-0': { ok: true, value: BRIEF, split: true },
        'research-scenes-0': { ok: true, value: SCENES.scenes },
        'research-claims-0-1': { ok: true, value: [CLAIM] },
        'research-claims-0-2': { ok: true, value: [CLAIM_2] },
        'research-answers-0-1': { ok: true, value: ANSWERS },
        'research-answers-0-2': { ok: true, value: ANSWERS_2 },
        'research-ground-0': grounded,
      }),
      input,
      { complete, mocked: false },
    )

    expect(result.repairs).toEqual([])
    expect(result.research).toEqual(grounded.research)
    expect(complete).not.toHaveBeenCalled()
  })

  it('marks a new brief as split, so a later replay knows which step ids it wrote', async () => {
    const stored: Record<string, unknown> = {}
    const recording: Steps = {
      run: async (id, fn) => {
        const value = await fn()
        stored[id] = value
        return value
      },
    }

    await researchDossier(recording, input, { complete: answering(), mocked: false })

    expect(stored['research-brief-0']).toMatchObject({ ok: true, split: true })
  })

  it('replays a run researched before the split under its single claims and answers steps', async () => {
    const complete = vi.fn(answering())
    const grounded = { research: { entity: ENTITY }, claims: [], repairs: [] }
    const stored: Record<string, unknown> = {
      // What a run parked at the gate before this deploy stored: no `split`.
      'research-brief-0': { ok: true, value: BRIEF },
      'research-scenes-0': { ok: true, value: SCENES.scenes },
      'research-claims-0': { ok: true, value: [CLAIM] },
      'research-answers-0': { ok: true, value: ANSWERS },
      'research-ground-0': grounded,
    }
    const ids: string[] = []
    const replay: Steps = {
      run: async <T>(id: string) => {
        ids.push(id)
        if (!(id in stored)) throw new Error(`no stored result for ${id}`)
        return stored[id] as T
      },
    }

    const result = await researchDossier(replay, input, { complete, mocked: false })

    expect(ids).toEqual([
      'research-brief-0',
      'research-scenes-0',
      'research-claims-0',
      'research-answers-0',
      'research-ground-0',
    ])
    expect(complete).not.toHaveBeenCalled()
    expect(result.research).toEqual(grounded.research)
  })

  it("accepts an empty claims part and keeps the other's", async () => {
    const calls: string[] = []
    const inner = answering({ 'claims-2': { claims: [] } })
    const complete: AnswerComplete = async (request, call) => {
      calls.push(call)
      return inner(request, call)
    }

    const result = await researchDossier(inlineSteps, input, { complete, mocked: false })

    expect(result.claims.map((c) => c.text)).toEqual([CLAIM.text])
    expect(calls).toHaveLength(6)
    expect(calls.every((call) => call === 'answer')).toBe(true)
  })

  it('stops the stage when no part found a claim', async () => {
    const complete = vi.fn(answering({ claims: { claims: [] } }))

    const stopped = researchDossier(inlineSteps, input, { complete, mocked: false })

    await expect(stopped).rejects.toBeInstanceOf(NonRetriableError)
    await expect(stopped).rejects.toThrow(
      'The claims could not be extracted: no part found a claim in the documents',
    )
    // Brief, scenes and both claims parts; no answers part was asked.
    expect(complete).toHaveBeenCalledTimes(4)
  })

  it("drops an answer's number when it falls outside its part's questions", async () => {
    const result = await researchDossier(inlineSteps, input, {
      complete: answering({
        // Part 2 was asked question 2 and numbered its list from 1.
        'answers-2': {
          answers: [{ index: 1, question: 'Who signed off on the escrow accounts?', answer: null }],
          claims: [],
        },
      }),
      mocked: false,
    })

    expect(result.research.answers.map((a) => a.index)).toEqual([1, undefined])
    expect(result.research.answers[1]).not.toHaveProperty('index')
    expect(result.research.answers[1]!.question).toBe('Who signed off on the escrow accounts?')
  })

  it('returns the budget gate when a pass crosses the cap', async () => {
    const complete = vi.fn<AnswerComplete>(async (request) => {
      if (passOf(request) === 'scenes') {
        throw new BudgetExceededError({
          provider: 'anthropic',
          operation: 'research',
          budgetUsd: 50,
          monthSpendUsd: 49.9,
          estimateUsd: 0.5,
        })
      }
      return { text: fixtureFor(request) }
    })

    const result = await researchDossier(inlineSteps, input, { complete, mocked: false })

    expect(result.budgetGate).toMatchObject({ gate: 'budget', provider: 'anthropic' })
    expect(result.claims).toEqual([])
    expect(result.research.corpus).toEqual(input.corpus)
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('stops at a budget gate in a later part, before the answers pass', async () => {
    const complete = vi.fn<AnswerComplete>(async (request) => {
      if (passOf(request) === 'claims' && partOf(request) === 2) {
        throw new BudgetExceededError({
          provider: 'anthropic',
          operation: 'research',
          budgetUsd: 50,
          monthSpendUsd: 49.9,
          estimateUsd: 0.5,
        })
      }
      return { text: fixtureFor(request) }
    })

    const result = await researchDossier(inlineSteps, input, { complete, mocked: false })

    expect(result.budgetGate).toMatchObject({ gate: 'budget', provider: 'anthropic' })
    expect(result.claims).toEqual([])
    // Brief, scenes and both claims parts; no answers part was asked.
    expect(complete).toHaveBeenCalledTimes(4)
  })

  it('researches the mock corpus with the mock passes in mock mode', async () => {
    const complete = vi.fn(answering())
    const ids: string[] = []
    const recording: Steps = {
      run: (id, fn) => {
        ids.push(id)
        return fn()
      },
    }

    const result = await researchDossier(recording, input, { complete, mocked: true })

    expect(complete).not.toHaveBeenCalled()
    expect(result.research.brief.summary).toMatch(/^MOCK DOSSIER/)
    expect(result.claims.length).toBeGreaterThan(0)
    // The first part carries the mock claims and answers; the second adds nothing.
    expect(ids).toContain('research-claims-0-2')
    expect(ids).toContain('research-answers-0-2')
    expect(result.research.answers.map((a) => a.index)).toEqual([1, 2])
  })
})

describe('splitRange', () => {
  it('splits a count into contiguous ranges as even as possible, the extra going first', () => {
    expect(splitRange(12, 2)).toEqual([
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ])
    expect(splitRange(5, 2)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 5 },
    ])
    expect(splitRange(7, 3)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 5 },
      { from: 6, to: 7 },
    ])
  })

  it('makes fewer ranges than parts when there are fewer items, and none for none', () => {
    expect(splitRange(1, 2)).toEqual([{ from: 1, to: 1 }])
    expect(splitRange(2, 5)).toEqual([
      { from: 1, to: 1 },
      { from: 2, to: 2 },
    ])
    expect(splitRange(0, 2)).toEqual([])
  })
})

describe('unfetchedClaims', () => {
  const support = (documentId: string, archivedUrl: string | null = null) => ({
    documentId,
    rank: 1,
    quote: 'a quote long enough to be found',
    found: true,
    offset: 0,
    locatorSeconds: null,
    url: 'https://example.com',
    archivedUrl,
  })
  const claim = (supports: ReturnType<typeof support>[]) => ({
    text: 'A claim.',
    sourceUrl: null,
    sourceType: 'other' as const,
    confidence: 'single_source' as const,
    legalStatus: 'none' as const,
    legalStatusDate: null,
    legalStatusDocumentId: null,
    series: null,
    supports,
  })
  const docs = [
    { id: 'ok', httpStatus: 200 },
    { id: 'forbidden', httpStatus: 403 },
    { id: 'unknown', httpStatus: null },
  ]

  it('counts a claim whose primary document was not a 2xx, unless Wayback had it', () => {
    expect(unfetchedClaims([claim([support('ok')])], docs)).toBe(0)
    expect(unfetchedClaims([claim([support('forbidden')])], docs)).toBe(1)
    expect(unfetchedClaims([claim([support('unknown')])], docs)).toBe(1)
    expect(
      unfetchedClaims([claim([support('forbidden', 'https://web.archive.org/x')])], docs),
    ).toBe(0)
    expect(unfetchedClaims([claim([])], docs)).toBe(1)
  })

  it('reads only the first support: a later good page does not rescue a bad first one', () => {
    expect(unfetchedClaims([claim([support('forbidden'), support('ok')])], docs)).toBe(1)
    expect(unfetchedClaims([claim([support('ok'), support('forbidden')])], docs)).toBe(0)
  })
})

describe('gateSummary', () => {
  const WIRECARD = {
    subject: 'Wirecard',
    people: ['Markus Braun', 'Jan Marsalek'],
    unresolved: false,
  }

  it('opens with the subject and its people, and ends with the corpus line', () => {
    expect(
      gateSummary(
        { total: 10, unverified: 1, quarantined: 0 },
        { read: 42, unread: 9, failed: 3 },
        WIRECARD,
      ),
    ).toBe(
      'Subject: Wirecard (company), Markus Braun, Jan Marsalek · Dossier ready · 10 claims · ' +
        '1 unsourced · 42 documents read, 9 gathered not read, 3 could not be fetched',
    )
  })

  it('says so when the subject was not found on Wikipedia', () => {
    expect(
      gateSummary(
        { total: 2, unverified: 0, quarantined: 0 },
        { read: 4, unread: 0, failed: 0 },
        { ...WIRECARD, unresolved: true },
      ),
    ).toBe(
      "Subject not found on Wikipedia: check the case's Subject · Dossier ready · 2 claims · " +
        '4 documents read, 0 gathered not read, 0 could not be fetched',
    )
  })
})

describe('gateSubject', () => {
  const CASE = { subject: 'Wirecard', people: ['Markus Braun'] }

  it("names the entity's subject and people", () => {
    expect(
      gateSubject(
        {
          subject: 'Wirecard AG',
          people: [
            { name: 'Markus Braun', qid: 'Q1', title: 'Markus Braun' },
            { name: 'Jan Marsalek', qid: null, title: null },
          ],
          unresolved: false,
        },
        CASE,
      ),
    ).toEqual({
      subject: 'Wirecard AG',
      people: ['Markus Braun', 'Jan Marsalek'],
      unresolved: false,
    })
  })

  it('falls back to the case for an entity stored before it carried a subject', () => {
    // What a gather replayed from before Task 3 hands back.
    const old = { qid: 'Q1', titles: ['Wirecard'], cik: null, ticker: null, website: null }
    expect(gateSubject(old, CASE)).toEqual({
      subject: 'Wirecard',
      people: ['Markus Braun'],
      unresolved: false,
    })
  })

  it('keeps an unresolved entity unresolved', () => {
    expect(gateSubject({ subject: 'Wirecard', people: [], unresolved: true }, CASE)).toMatchObject({
      unresolved: true,
    })
  })
})

describe('replayedCase', () => {
  it("reads the subject, people and the owner's links a load-case stored", () => {
    expect(
      replayedCase({
        title: 'The payments darling that was never there',
        subject: 'Wirecard',
        people: ['Markus Braun'],
        sourceLinks: [{ url: 'https://example.com/long-read' }],
      }),
    ).toEqual({
      subject: 'Wirecard',
      people: ['Markus Braun'],
      sourceLinks: [{ url: 'https://example.com/long-read' }],
    })
  })

  it('falls back to the case title for a load-case stored before cases had a subject', () => {
    expect(replayedCase({ title: 'Wirecard' })).toEqual({
      subject: 'Wirecard',
      people: [],
      sourceLinks: [],
    })
  })
})

const testUrl = requireTestDatabase()
const suiteDb = testUrl ? describe : describe.skip

suiteDb('loadCorpus', () => {
  const { sql, db } = createDb(testUrl ?? 'postgres://unused', { max: 2 })
  const HOST = 'https://corpus-load-test.example'
  let projectId = ''
  let caseId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  const clearDocuments = () => sql`delete from research_documents where url like ${`${HOST}/%`}`

  beforeEach(async () => {
    await clearDocuments()
    const created = await createCase(db, {
      channelId: (await ensureFirstChannel(db)).id,
      title: `Corpusloadtest ${Date.now()} ${Math.random().toString(36).slice(2)}`,
      category: 'collapse',
    })
    caseId = created.id
    projectId = (await createProjectFromCase(db, { caseId, title: created.title })).id
  })

  afterEach(async () => {
    await sql`delete from projects where id = ${projectId}`
    await sql`delete from cases where id = ${caseId}`
    await clearDocuments()
  })

  async function stored(name: string, text: string, failure: string | null = null) {
    return upsertResearchDocument(db, {
      url: `${HOST}/${name}`,
      finalUrl: `${HOST}/${name}`,
      httpStatus: failure ? 404 : 200,
      fetchedAt: new Date(),
      contentType: 'text/html',
      kind: 'reporting',
      tier: 2,
      title: name,
      publishedAt: '2020-06',
      text,
      textHash: null,
      tokens: Math.ceil(text.length / 4),
      archivedUrl: null,
      truncated: false,
      failure,
      meta: null,
    })
  }

  it('loads the read documents in rank order, each cut to its cap, and counts the rest', async () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i}. ${'word '.repeat(198)}`,
    ).join('\n\n')
    const second = await stored('second', 'The second document.')
    const first = await stored('first', long)
    const unread = await stored('unread', 'Over the budget.')
    const failed = await stored('failed', '', 'could not fetch: 404')
    await linkDossierDocuments(db, projectId, [
      { documentId: unread.id, rank: null, tier: 2 },
      { documentId: second.id, rank: 2, tier: 2 },
      { documentId: failed.id, rank: null, tier: 2 },
      { documentId: first.id, rank: 1, tier: 2 },
    ])

    const loaded = await loadCorpus(db, projectId)

    expect(loaded.documents.map((d) => d.id)).toEqual([first.id, second.id])
    expect(loaded.corpus).toEqual({ read: 2, unread: 1, failed: 1 })
    expect(loaded.documents[0]!.text.length).toBeLessThanOrEqual(DOSSIER_DOCUMENT_TOKENS * 4)
    expect(long.startsWith(loaded.documents[0]!.text)).toBe(true)
    expect(loaded.documents[1]).toEqual({
      id: second.id,
      url: `${HOST}/second`,
      kind: 'reporting',
      title: 'second',
      publishedAt: '2020-06',
      text: 'The second document.',
      archivedUrl: null,
      httpStatus: 200,
    })
  })
})
