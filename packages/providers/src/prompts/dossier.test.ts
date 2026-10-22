import { DOSSIER_CLAIMS_PER_PASS, DOSSIER_QUOTE_MAX, ValidationError } from '@boom-busters/schemas'
import type {
  CaseBrief,
  GroundedClaim,
  GroundedRef,
  GroundedResearch,
  Scene,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { outputBudget } from '../llm/types'
import { mockCorpusDocuments } from '../research/mock-corpus'
import {
  buildAnswersRequest,
  buildBriefRequest,
  buildClaimsRequest,
  buildScenesRequest,
  mockAnswers,
  mockBrief,
  mockClaims,
  mockScenes,
  parseAnswers,
  parseBrief,
  parseClaims,
  parseScenes,
  renderDossierMarkdown,
  withNote,
} from './dossier'
import type { Note, Repair } from './repair'

const caseContext = {
  title: 'Enron',
  category: 'collapse',
  angle: 'The auditors, not the traders.',
  demandNotes: null,
}

const corpus = '[D1] reporting · x · 2020 · https://x\nText'

const brief: CaseBrief = {
  summary: 'x'.repeat(60),
  turningPoint: 'The moment the mark-to-market accounting was approved.',
  cast: [
    {
      name: 'Jeffrey Skilling',
      role: 'CEO',
      wanted: 'To make Enron look like a technology company.',
      scene: null,
    },
  ],
  toldAlready: [],
  openQuestions: ['What did the board know in 1999?'],
}

const scenes: Scene[] = [
  {
    when: 'August 2001',
    who: 'Jeffrey Skilling',
    what: 'Resigned as chief executive after six months.',
    why: 'The first public crack in the story.',
    doc: 1,
    quote: 'Skilling resigned for personal reasons',
  },
]

const requests = () => [
  buildBriefRequest(caseContext, corpus),
  buildScenesRequest(caseContext, corpus, brief),
  buildClaimsRequest(caseContext, corpus, brief, scenes),
  buildAnswersRequest(caseContext, corpus, brief, scenes),
]

/** The prompt with its line breaks folded, so a pinned sentence can wrap in the source. */
const flat = (request: { system: string }) => request.system.replace(/\s+/g, ' ')

describe('the research prompts', () => {
  it('puts the corpus in the first user message and marks it cacheable', () => {
    const request = buildClaimsRequest(caseContext, corpus, brief, scenes)
    expect(request.messages[0]?.content).toContain('[D1] reporting')
    expect(request.cacheablePrefixMessages).toBe(1)
  })

  it('opens every pass with the same header and corpus, so the prefix is one cache entry', () => {
    const first =
      'Case: Enron\nCategory: collapse\nAngle to pursue: The auditors, not the traders.' +
      `\n\nDocuments, numbered. Cite them by number.\n\n${corpus}`
    for (const request of requests()) {
      expect(request.task).toBe('research')
      expect(request.messages[0]).toEqual({ role: 'user', content: first })
      expect(request.cacheablePrefixMessages).toBe(1)
    }
  })

  it('holds every pass to the documents in front of it', () => {
    for (const request of requests()) {
      expect(flat(request)).toContain(
        'Write only what the documents in front of you say. A fact you remember but cannot ' +
          'quote from a document is an open question, not a claim.',
      )
    }
  })

  it('gives each pass its output budget', () => {
    expect(requests().map((request) => request.maxTokens)).toEqual([
      outputBudget(6_000),
      outputBudget(10_000),
      outputBudget(16_000),
      outputBudget(12_000),
    ])
  })

  it('feeds the later passes the brief and the scenes', () => {
    const scenesRequest = buildScenesRequest(caseContext, corpus, brief)
    expect(JSON.stringify(scenesRequest.messages.slice(1))).toContain('Jeffrey Skilling')
    for (const request of requests().slice(2)) {
      expect(JSON.stringify(request.messages.slice(1))).toContain(
        'Skilling resigned for personal reasons',
      )
    }
  })

  it('asks the brief for what each person wanted and for told-already beats from video only', () => {
    const system = flat(buildBriefRequest(caseContext, corpus))
    expect(system).toContain('"wanted"')
    expect(system).toContain('"toldAlready"')
    expect(system).toMatch(/ONLY from documents of kind `video`/)
  })

  it('asks the scenes pass for moments in the story, not a legal chronology', () => {
    const system = flat(buildScenesRequest(caseContext, corpus, brief))
    expect(system).toMatch(/what was said or done/)
    expect(system).toMatch(/why it matters to the arc/)
    expect(system).toMatch(/not a legal chronology/)
  })

  it('pins the quote, legal status and figure rules in the claims and answers passes', () => {
    for (const request of requests().slice(2)) {
      const system = flat(request)
      expect(system).toContain(
        '`quote` is the shortest span of the document that proves the claim, copied exactly, ' +
          'usually under 120 characters and never over 300',
      )
      expect(system).toContain(
        '`legal.status` is `ruled` only when a court or regulator document in the list says ' +
          'so; `alleged` when a filing, complaint or report makes the allegation; `none` otherwise',
      )
      expect(system).toContain(
        'a figure claim carries `series` with `asWritten` copied as the document prints the number',
      )
    }
  })

  it('asks the claims pass for at most a pass worth of claims', () => {
    expect(flat(buildClaimsRequest(caseContext, corpus, brief, scenes))).toContain(
      `Limits (the app checks them): 1 to ${DOSSIER_CLAIMS_PER_PASS} claims;`,
    )
  })

  it('puts the open questions to the answers pass, verbatim and numbered', () => {
    // Numbered because the number is the join key (decision 203).
    const request = buildAnswersRequest(caseContext, corpus, brief, scenes)
    expect(request.messages.at(-1)?.content).toContain('1. What did the board know in 1999?')
    expect(request.system).toMatch(/`index` is the question's number/)
    expect(request.system).toMatch(/set `answer` to null/)
  })
})

describe('withNote', () => {
  it('withNote appends to the last user message only', () => {
    const request = buildClaimsRequest(caseContext, corpus, brief, scenes)
    const noted = withNote(request, 'More on the auditors.')

    expect(noted.messages.at(-1)?.content).toBe(
      `${request.messages.at(-1)?.content}\n\nThe human asks for changes: More on the auditors.`,
    )
    // The cached prefix is untouched, so a revision still reads the corpus from cache.
    expect(noted.messages.slice(0, -1)).toEqual(request.messages.slice(0, -1))
    expect(request.messages.at(-1)?.content).not.toContain('More on the auditors')
  })

  it('appends to the corpus message when the pass has only that one', () => {
    const request = buildBriefRequest(caseContext, corpus)
    const noted = withNote(request, 'Lead with the auditors.')
    expect(noted.messages).toHaveLength(1)
    expect(
      noted.messages[0]?.content.endsWith('The human asks for changes: Lead with the auditors.'),
    ).toBe(true)
  })
})

const collect = () => {
  const notes: Repair[] = []
  const note: Note = (repair) => {
    notes.push(repair)
  }
  return { notes, note }
}

const CLAIM = {
  text: 'Enron filed for bankruptcy in December 2001.',
  supports: [{ doc: 1, quote: 'Enron filed for Chapter 11 protection' }],
}

describe('parseBrief', () => {
  it('reads a well-formed brief, with an empty told-already list by default', () => {
    const { toldAlready, ...rest } = brief
    void toldAlready
    const parsed = parseBrief(JSON.stringify(rest))
    expect(parsed.cast[0]?.wanted).toContain('technology company')
    expect(parsed.toldAlready).toEqual([])
  })

  it('rejects a brief too thin to be research', () => {
    expect(() => parseBrief(JSON.stringify({ ...brief, summary: 'It collapsed.' }))).toThrow(
      ValidationError,
    )
  })

  it('trims a long summary and turning point at a sentence, and says which', () => {
    const { notes, note } = collect()
    const parsed = parseBrief(
      JSON.stringify({
        ...brief,
        summary: 'The company grew fast. '.repeat(250),
        turningPoint: 'The auditors refused to sign. '.repeat(80),
      }),
      note,
    )
    expect(parsed.summary.length).toBeLessThanOrEqual(5000)
    expect(parsed.summary.endsWith('The company grew fast.')).toBe(true)
    expect(parsed.turningPoint.length).toBeLessThanOrEqual(2000)
    expect(notes).toEqual([
      { action: 'trimmed', field: "the brief's summary" },
      { action: 'trimmed', field: "the brief's turning point" },
    ])
  })

  it('keeps the first thirty cast members and twenty open questions', () => {
    const { notes, note } = collect()
    const parsed = parseBrief(
      JSON.stringify({
        ...brief,
        cast: Array.from({ length: 31 }, (_, at) => ({
          name: `Person ${at}`,
          role: 'Director',
          wanted: 'To keep the share price up.',
          scene: null,
        })),
        openQuestions: Array.from({ length: 21 }, (_, at) => `Open question number ${at}?`),
      }),
      note,
    )
    expect(parsed.cast).toHaveLength(30)
    expect(parsed.cast[29]?.name).toBe('Person 29')
    expect(parsed.openQuestions).toHaveLength(20)
    expect(notes).toEqual([
      { action: 'capped', field: 'cast', kept: 30 },
      { action: 'capped', field: 'open questions', kept: 20 },
    ])
  })

  it("drops a cast member's scene whose quote runs over, keeping the person", () => {
    const { notes, note } = collect()
    const parsed = parseBrief(
      JSON.stringify({
        ...brief,
        cast: [{ ...brief.cast[0], scene: { doc: 2, quote: 'q'.repeat(DOSSIER_QUOTE_MAX + 1) } }],
      }),
      note,
    )
    expect(parsed.cast[0]?.name).toBe('Jeffrey Skilling')
    expect(parsed.cast[0]?.scene).toBeNull()
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'the scene of cast member 1',
        reason: 'its quote ran over 300 characters',
      },
    ])
  })

  it('drops a cast member whose name runs over, and a told-already beat whose quote does', () => {
    const { notes, note } = collect()
    const parsed = parseBrief(
      JSON.stringify({
        ...brief,
        cast: [{ ...brief.cast[0], name: 'N'.repeat(121) }, brief.cast[0]],
        toldAlready: [
          {
            beat: 'The videos tell the raid on the Munich office.',
            doc: 3,
            quote: 'q'.repeat(301),
          },
          {
            beat: 'The videos tell the missing 1.9 billion.',
            doc: 3,
            quote: 'the money was never there',
          },
        ],
      }),
      note,
    )
    expect(parsed.cast).toHaveLength(1)
    expect(parsed.toldAlready.map((told) => told.beat)).toEqual([
      'The videos tell the missing 1.9 billion.',
    ])
    expect(notes).toEqual([
      { action: 'dropped', field: 'cast member 1', reason: 'its name ran over 120 characters' },
      {
        action: 'dropped',
        field: 'told-already beat 1',
        reason: 'its quote ran over 300 characters',
      },
    ])
  })
})

describe('parseScenes', () => {
  const SCENE = scenes[0]!

  it('reads well-formed scenes', () => {
    expect(parseScenes(JSON.stringify({ scenes }))).toEqual(scenes)
  })

  it('parseScenes keeps sixty scenes and notes the cap', () => {
    const { notes, note } = collect()
    const parsed = parseScenes(
      JSON.stringify({
        scenes: Array.from({ length: 61 }, (_, at) => ({ ...SCENE, when: `Day ${at + 1}` })),
      }),
      note,
    )
    expect(parsed).toHaveLength(60)
    expect(parsed[59]?.when).toBe('Day 60')
    expect(notes).toEqual([{ action: 'capped', field: 'scenes', kept: 60 }])
  })

  it('drops a scene whose date or quote runs over, trims a long one, and numbers each as written', () => {
    const { notes, note } = collect()
    const parsed = parseScenes(
      JSON.stringify({
        scenes: [
          { ...SCENE, when: 'x'.repeat(101) },
          { ...SCENE, quote: 'q'.repeat(301) },
          { ...SCENE, what: 'Skilling resigned. '.repeat(80) },
        ],
      }),
      note,
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.what.length).toBeLessThanOrEqual(1000)
    expect(parsed[0]!.what.endsWith('Skilling resigned.')).toBe(true)
    expect(notes).toEqual([
      { action: 'dropped', field: 'scene 1', reason: 'its date ran over 100 characters' },
      { action: 'dropped', field: 'scene 2', reason: 'its quote ran over 300 characters' },
      { action: 'trimmed', field: 'scene 3' },
    ])
  })

  it('refuses scenes its drops left empty', () => {
    expect(() =>
      parseScenes(JSON.stringify({ scenes: [{ ...SCENE, when: 'x'.repeat(101) }] })),
    ).toThrow(ValidationError)
  })
})

describe('parseClaims', () => {
  it('reads a well-formed claim, defaulting legal status and series to null', () => {
    expect(parseClaims(JSON.stringify({ claims: [CLAIM] }))).toEqual([
      { ...CLAIM, legal: null, series: null },
    ])
  })

  it('reads a ruled claim and a figure series', () => {
    const [ruled, figure] = parseClaims(
      JSON.stringify({
        claims: [
          { ...CLAIM, legal: { status: 'ruled', date: '2006-05', doc: 4 } },
          {
            ...CLAIM,
            series: {
              label: 'Revenue',
              unit: 'USD billion',
              currency: 'USD',
              points: [
                { at: '1999', value: 40.1, asWritten: '$40.1 billion' },
                { at: '2000', value: 100.8, asWritten: '$100.8 billion' },
              ],
            },
          },
        ],
      }),
    )
    expect(ruled?.legal).toEqual({ status: 'ruled', date: '2006-05', doc: 4 })
    expect(figure?.series?.points.map((point) => point.asWritten)).toEqual([
      '$40.1 billion',
      '$100.8 billion',
    ])
  })

  it('drops a series point whose printed number runs over, and a series left with none', () => {
    const { notes, note } = collect()
    const series = (asWritten: string[]) => ({
      label: 'Revenue',
      unit: 'USD billion',
      currency: 'USD',
      points: asWritten.map((written, at) => ({
        at: `${2000 + at}`,
        value: at,
        asWritten: written,
      })),
    })
    const [kept, emptied] = parseClaims(
      JSON.stringify({
        claims: [
          { ...CLAIM, series: series(['$40.1 billion', '9'.repeat(41)]) },
          { ...CLAIM, series: series(['9'.repeat(41)]) },
        ],
      }),
      note,
    )
    expect(kept?.series?.points.map((point) => point.asWritten)).toEqual(['$40.1 billion'])
    expect(emptied?.series).toBeNull()
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'point 2 of the series of claim 1',
        reason: 'its number as written ran over 40 characters',
      },
      {
        action: 'dropped',
        field: 'point 1 of the series of claim 2',
        reason: 'its number as written ran over 40 characters',
      },
      { action: 'dropped', field: 'the series of claim 2', reason: 'no point was left' },
    ])
  })

  it('parseClaims drops a support whose quote is over 300 characters and the claim when none is left, noting both', () => {
    const { notes, note } = collect()
    const long = { doc: 2, quote: 'q'.repeat(DOSSIER_QUOTE_MAX + 1) }
    const parsed = parseClaims(
      JSON.stringify({
        claims: [
          { ...CLAIM, supports: [long] },
          {
            ...CLAIM,
            text: 'Enron executives were convicted in 2006.',
            supports: [long, CLAIM.supports[0]],
          },
        ],
      }),
      note,
    )
    expect(parsed.map((claim) => claim.text)).toEqual(['Enron executives were convicted in 2006.'])
    expect(parsed[0]?.supports).toEqual(CLAIM.supports)
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'claim 1 support 1',
        reason: 'its quote ran over 300 characters',
      },
      {
        action: 'dropped',
        field: 'claim 2 support 1',
        reason: 'its quote ran over 300 characters',
      },
      { action: 'dropped', field: 'claim 1', reason: 'no support was left' },
    ])
  })

  it('drops a claim that cites no document at all rather than refusing the pass', () => {
    const { notes, note } = collect()
    const parsed = parseClaims(
      JSON.stringify({ claims: [{ text: 'Enron was the seventh largest company.' }, CLAIM] }),
      note,
    )
    expect(parsed).toHaveLength(1)
    expect(notes).toEqual([{ action: 'dropped', field: 'claim 1', reason: 'no support was left' }])
  })

  it('keeps the first three supports of a claim', () => {
    const { notes, note } = collect()
    const [parsed] = parseClaims(
      JSON.stringify({
        claims: [
          { ...CLAIM, supports: [1, 2, 3, 4].map((doc) => ({ doc, quote: 'the same words' })) },
        ],
      }),
      note,
    )
    expect(parsed?.supports.map((support) => support.doc)).toEqual([1, 2, 3])
    expect(notes).toEqual([{ action: 'capped', field: 'supports of claim 1', kept: 3 }])
  })

  it('drops a claim whose text runs over, keeps the rest whole, and names it', () => {
    const { notes, note } = collect()
    const parsed = parseClaims(
      JSON.stringify({ claims: [CLAIM, { ...CLAIM, text: 'A'.repeat(1001) }] }),
      note,
    )
    expect(parsed).toHaveLength(1)
    expect(notes).toEqual([
      { action: 'dropped', field: 'claim 2', reason: 'its text ran over 1,000 characters' },
    ])
  })

  it(`keeps the first ${DOSSIER_CLAIMS_PER_PASS} claims`, () => {
    const { notes, note } = collect()
    const parsed = parseClaims(
      JSON.stringify({
        claims: Array.from({ length: DOSSIER_CLAIMS_PER_PASS + 1 }, (_, at) => ({
          ...CLAIM,
          text: `Claim number ${at + 1} about Enron.`,
        })),
      }),
      note,
    )
    expect(parsed).toHaveLength(DOSSIER_CLAIMS_PER_PASS)
    expect(notes).toEqual([{ action: 'capped', field: 'claims', kept: DOSSIER_CLAIMS_PER_PASS }])
  })

  it('refuses a legal status the gate cannot read, and an empty claims list', () => {
    expect(() =>
      parseClaims(
        JSON.stringify({
          claims: [{ ...CLAIM, legal: { status: 'probably', date: '2001', doc: 1 } }],
        }),
      ),
    ).toThrow(ValidationError)
    expect(() => parseClaims('{"claims":[]}')).toThrow(ValidationError)
  })
})

describe('parseAnswers', () => {
  it('parses answers with their document, folding a refusal-as-string into null', () => {
    const parsed = parseAnswers(
      JSON.stringify({
        answers: [
          {
            index: 1,
            question: 'What did the board know in 1999?',
            answer: 'The Powers report found the board approved the structures.',
            doc: 4,
          },
          { index: 2, question: 'Why was it liquidation, not administration?', answer: 'unknown' },
        ],
      }),
    )
    expect(parsed.answers[0]).toMatchObject({ doc: 4, answer: expect.stringContaining('Powers') })
    expect(parsed.answers[1]?.answer).toBeNull()
    expect(parsed.claims).toEqual([])
  })

  it('reads an honest null that names no document as "doc": null', () => {
    const parsed = parseAnswers(
      JSON.stringify({
        answers: [{ index: 1, question: 'Who leaked it to the press?', answer: null, doc: null }],
      }),
    )
    expect(parsed.answers).toEqual([
      { index: 1, question: 'Who leaked it to the press?', answer: null },
    ])
  })

  it('trims a long answer, drops one whose question ran over, and names each by its question', () => {
    const { notes, note } = collect()
    const parsed = parseAnswers(
      JSON.stringify({
        answers: [
          {
            index: 1,
            question: 'What did the board know in 1999?',
            answer: 'The Powers report found the board approved it. '.repeat(70),
          },
          { index: 2, question: 'Q'.repeat(1001), answer: 'An answer that will not be kept.' },
        ],
      }),
      note,
    )
    expect(parsed.answers.map((answer) => answer.index)).toEqual([1])
    expect(parsed.answers[0]!.answer!.length).toBeLessThanOrEqual(3000)
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'the answer to question 2',
        reason: 'its question ran over 1,000 characters',
      },
      { action: 'trimmed', field: 'the answer to question 1' },
    ])
  })

  it('holds the claims found while answering to the claims pass rules', () => {
    const { notes, note } = collect()
    const parsed = parseAnswers(
      JSON.stringify({
        answers: [],
        claims: [
          { ...CLAIM, supports: [{ doc: 2, quote: 'q'.repeat(301) }] },
          ...Array.from({ length: 41 }, (_, at) => ({ ...CLAIM, text: `Claim number ${at + 1}.` })),
        ],
      }),
      note,
    )
    expect(parsed.claims).toHaveLength(40)
    expect(parsed.claims[0]?.text).toBe('Claim number 1.')
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'claim 1 found while answering, support 1',
        reason: 'its quote ran over 300 characters',
      },
      {
        action: 'dropped',
        field: 'claim 1 found while answering',
        reason: 'no support was left',
      },
      { action: 'capped', field: 'claims found while answering', kept: 40 },
    ])
  })
})

// ---------------------------------------------------------------------------
// The renderer
// ---------------------------------------------------------------------------

const ref = (over: Partial<GroundedRef> = {}): GroundedRef => ({
  documentId: 'doc-1',
  url: 'https://example.com/story',
  found: true,
  locatorSeconds: null,
  quote: 'the words that show it',
  ...over,
})

const scene = (over: { ref?: Partial<GroundedRef> } = {}): GroundedResearch['scenes'][number] => ({
  when: 'June 2020',
  who: 'Markus Braun',
  what: 'Resigned as chief executive',
  why: 'The founder leaves the stage.',
  quote: 'the words that show it',
  ref: ref(over.ref),
})

const grounded = (over: Partial<GroundedResearch> = {}): GroundedResearch => ({
  entity: { qid: null, titles: [], cik: null, ticker: null, website: null },
  brief: {
    summary: 'A payments company that reported cash it did not have.',
    turningPoint: 'The auditors could not find the 1.9 billion.',
    cast: [
      {
        name: 'Markus Braun',
        role: 'chief executive',
        wanted: 'To be the next big payments platform.',
        ref: null,
      },
    ],
    toldAlready: [],
    openQuestions: [],
  },
  scenes: [],
  answers: [],
  corpus: { read: 4, unread: 0, failed: 0 },
  ...over,
})

const withQuestions = (
  openQuestions: string[],
  answers: GroundedResearch['answers'],
): GroundedResearch => {
  const base = grounded({ answers })
  return { ...base, brief: { ...base.brief, openQuestions } }
}

const claim = (over: Partial<GroundedClaim> = {}): GroundedClaim => ({
  text: 'Wirecard reported 1.9 billion euros it did not have.',
  sourceUrl: 'https://example.com/story',
  sourceType: 'major_outlet',
  confidence: 'sourced',
  legalStatus: 'none',
  legalStatusDate: null,
  legalStatusDocumentId: null,
  series: null,
  supports: [],
  ...over,
})

describe('renderDossierMarkdown', () => {
  const render = (research: GroundedResearch, claims: GroundedClaim[] = []) =>
    renderDossierMarkdown({ caseTitle: 'Wirecard', research, claims })

  it('leads with the title, the summary and the turn', () => {
    const md = render(grounded())
    expect(md.startsWith('# Wirecard\n\n## Summary\n\nA payments company')).toBe(true)
    expect(md).toContain('## The turn\n\nThe auditors could not find the 1.9 billion.')
  })

  it('lists the principals with what each one wanted', () => {
    expect(render(grounded())).toContain(
      '## Principals\n\n- **Markus Braun** — chief executive. *To be the next big payments platform.*',
    )
  })

  it('renders scenes with a timestamped source and marks an unplaced one', () => {
    const md = render(
      grounded({
        scenes: [
          scene({
            ref: { url: 'https://youtube.com/watch?v=abc', locatorSeconds: 65, found: true },
          }),
          scene({ ref: { found: false } }),
        ],
      }),
    )
    expect(md).toContain('([source](https://youtube.com/watch?v=abc&t=65))')
    expect(md).toContain('(unplaced)')
    expect(md).toContain(
      '- **June 2020** — Resigned as chief executive (Markus Braun). *The founder leaves the stage.* ([source](https://example.com/story)) (unplaced)',
    )
  })

  it('starts a query for a timestamp on a link that has none', () => {
    const md = render(
      grounded({ scenes: [scene({ ref: { url: 'https://youtu.be/abc', locatorSeconds: 5 } })] }),
    )
    expect(md).toContain('([source](https://youtu.be/abc?t=5))')
  })

  it('omits Told already when empty and lists beats otherwise', () => {
    expect(render(grounded())).not.toContain('## Told already')

    const base = grounded()
    const md = renderDossierMarkdown({
      caseTitle: 'Wirecard',
      research: {
        ...base,
        brief: {
          ...base.brief,
          toldAlready: [
            {
              beat: 'The FT investigation and the short sellers.',
              ref: ref({ documentId: 'video-1', url: 'https://youtube.com/watch?v=v1' }),
            },
            {
              beat: 'The raid on the Aschheim office.',
              ref: ref({ documentId: 'video-2', url: 'https://youtube.com/watch?v=v2' }),
            },
          ],
        },
      },
      claims: [],
      documents: [{ id: 'video-1', title: 'How [Wirecard] fooled everyone' }],
    })
    expect(md).toContain('## Told already')
    expect(md).toContain(
      '- The FT investigation and the short sellers. ([How (Wirecard) fooled everyone](https://youtube.com/watch?v=v1))',
    )
    expect(md).toContain(
      '- The raid on the Aschheim office. ([https://youtube.com/watch?v=v2](https://youtube.com/watch?v=v2))',
    )
  })

  it('puts open questions in the document when nothing answered them', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?'],
        [{ index: 1, question: 'What did the board know in 2019?', answer: null, ref: null }],
      ),
    )
    expect(md).not.toContain('## Questions the research answered')
    expect(md).toContain('## Open questions\n\n- What did the board know in 2019?')
  })

  it('places an answer by its index, under the brief wording, linked to its document', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?', 'Who leaked it?'],
        [
          {
            index: 1,
            question: "What was the board's knowledge?",
            answer: 'The special audit found the board was told in 2019.',
            ref: ref({ url: 'https://example.com/kpmg' }),
          },
        ],
      ),
    )
    expect(md).toContain(
      '- **What did the board know in 2019?** — The special audit found the board was told in 2019. ([source](https://example.com/kpmg))',
    )
    expect(md).not.toContain("What was the board's knowledge?")
    expect(md).toContain('## Open questions\n\n- Who leaked it?')
  })

  it('falls back to the folded text when the index is missing or outside the list', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?', 'Who leaked it?'],
        [
          {
            index: 7,
            question: 'What did the board know in 2019.',
            answer: 'The special audit found the board was told.',
            ref: null,
          },
          { question: 'who leaked it', answer: 'A whistleblower in Singapore did.', ref: null },
        ],
      ),
    )
    expect(md).toContain('- **What did the board know in 2019?** — The special audit')
    expect(md).toContain('- **Who leaked it?** — A whistleblower in Singapore did.')
    expect(md).not.toContain('## Open questions')
  })

  it('never discards a real answer it cannot place: it renders under its own words', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?'],
        [
          {
            question: 'How much cash was missing?',
            answer: 'About 1.9 billion euros, per the special audit.',
            ref: null,
          },
        ],
      ),
    )
    expect(md).toContain('- **How much cash was missing?** — About 1.9 billion euros')
    expect(md).toContain('## Open questions\n\n- What did the board know in 2019?')
  })

  it('says how many claims are unverified, and nothing when none is', () => {
    const md = render(grounded(), [claim({ confidence: 'unverified' }), claim()])
    expect(md).toContain('## Unverified')
    expect(md).toContain('1 claim(s)')
    expect(md).toContain('excluded from scripting')
    expect(render(grounded(), [claim()])).not.toContain('## Unverified')
  })

  it('writes italics with asterisks only, never underscores', () => {
    const md = render(grounded({ scenes: [scene()] }))
    expect(md).not.toMatch(/(^|\s)_\S/m)
  })

  it('is a pure function of its input', () => {
    const research = grounded({ scenes: [scene()] })
    expect(render(research, [claim()])).toBe(render(research, [claim()]))
  })
})

// ---------------------------------------------------------------------------
// Mock mode
// ---------------------------------------------------------------------------

describe('mock research', () => {
  const documents = mockCorpusDocuments()
  const textOf = (doc: number) => documents[doc - 1]!.text

  it('says in the dossier itself that nothing was researched', () => {
    // A mock dossier that reads plausibly is one somebody eventually approves by accident.
    expect(mockBrief(caseContext).summary).toMatch(/MOCK DOSSIER/)
    expect(mockBrief(caseContext).summary).toMatch(/No research was performed/)
  })

  it('gathers four documents of the kinds the checks need, each labelled mock', () => {
    expect(documents.map((document) => document.kind)).toEqual([
      'press-release',
      'reporting',
      'video',
      'regulator',
    ])
    for (const document of documents) expect(document.text.startsWith('MOCK DOCUMENT')).toBe(true)
    expect(textOf(3)).toMatch(/\[\d{2}:\d{2}\]/)
  })

  it('validates against the same schemas as real output', () => {
    const brief = parseBrief(JSON.stringify(mockBrief(caseContext)))
    expect(brief).toEqual(mockBrief(caseContext))
    expect(parseScenes(JSON.stringify({ scenes: mockScenes() }))).toEqual(mockScenes())
    expect(parseClaims(JSON.stringify({ claims: mockClaims() }))).toEqual(mockClaims())
    expect(parseAnswers(JSON.stringify(mockAnswers(brief)))).toEqual(mockAnswers(brief))
  })

  it('cites only the four mock documents', () => {
    const brief = mockBrief(caseContext)
    const cited = [
      ...brief.cast.flatMap((member) => (member.scene ? [member.scene.doc] : [])),
      ...brief.toldAlready.map((told) => told.doc),
      ...mockScenes().map((scene) => scene.doc),
      ...mockClaims().flatMap((claim) => [
        ...claim.supports.map((support) => support.doc),
        ...(claim.legal ? [claim.legal.doc] : []),
      ]),
      ...mockAnswers(brief).answers.flatMap((answer) => (answer.doc ? [answer.doc] : [])),
    ]
    expect(cited.length).toBeGreaterThan(0)
    for (const doc of cited) {
      expect(doc).toBeGreaterThanOrEqual(1)
      expect(doc).toBeLessThanOrEqual(documents.length)
    }
  })

  it('misses exactly one quote on purpose, so the e2e fixture parks at the gate', () => {
    const brief = mockBrief(caseContext)
    const quotes = [
      ...brief.cast.flatMap((member) => (member.scene ? [member.scene] : [])),
      ...brief.toldAlready,
      ...mockScenes(),
      ...mockClaims().flatMap((claim) => claim.supports),
    ]
    const missing = quotes.filter(({ doc, quote }) => !textOf(doc).includes(quote))
    expect(missing).toEqual([mockClaims()[1]!.supports[0]])
  })

  it('carries a figure series written as doc 1 prints it, a ruled status and a transcript scene', () => {
    const [, , figure, ruled] = mockClaims()
    expect(figure?.supports[0]?.doc).toBe(1)
    expect(figure?.series?.points).toHaveLength(2)
    for (const point of figure!.series!.points) expect(textOf(1)).toContain(point.asWritten)
    expect(ruled?.legal).toEqual({ status: 'ruled', date: '2019-02', doc: 4 })
    expect(mockClaims()[0]?.supports.map((support) => support.doc)).toEqual([2, 4])
    expect(mockScenes().some((scene) => documents[scene.doc - 1]?.kind === 'video')).toBe(true)
    expect(mockBrief(caseContext).toldAlready.map((told) => told.doc)).toEqual([3])
  })

  it('is deterministic', () => {
    expect(mockBrief(caseContext)).toEqual(mockBrief(caseContext))
    expect(mockCorpusDocuments()).toEqual(mockCorpusDocuments())
  })
})
