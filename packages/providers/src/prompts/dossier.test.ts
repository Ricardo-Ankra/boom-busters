import {
  DOSSIER_CLAIMS_PER_PASS,
  DOSSIER_QUOTE_MAX,
  DOSSIER_QUOTE_MIN_FOLDED,
  ValidationError,
} from '@boom-busters/schemas'
import type { CaseBrief, Scene } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'
import {
  buildAnswersRequest,
  buildBriefRequest,
  buildClaimsRequest,
  buildScenesRequest,
  parseAnswers,
  parseBrief,
  parseClaims,
  parseScenes,
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

/** A pass's own instructions, line breaks folded so a pinned sentence can wrap in the source. */
const asked = (request: LLMTaskRequest) =>
  (request.messages.at(-1)?.content ?? '').replace(/\s+/g, ' ')

describe('the research prompts', () => {
  it('puts the corpus in the first user message and marks it cacheable', () => {
    const request = buildClaimsRequest(caseContext, corpus, brief, scenes)
    expect(request.messages[0]?.content).toContain('[D1] reporting')
    expect(request.cacheablePrefixMessages).toBe(1)
  })

  it('sends all four passes the same system prompt and corpus message, so the corpus is cached once', () => {
    const first =
      'Case: Enron\nCategory: collapse\nAngle to pursue: The auditors, not the traders.' +
      `\n\nDocuments, numbered. Cite them by number.\n\n${corpus}`
    const [system] = requests().map((request) => request.system)
    for (const request of requests()) {
      expect(request.task).toBe('research')
      expect(request.system).toBe(system)
      expect(request.messages[0]).toEqual({ role: 'user', content: first })
      expect(request.cacheablePrefixMessages).toBe(1)
      // Each pass ends on its own instructions, never on the corpus.
      expect(request.messages.length).toBeGreaterThan(1)
      expect(request.messages.at(-1)?.role).toBe('user')
    }
    expect(system).toMatch(/in the final message/)
  })

  it('holds every pass to the documents in front of it', () => {
    for (const request of requests()) {
      expect(request.system.replace(/\s+/g, ' ')).toContain(
        'Write only what the documents in front of you say. A fact you remember but cannot ' +
          'quote from a document is an open question, not a claim.',
      )
    }
  })

  it('gives each pass its output budget', () => {
    expect(requests().map((request) => request.maxTokens)).toEqual([
      outputBudget(6_000),
      outputBudget(10_000),
      outputBudget(12_000),
      outputBudget(10_000),
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
    const brief_ = asked(buildBriefRequest(caseContext, corpus))
    expect(brief_).toContain('"wanted"')
    expect(brief_).toContain('"toldAlready"')
    expect(brief_).toMatch(/ONLY from documents of kind `video`/)
  })

  it('asks the scenes pass for moments in the story, not a legal chronology', () => {
    const scenes_ = asked(buildScenesRequest(caseContext, corpus, brief))
    expect(scenes_).toMatch(/what was said or done/)
    expect(scenes_).toMatch(/why it matters to the arc/)
    expect(scenes_).toMatch(/not a legal chronology/)
  })

  it('asks every quoting pass for a quote long enough for the check to find', () => {
    const findable = `a full clause of at least ${DOSSIER_QUOTE_MIN_FOLDED} letters and digits`
    for (const request of requests()) expect(asked(request)).toContain(findable)
    expect(asked(buildScenesRequest(caseContext, corpus, brief))).toContain('shortest span')
    expect(asked(buildBriefRequest(caseContext, corpus))).toContain('shortest span')
  })

  it('pins the quote, legal status and figure rules in the claims and answers passes', () => {
    for (const request of requests().slice(2)) {
      const text = asked(request)
      expect(text).toContain(
        '`quote` is the shortest span of the document that proves the claim, copied exactly, ' +
          'usually under 120 characters and never over 300',
      )
      expect(text).toContain(
        '`legal.status` is `ruled` only when a court or regulator document in the list says ' +
          'so; `alleged` when a filing, complaint or report makes the allegation; `none` otherwise',
      )
      expect(text).toContain(
        'a figure claim carries `series` with `asWritten` copied as the document prints the number',
      )
      // The two cases the pinned definition leaves open, said outright.
      expect(text).toContain('`legal` is null for a plain fact with no wrongdoing in it')
      expect(text).toMatch(/`none` is for a claim about alleged or possible wrongdoing/)
      // "Strongest first" cannot override the document the series check reads.
      expect(text).toContain(
        "A figure claim's first support is the document that prints the numbers",
      )
    }
  })

  it('asks the claims pass for at most a pass worth of claims', () => {
    expect(asked(buildClaimsRequest(caseContext, corpus, brief, scenes))).toContain(
      `Limits (the app checks them): 1 to ${DOSSIER_CLAIMS_PER_PASS} claims;`,
    )
  })

  it('puts the open questions to the answers pass, verbatim and numbered', () => {
    // Numbered because the number is the join key (decision 203).
    const request = buildAnswersRequest(caseContext, corpus, brief, scenes)
    expect(request.messages.at(-1)?.content).toContain('1. What did the board know in 1999?')
    expect(asked(request)).toMatch(/`index` is the question's number/)
    expect(asked(request)).toMatch(/set `answer` to null/)
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

  it('leaves the corpus message alone on every pass, the brief included', () => {
    for (const request of requests()) {
      const noted = withNote(request, 'Lead with the auditors.')
      expect(noted.messages[0]).toEqual(request.messages[0])
      expect(
        noted.messages
          .at(-1)
          ?.content.endsWith('The human asks for changes: Lead with the auditors.'),
      ).toBe(true)
    }
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

  it('turns a none status with no usable date or document into no legal question, noted', () => {
    const { notes, note } = collect()
    const parsed = parseClaims(
      JSON.stringify({
        claims: [
          { ...CLAIM, legal: { status: 'none', date: 'early 2001', doc: 1 } },
          { ...CLAIM, legal: { status: 'none', date: '2001-03', doc: null } },
          { ...CLAIM, legal: { status: 'none', date: '2001-03', doc: 2 } },
        ],
      }),
      note,
    )
    expect(parsed.map((claim) => claim.legal)).toEqual([
      null,
      null,
      { status: 'none', date: '2001-03', doc: 2 },
    ])
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'the legal status of claim 1',
        reason: 'it named no usable date or document',
      },
      {
        action: 'dropped',
        field: 'the legal status of claim 2',
        reason: 'it named no usable date or document',
      },
    ])
  })

  it('drops a ruled or alleged claim whose date or document is unusable, keeping the rest', () => {
    // Keeping the claim without its status would let the script narrate an
    // allegation as plain fact; refusing would re-charge the whole pass.
    const { notes, note } = collect()
    const parsed = parseClaims(
      JSON.stringify({
        claims: [
          { ...CLAIM, legal: { status: 'ruled', date: 'May 2006', doc: 4 } },
          { ...CLAIM, legal: { status: 'alleged', date: '2002', doc: 0 } },
          { ...CLAIM, legal: { status: 'alleged', date: '2002-01-17', doc: 3 } },
        ],
      }),
      note,
    )
    expect(parsed.map((claim) => claim.legal)).toEqual([
      { status: 'alleged', date: '2002-01-17', doc: 3 },
    ])
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'claim 1',
        reason: 'its legal date was not YYYY, YYYY-MM or YYYY-MM-DD',
      },
      { action: 'dropped', field: 'claim 2', reason: 'its legal status named no document' },
    ])
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
