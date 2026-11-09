import { RESEARCH_PROFILES } from '@boom-busters/schemas'
import type { GroundedSupport, ResearchClaim } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Repair } from '../prompts/repair'
import type { CorpusDocument } from './corpus'
import { groundEvidence } from './evidence'

/** The science axis of spec 7.2, written out so the test does not wait on the profile's own. */
const PROFILE = {
  ...RESEARCH_PROFILES.science,
  evidence: {
    statuses: [
      { key: 'established', scriptLabel: 'ESTABLISHED FINDING', reviewLabel: 'Established' },
      { key: 'single_study', scriptLabel: 'ONE STUDY', reviewLabel: 'One study' },
      { key: 'contested', scriptLabel: 'CONTESTED', reviewLabel: 'Contested' },
    ],
    earned: {
      status: 'established',
      minScholarlyDocuments: 2,
      reviewWords: ['meta-analysis', 'meta-analyses', 'meta-analytic', 'systematic review'],
    },
    fallback: 'single_study',
  },
}

const doc = (id: string, kind: CorpusDocument['kind']): CorpusDocument => ({
  id,
  url: `https://${id}.example.com`,
  kind,
  title: null,
  publishedAt: null,
  text: 'text',
  archivedUrl: null,
  httpStatus: 200,
})

const documents = [doc('s1', 'scholarly'), doc('s2', 'scholarly'), doc('r1', 'reporting')]

const support = (documentId: string, quote: string, found = true): GroundedSupport => ({
  documentId,
  rank: 1,
  quote,
  found,
  offset: found ? 0 : null,
  locatorSeconds: null,
  url: `https://${documentId}.example.com`,
  archivedUrl: null,
})

const claim = (status: string, docNumber: number): ResearchClaim => ({
  text: 'The effect held in the original study.',
  supports: [{ doc: 1, quote: 'anything' }],
  legal: null,
  series: null,
  evidence: { status, doc: docNumber },
})

let repairs: Repair[] = []
const note = (r: Repair) => repairs.push(r)
beforeEach(() => {
  repairs = []
})

describe('groundEvidence', () => {
  it('keeps established on two found supports from two distinct scholarly documents', () => {
    const found = [
      { doc: documents[0]!, support: support('s1', 'it replicated') },
      { doc: documents[1]!, support: support('s2', 'it replicated again') },
    ]
    expect(groundEvidence(claim('established', 1), found, documents, PROFILE, note, 1)).toEqual({
      status: 'established',
      documentId: 's1',
    })
    expect(repairs).toEqual([])
  })

  it('keeps established on one scholarly support that says meta-analysis', () => {
    const found = [{ doc: documents[0]!, support: support('s1', 'a meta-analysis of 88 studies') }]
    expect(
      groundEvidence(claim('established', 1), found, documents, PROFILE, note, 1)?.status,
    ).toBe('established')
    expect(repairs).toEqual([])
  })

  it('lowers established on one scholarly support that says "was not replicated"', () => {
    const found = [{ doc: documents[0]!, support: support('s1', 'the effect was not replicated') }]
    expect(
      groundEvidence(claim('established', 1), found, documents, PROFILE, note, 2)?.status,
    ).toBe('single_study')
    expect(repairs).toHaveLength(1)
    expect(repairs[0]).toMatchObject({ action: 'dropped', field: 'claim 2 evidence status' })
    expect(JSON.stringify(repairs[0])).toContain('needs')
  })

  it('does not count a support whose quote was not found', () => {
    const found = [
      { doc: documents[0]!, support: support('s1', 'a', false) },
      { doc: documents[1]!, support: support('s2', 'b', false) },
    ]
    expect(
      groundEvidence(claim('established', 1), found, documents, PROFILE, note, 1)?.status,
    ).toBe('single_study')
  })

  it('does not count two supports from the same document twice', () => {
    const found = [
      { doc: documents[0]!, support: support('s1', 'a') },
      { doc: documents[0]!, support: support('s1', 'b') },
    ]
    expect(
      groundEvidence(claim('established', 1), found, documents, PROFILE, note, 1)?.status,
    ).toBe('single_study')
  })

  it('lets contested stand on a reporting document', () => {
    const found = [{ doc: documents[2]!, support: support('r1', 'critics disagree') }]
    expect(groundEvidence(claim('contested', 3), found, documents, PROFILE, note, 1)).toEqual({
      status: 'contested',
      documentId: 'r1',
    })
    expect(repairs).toEqual([])
  })

  it('gives null with a note when the evidence document is not in the corpus', () => {
    expect(groundEvidence(claim('contested', 9), [], documents, PROFILE, note, 4)).toBeNull()
    expect(repairs).toEqual([
      {
        action: 'dropped',
        field: 'claim 4 evidence',
        reason: 'cites a document that was not given',
      },
    ])
  })

  it('gives null for a claim with no evidence, or a profile with no axis', () => {
    expect(
      groundEvidence({ ...claim('contested', 1), evidence: null }, [], documents, PROFILE, note, 1),
    ).toBeNull()
    expect(
      groundEvidence(
        claim('contested', 1),
        [],
        documents,
        RESEARCH_PROFILES.investigation,
        note,
        1,
      ),
    ).toBeNull()
  })
})
