import { describe, expect, it } from 'vitest'
import type { DocumentSource, EntryEvidence, Person, PrimaryDocument } from '../types'
import { gates } from './gates'

const T = '2020-03-15'

function evidence(over: Partial<EntryEvidence> = {}): EntryEvidence {
  return {
    entry: {
      qid: 'Q1',
      enTitle: 'Apple',
      query: 'Apple',
      sitelinks: {},
      tags: [],
      country: null,
      cik: null,
    },
    asOf: T,
    enMonthly: [],
    worldMonthly: [],
    enDaily: [],
    search: null,
    channels: {},
    documents: [],
    people: [],
    tagsAtT: [],
    ...over,
  }
}

function docs(
  count: number,
  over: Partial<PrimaryDocument> = {},
  source: DocumentSource = 'courtlistener',
): PrimaryDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.gov/doc-${i}`,
    title: `Document ${i}`,
    source,
    datedAt: '2019-01-01',
    ...over,
    ...(over.url ? { url: `${over.url}-${i}` } : {}),
  }))
}

function person(over: Partial<Person> = {}): Person {
  return { qid: 'P1', name: 'A Person', living: true, convicted: false, ...over }
}

describe('paper trail levels', () => {
  it.each([
    [0, 'none'],
    [1, 'thin'],
    [2, 'thin'],
    [3, 'enough'],
    [9, 'enough'],
    [10, 'strong'],
  ] as const)('%i documents is %s', (n, level) => {
    const g = gates(evidence({ documents: docs(n) }), 'downfall')
    expect(g.paperTrail).toBe(level)
    expect(g.documentCount).toBe(n)
  })

  it('a document dated on or after T does not count', () => {
    const documents = [
      ...docs(1),
      { url: 'https://a.gov/on-t', title: 't', source: 'edgar', datedAt: T },
      { url: 'https://a.gov/after', title: 't', source: 'edgar', datedAt: '2021-01-01' },
      { url: 'https://a.gov/undated', title: 't', source: 'edgar', datedAt: null },
    ] satisfies PrimaryDocument[]
    expect(gates(evidence({ documents }), 'success').documentCount).toBe(2)
  })

  it('the same URL from two sources counts once', () => {
    const documents = [...docs(1, {}, 'courtlistener'), ...docs(1, {}, 'sec-litigation')]
    expect(gates(evidence({ documents }), 'downfall').documentCount).toBe(1)
  })
})

describe('legal flag', () => {
  it('downfall with an AAER is adjudicated', () => {
    const documents = [...docs(2), ...docs(1, { url: 'https://sec.gov/aaer' }, 'sec-aaer')]
    expect(gates(evidence({ documents }), 'downfall').legal).toBe('adjudicated')
  })

  it('an AAER dated on or after T does not make a case adjudicated', () => {
    const documents = [
      ...docs(2),
      ...docs(1, { url: 'https://sec.gov/aaer', datedAt: T }, 'sec-aaer'),
    ]
    expect(gates(evidence({ documents }), 'downfall').legal).toBe('alleged')
  })

  it('downfall with a convicted person is adjudicated', () => {
    const g = gates(evidence({ people: [person({ convicted: true })] }), 'downfall')
    expect(g.legal).toBe('adjudicated')
  })

  it('alleged, living, thin is killed with the exact reason', () => {
    const g = gates(evidence({ documents: docs(1), people: [person()] }), 'downfall')
    expect(g.legal).toBe('alleged')
    expect(g.livingPeople).toBe(1)
    expect(g.kill).toBe('legal: alleged, living people named, thin record')
  })

  it('alleged, living, enough is flagged, not killed', () => {
    const g = gates(evidence({ documents: docs(3), people: [person()] }), 'downfall')
    expect(g.legal).toBe('alleged')
    expect(g.kill).toBeNull()
  })

  it('alleged with no living people and a thin record is not killed', () => {
    const g = gates(
      evidence({ documents: docs(1), people: [person({ living: false })] }),
      'downfall',
    )
    expect(g.livingPeople).toBe(0)
    expect(g.kill).toBeNull()
  })

  it('success with living founders and no EDGAR filing is self-reported', () => {
    const g = gates(evidence({ documents: docs(3), people: [person()] }), 'success')
    expect(g.legal).toBe('self-reported')
  })

  it('success with an EDGAR filing is clear', () => {
    const documents = docs(3, { url: 'https://sec.gov/10k' }, 'edgar')
    expect(gates(evidence({ documents, people: [person()] }), 'success').legal).toBe('clear')
  })

  it('success with no living people is clear', () => {
    expect(gates(evidence({ documents: docs(3) }), 'success').legal).toBe('clear')
  })

  it('success never gets the legal kill, even thin with living people', () => {
    const g = gates(evidence({ documents: docs(1), people: [person()] }), 'success')
    expect(g.kill).toBeNull()
  })
})

describe('kill', () => {
  it('paper trail none is killed with its own reason, in either lane', () => {
    for (const lane of ['downfall', 'success'] as const) {
      const g = gates(evidence({ people: [person()] }), lane)
      expect(g.paperTrail).toBe('none')
      expect(g.kill).toBe('not enough public record')
    }
  })
})
