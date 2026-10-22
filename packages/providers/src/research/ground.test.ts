import { describe, expect, it } from 'vitest'
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

const entity = { qid: null, titles: [], cik: null, ticker: null, website: null }
let repairs: Repair[] = []
const note = (r: Repair) => repairs.push(r)

function withClaims(claims: ResearchClaim[]): GroundInput {
  repairs = []
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
          text: 'The court ruled on it.',
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
    repairs = []
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
})
