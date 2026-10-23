import { beforeEach, describe, expect, it } from 'vitest'
import type { ResearchClaim } from '@boom-busters/schemas'
import type { Repair } from '../prompts/repair'
import { mockAnswers, mockBrief, mockClaims, mockScenes } from '../prompts/dossier-mocks'
import type { CorpusDocument } from './corpus'
import { mockCorpusDocuments } from './mock-corpus'
import { groundResearch, type GroundInput } from './ground'

const docs: CorpusDocument[] = [
  {
    id: 'a',
    url: 'https://one.example.com/a',
    kind: 'reporting',
    title: null,
    publishedAt: null,
    text: 'The company reported revenue of $5 million in 2020 and $7 million in 2021 to investors.',
    archivedUrl: null,
    httpStatus: 200,
  },
  {
    id: 'b',
    url: 'https://two.example.org/b',
    kind: 'court',
    title: null,
    publishedAt: null,
    text: 'The court found that the company had misled investors about its revenue in 2021.',
    archivedUrl: null,
    httpStatus: 200,
  },
  {
    id: 'c',
    url: 'https://v.example.com/c',
    kind: 'video',
    title: null,
    publishedAt: null,
    text: '[00:00] Intro line.\n[01:10] The founder promised everything would be fine always.',
    archivedUrl: null,
    httpStatus: 200,
  },
]

const entity = {
  qid: null,
  titles: [],
  cik: null,
  ticker: null,
  website: null,
  people: [],
  unresolved: false,
  subject: null,
  sourceUrls: [],
}
let repairs: Repair[] = []
const note = (r: Repair) => repairs.push(r)
beforeEach(() => {
  repairs = []
})

function withClaims(claims: ResearchClaim[]): GroundInput {
  return {
    entity,
    brief: { ...mockBrief({ title: 't' } as never), cast: [], toldAlready: [] },
    scenes: [],
    claims,
    answers: [],
    documents: docs,
    corpus: { read: 3, unread: 0, failed: 0 },
  }
}

describe('groundResearch', () => {
  it('drops a support that cites a document not given and leaves the claim unverified', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'x'.repeat(20),
          supports: [{ doc: 99, quote: 'anything at all here' }],
          legal: null,
          series: null,
        },
      ]),
      note,
    )
    expect(out.claims[0]).toMatchObject({
      supports: [],
      sourceUrl: null,
      sourceType: 'other',
      confidence: 'unverified',
    })
    expect(repairs).toContainEqual({
      action: 'dropped',
      field: 'claim 1 support 1',
      reason: 'cites a document that was not given',
    })
  })

  it('folds ruled on a reporting document to alleged and notes it', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'The company misled investors about its revenue.',
          supports: [{ doc: 1, quote: 'reported revenue of $5 million in 2020' }],
          legal: { status: 'ruled', date: '2021', doc: 1 },
          series: null,
        },
        {
          text: 'The court ruled on it.',
          supports: [{ doc: 2, quote: 'had misled investors about its revenue' }],
          legal: { status: 'ruled', date: '2021', doc: 2 },
          series: null,
        },
      ]),
      note,
    )
    expect(out.claims[0]).toMatchObject({ legalStatus: 'alleged', legalStatusDocumentId: 'a' })
    expect(out.claims[1]).toMatchObject({ legalStatus: 'ruled', legalStatusDocumentId: 'b' })
    expect(repairs).toContainEqual({
      action: 'dropped',
      field: 'claim 1 legal status',
      reason: 'ruled needs a court or regulator document',
    })
  })

  describe('a verdict reported by the press', () => {
    const pressDocs: CorpusDocument[] = [
      {
        id: 'press',
        url: 'https://news.example.com/holmes',
        kind: 'reporting',
        title: null,
        publishedAt: '2022-01-04',
        text:
          'Elizabeth Holmes was convicted of defrauding investors by a federal jury in San Jose. ' +
          'In 2018 she was charged with wire fraud by federal prosecutors in California.',
        archivedUrl: null,
        httpStatus: 200,
      },
      {
        id: 'tape',
        url: 'https://v.example.com/holmes',
        kind: 'video',
        title: null,
        publishedAt: null,
        text: '[00:00] Intro.\n[00:40] The judge handed down the term to the founder in court.',
        archivedUrl: null,
        httpStatus: 200,
      },
      {
        id: 'filing',
        url: 'https://sec.example.gov/10k',
        kind: 'filing',
        title: null,
        publishedAt: null,
        text: 'The former chief executive was convicted on four counts, the company disclosed.',
        archivedUrl: null,
        httpStatus: 200,
      },
    ]
    const ruledOn = (doc: number, text: string, quote: string): ResearchClaim => ({
      text,
      supports: [{ doc, quote }],
      legal: { status: 'ruled', date: '2022-01', doc },
      series: null,
    })
    const ground = (claims: ResearchClaim[]) =>
      groundResearch({ ...withClaims(claims), documents: pressDocs }, note).claims.map(
        (claim) => claim.legalStatus,
      )

    it('keeps ruled when a support quote says "was convicted"', () => {
      expect(
        ground([
          ruledOn(
            1,
            'A federal jury decided against Holmes on fraud.',
            'Elizabeth Holmes was convicted of defrauding investors',
          ),
        ]),
      ).toEqual(['ruled'])
      expect(repairs).toEqual([])
    })

    it('folds ruled to alleged when the quote only says "was charged"', () => {
      expect(
        ground([
          ruledOn(
            1,
            'Prosecutors brought a wire fraud case against Holmes.',
            'she was charged with wire fraud by federal prosecutors',
          ),
        ]),
      ).toEqual(['alleged'])
      expect(repairs).toEqual([
        {
          action: 'dropped',
          field: 'claim 1 legal status',
          reason: 'ruled needs a court or regulator document',
        },
      ])
    })

    it('keeps ruled when the claim text carries a verdict word, in any case', () => {
      expect(
        ground([
          ruledOn(
            1,
            'Holmes was SENTENCED to eleven years in prison.',
            'she was charged with wire fraud by federal prosecutors',
          ),
          ruledOn(
            1,
            'Holmes Pleaded  Guilty to nothing and went to trial.',
            'she was charged with wire fraud by federal prosecutors',
          ),
        ]),
      ).toEqual(['ruled', 'ruled'])
    })

    it('reads a verdict word only as a whole phrase', () => {
      expect(
        ground([
          ruledOn(
            1,
            'Holmes refined her pitch and unbanned nothing.',
            'she was charged with wire fraud by federal prosecutors',
          ),
        ]),
      ).toEqual(['alleged'])
    })

    it('still folds ruled on a filing or a video, which are not reporting', () => {
      expect(
        ground([
          ruledOn(
            3,
            'The former chief executive was convicted on four counts.',
            'The former chief executive was convicted on four counts',
          ),
          ruledOn(
            2,
            'Holmes was sentenced to eleven years in prison.',
            'The judge handed down the term to the founder in court',
          ),
        ]),
      ).toEqual(['alleged', 'alleged'])
    })
  })

  it('finds quotes, computes confidence from two hosts and takes sourceUrl from the first support', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'Revenue was misreported.',
          supports: [
            { doc: 2, quote: 'had misled investors about its revenue' },
            { doc: 1, quote: 'reported revenue of $5 million in 2020' },
          ],
          legal: null,
          series: null,
        },
      ]),
      note,
    )
    expect(out.claims[0]).toMatchObject({
      confidence: 'sourced',
      sourceUrl: 'https://two.example.org/b',
      sourceType: 'court',
      legalStatus: 'none',
    })
    expect(out.claims[0]!.supports.map((s) => s.found)).toEqual([true, true])
  })

  it('drops a series point whose written number is not in the document and renders the rest', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'Revenue grew.',
          supports: [{ doc: 1, quote: 'reported revenue of $5 million in 2020' }],
          legal: null,
          series: {
            label: 'Revenue',
            unit: 'USD',
            currency: 'USD',
            points: [
              { at: '2020', value: 5e6, asWritten: '$5 million' },
              { at: '2021', value: 9e6, asWritten: '$9 million' },
            ],
          },
        },
      ]),
      note,
    )
    expect(out.claims[0]!.series!.points).toHaveLength(1)
    expect(out.claims[0]!.text).toBe('Revenue grew. Revenue (USD, USD): 2020 $5 million')
    expect(repairs).toContainEqual(
      expect.objectContaining({ action: 'dropped', field: 'claim 1 series point 2' }),
    )
  })

  it('nulls a series left with no points', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'Revenue grew.',
          supports: [{ doc: 1, quote: 'reported revenue of $5 million in 2020' }],
          legal: null,
          series: {
            label: 'Revenue',
            unit: 'USD',
            currency: null,
            points: [{ at: '2020', value: 1, asWritten: 'nothing numeric' }],
          },
        },
      ]),
      note,
    )
    expect(out.claims[0]).toMatchObject({ series: null, text: 'Revenue grew.' })
  })

  it('locates a scene in a transcript and marks a scene with a missing quote unplaced', () => {
    const input = withClaims([])
    input.scenes = [
      {
        when: 'Mock 2019',
        who: 'Founder',
        what: 'Promised things.',
        why: 'A high point here.',
        doc: 3,
        quote: 'The founder promised everything would be fine',
      },
      {
        when: 'Mock 2019',
        who: 'Founder',
        what: 'Promised things.',
        why: 'A high point here.',
        doc: 1,
        quote: 'a quote that is nowhere in the document',
      },
    ]
    const out = groundResearch(input, note)
    expect(out.research.scenes[0]!.ref).toMatchObject({
      documentId: 'c',
      found: true,
      locatorSeconds: 70,
    })
    expect(out.research.scenes[1]!.ref).toMatchObject({
      documentId: 'a',
      found: false,
      locatorSeconds: null,
    })
  })

  it('grounds the mock passes into the outcomes mock mode promises', () => {
    const documents = mockCorpusDocuments().map((d, i) => ({ ...d, id: `doc-${i + 1}` }))
    const brief = mockBrief({ title: 'Mockco' } as never)
    const out = groundResearch(
      {
        entity,
        brief,
        scenes: mockScenes(),
        claims: mockClaims(),
        answers: mockAnswers(brief).answers,
        documents,
        corpus: { read: 4, unread: 0, failed: 0 },
      },
      note,
    )
    const [sourced, unverified, figure, ruled] = out.claims
    expect(sourced).toMatchObject({ confidence: 'sourced' })
    expect(sourced!.supports.map((s) => s.found)).toEqual([true, true])
    expect(unverified).toMatchObject({ confidence: 'unverified' })
    expect(unverified!.supports[0]!.found).toBe(false)
    expect(figure!.series!.points).toHaveLength(2)
    expect(figure!.text).toContain(
      'Mock revenue (EUR, EUR): 2017 MOCK EUR 1,200,000,000; 2018 MOCK EUR 2,000,000,000',
    )
    expect(ruled).toMatchObject({ legalStatus: 'ruled', legalStatusDocumentId: 'doc-4' })
    expect(out.research.scenes[1]!.ref.locatorSeconds).toBe(65)
    expect(out.research.scenes[0]!.ref.found).toBe(true)
    expect(out.research.brief.toldAlready[0]!.ref.found).toBe(true)
    expect(repairs).toEqual([])
  })

  it('checks a series against the first kept support when the first listed one is out of range', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'Revenue grew.',
          supports: [
            { doc: 99, quote: 'a document that was never given' },
            { doc: 1, quote: 'reported revenue of $5 million in 2020' },
          ],
          legal: null,
          series: {
            label: 'Revenue',
            unit: 'USD',
            currency: null,
            points: [
              { at: '2020', value: 5e6, asWritten: '$5 million' },
              { at: '2021', value: 7e6, asWritten: '$7 million' },
            ],
          },
        },
      ]),
      note,
    )
    expect(repairs).toEqual([
      {
        action: 'dropped',
        field: 'claim 1 support 1',
        reason: 'cites a document that was not given',
      },
    ])
    expect(out.claims[0]!.supports).toHaveLength(1)
    expect(out.claims[0]!.supports[0]).toMatchObject({ documentId: 'a', rank: 1 })
    expect(out.claims[0]!.series!.points).toHaveLength(2)
    expect(out.claims[0]!.text).toBe(
      'Revenue grew. Revenue (USD): 2020 $5 million; 2021 $7 million',
    )
  })

  it('grounds a legal status citing a document not given to none and notes it', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'The court ruled on it.',
          supports: [{ doc: 2, quote: 'had misled investors about its revenue' }],
          legal: { status: 'ruled', date: '2020-06', doc: 99 },
          series: null,
        },
      ]),
      note,
    )
    expect(out.claims[0]).toMatchObject({
      legalStatus: 'none',
      legalStatusDate: null,
      legalStatusDocumentId: null,
    })
    expect(repairs).toEqual([
      {
        action: 'dropped',
        field: 'claim 1 legal status',
        reason: 'cites a document that was not given',
      },
    ])
  })

  it('keeps a stated none legal status with its date and document', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'No court has ruled on it.',
          supports: [{ doc: 2, quote: 'had misled investors about its revenue' }],
          legal: { status: 'none', date: '2001-03', doc: 2 },
          series: null,
        },
      ]),
      note,
    )
    expect(out.claims[0]).toMatchObject({
      legalStatus: 'none',
      legalStatusDate: '2001-03',
      legalStatusDocumentId: 'b',
    })
    expect(repairs).toEqual([])
  })

  it('grounds a cast scene and answers, dropping an answer that cites a document not given', () => {
    const input = withClaims([])
    input.brief = {
      ...input.brief,
      cast: [
        {
          name: 'The Founder',
          role: 'founder',
          wanted: 'Wanted investors to keep believing.',
          scene: { doc: 2, quote: 'had misled investors about its revenue' },
        },
      ],
    }
    input.answers = [
      { question: 'Who promised what, and when?', answer: 'The founder promised it all.', doc: 3 },
      { question: 'Where did the money go in the end?', answer: 'It went nowhere known.', doc: 42 },
    ]
    const out = groundResearch(input, note)
    expect(out.research.brief.cast[0]!.ref).toMatchObject({
      documentId: 'b',
      url: 'https://two.example.org/b',
      found: true,
    })
    expect(out.research.answers[0]!.ref).toMatchObject({ documentId: 'c', quote: null })
    expect(out.research.answers[1]!.ref).toBeNull()
    expect(repairs).toEqual([
      { action: 'dropped', field: 'answer 2', reason: 'cites a document that was not given' },
    ])
  })
  it('matches a series figure only on number boundaries', () => {
    const input = withClaims([
      {
        text: 'Revenue moved.',
        supports: [{ doc: 1, quote: 'filings show revenue in 2015 of' }],
        legal: null,
        series: {
          label: 'Revenue',
          unit: 'EUR',
          currency: 'EUR',
          points: [
            { at: '2015', value: 5, asWritten: '5' },
            { at: '2016', value: 1_900_000, asWritten: '€1,900,000' },
            { at: '2017', value: 1_900, asWritten: '1,900' },
          ],
        },
      },
    ])
    input.documents = [
      {
        ...docs[0]!,
        text: 'The filings show revenue in 2015 of €1,900,000 against costs in 2016.',
      },
    ]
    const out = groundResearch(input, note)
    // "5" sits inside "2015" only; "1,900" folds to "1 900", a whole-token prefix
    // of "1 900 000", which the boundary rule accepts.
    expect(out.claims[0]!.series!.points.map((p) => p.asWritten)).toEqual(['€1,900,000', '1,900'])
    expect(repairs).toContainEqual(
      expect.objectContaining({ action: 'dropped', field: 'claim 1 series point 1' }),
    )
  })

  it('takes the source from the first found support, else from support 1', () => {
    const out = groundResearch(
      withClaims([
        {
          text: 'Revenue was misreported.',
          supports: [
            { doc: 1, quote: 'a quote that is nowhere in the document' },
            { doc: 2, quote: 'had misled investors about its revenue' },
          ],
          legal: null,
          series: null,
        },
        {
          text: 'Nothing checks out.',
          supports: [
            { doc: 2, quote: 'a quote that is nowhere in the court record' },
            { doc: 1, quote: 'another quote that is nowhere at all' },
          ],
          legal: null,
          series: null,
        },
      ]),
      note,
    )
    expect(out.claims[0]).toMatchObject({
      sourceUrl: 'https://two.example.org/b',
      sourceType: 'court',
    })
    expect(out.claims[1]).toMatchObject({
      sourceUrl: 'https://two.example.org/b',
      sourceType: 'court',
      confidence: 'unverified',
    })
  })

  it('keeps a told-already beat only when its quote is placed in a video transcript', () => {
    const input = withClaims([])
    input.brief = {
      ...input.brief,
      toldAlready: [
        {
          beat: 'Videos say it would be fine.',
          doc: 3,
          quote: 'promised everything would be fine',
        },
        {
          beat: 'Reporting said revenue.',
          doc: 1,
          quote: 'reported revenue of $5 million in 2020',
        },
        { beat: 'A video line not said.', doc: 3, quote: 'a line the video never says at all' },
      ],
    }
    const out = groundResearch(input, note)
    expect(out.research.brief.toldAlready).toEqual([
      {
        beat: 'Videos say it would be fine.',
        ref: expect.objectContaining({ documentId: 'c', found: true, locatorSeconds: 70 }),
      },
    ])
    expect(repairs).toEqual([
      {
        action: 'dropped',
        field: 'told-already beat 2',
        reason: 'its quote is not found in a video transcript',
      },
      {
        action: 'dropped',
        field: 'told-already beat 3',
        reason: 'its quote is not found in a video transcript',
      },
    ])
  })
})
