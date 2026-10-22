// @vitest-environment node

import {
  createCase,
  createDb,
  createProjectFromCase,
  linkDossierDocuments,
  requireTestDatabase,
  upsertResearchDocument,
} from '@boom-busters/db'
import type { CorpusDocument, LLMTaskRequest } from '@boom-busters/providers'
import { BudgetExceededError, DOSSIER_DOCUMENT_TOKENS } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnswerComplete } from '@/lib/answer'
import { gateSummary, loadCorpus, researchDossier, unfetchedClaims } from './dossier-research'
import { inlineSteps, type Steps } from './steps'

/**
 * The four research passes over a small corpus, then the grounding, with a
 * fake call that answers each pass from fixture JSON. No provider, and no
 * database but for the corpus loader's own suite: the passes write nothing;
 * the save steps do, and the runner's and reviser's tests cover them.
 */

const replaying = (stored: Record<string, unknown>): Steps => ({
  run: async <T>(id: string) => stored[id] as T,
})

const CASE = { title: 'Wirecard', category: 'con', angle: null, demandNotes: null }
const ENTITY = { qid: 'Q1', titles: ['Wirecard'], cik: null, ticker: null, website: null }

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
  openQuestions: ['Where did the 1.9 billion euros go?'],
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
const ANSWERS = {
  answers: [{ index: 1, question: 'Where did the 1.9 billion euros go?', answer: null }],
  claims: [],
}

type Pass = 'brief' | 'scenes' | 'claims' | 'answers'

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

const FIXTURES: Record<Pass, unknown> = {
  brief: BRIEF,
  scenes: SCENES,
  claims: { claims: [CLAIM] },
  answers: ANSWERS,
}

function fixtureFor(request: LLMTaskRequest, over: Partial<Record<Pass, unknown>> = {}): string {
  const pass = passOf(request)
  return JSON.stringify(over[pass] ?? FIXTURES[pass])
}

const answering =
  (over: Partial<Record<Pass, unknown>> = {}): AnswerComplete =>
  async (request) => ({ text: fixtureFor(request, over) })

describe('researchDossier over the corpus', () => {
  it('runs four passes, passes the note to every one, and grounds the result', async () => {
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

    expect(seen).toHaveLength(4)
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
      'research-claims-2',
      'research-answers-2',
      'research-ground-2',
    ])
  })

  it("adds only the answers pass's new claims, folding text to find the repeats", async () => {
    const result = await researchDossier(inlineSteps, input, {
      complete: answering({
        answers: {
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

    expect(complete).toHaveBeenCalledTimes(3)
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
    expect(calls).toEqual(['answer', 'retry: refused', 'answer', 'answer', 'answer'])
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

  it('reads replayed step results stored without repairs as none, and calls nothing', async () => {
    const complete = vi.fn(answering())
    const grounded = { research: { entity: ENTITY }, claims: [], repairs: [] }

    const result = await researchDossier(
      replaying({
        'research-brief-0': { ok: true, value: BRIEF },
        'research-scenes-0': { ok: true, value: SCENES.scenes },
        'research-claims-0': { ok: true, value: [CLAIM] },
        'research-answers-0': { ok: true, value: ANSWERS },
        'research-ground-0': grounded,
      }),
      input,
      { complete, mocked: false },
    )

    expect(result.repairs).toEqual([])
    expect(result.research).toEqual(grounded.research)
    expect(complete).not.toHaveBeenCalled()
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

  it('researches the mock corpus with the mock passes in mock mode', async () => {
    const complete = vi.fn(answering())

    const result = await researchDossier(inlineSteps, input, { complete, mocked: true })

    expect(complete).not.toHaveBeenCalled()
    expect(result.research.brief.summary).toMatch(/^MOCK DOSSIER/)
    expect(result.claims.length).toBeGreaterThan(0)
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
})

describe('gateSummary', () => {
  it('ends with the corpus line', () => {
    expect(
      gateSummary({ total: 10, unverified: 1, quarantined: 0 }, { read: 42, unread: 9, failed: 3 }),
    ).toBe(
      'Dossier ready · 10 claims · 1 unsourced · 42 documents read, 9 gathered not read, 3 could not be fetched',
    )
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
