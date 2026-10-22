import { describe, expect, it } from 'vitest'
import { rankCorpus, type RankableDocument } from './rank'

function doc(
  id: string,
  tier: RankableDocument['tier'],
  tokens: number,
  publishedAt: string | null = null,
  text = 'x',
): RankableDocument {
  return { id, kind: 'reporting', tier, tokens, publishedAt, text }
}

describe('rankCorpus', () => {
  it('gives each tier its share and rolls the unused share down', () => {
    const docs = [
      doc('t1a', 1, 5_000),
      doc('t2a', 2, 10_000),
      doc('t2b', 2, 10_000),
      doc('t2c', 2, 10_000),
      doc('t2d', 2, 10_000),
    ]
    const { read, unread } = rankCorpus(docs, { corpusTokens: 40_000 })
    expect(read.map((d) => d.id)).toEqual(['t1a', 't2a'])
    expect(read.map((d) => d.rank)).toEqual([1, 2])
    expect(unread).toHaveLength(3)
  })

  it('skips a document that does not fit and still reads a smaller later one', () => {
    const docs = [doc('big', 1, 9_000, '2024'), doc('small', 1, 1_000, '2023')]
    const { read, unread } = rankCorpus(docs, { corpusTokens: 20_000 })
    expect(read.map((d) => d.id)).toEqual(['small'])
    expect(unread.map((d) => d.id)).toEqual(['big'])
  })

  it('orders a tier by nearness to the anchor date, undated last', () => {
    const docs = [
      doc('undated', 2, 10),
      doc('far', 2, 10, '2015-01-01'),
      doc('near', 2, 10, '2020-06'),
      doc('mid', 2, 10, '2018'),
    ]
    const { read } = rankCorpus(docs, { anchorDate: '2020-07-01' })
    expect(read.map((d) => d.id)).toEqual(['near', 'mid', 'far', 'undated'])
  })

  it('orders newest first with undated last when there is no anchor', () => {
    const docs = [doc('old', 2, 10, '2010'), doc('undated', 2, 10), doc('new', 2, 10, '2022-03-04')]
    const { read } = rankCorpus(docs)
    expect(read.map((d) => d.id)).toEqual(['new', 'old', 'undated'])
  })

  it('cuts a document at a paragraph break and marks it truncated', () => {
    const text = `${'a'.repeat(30)}\n\n${'b'.repeat(30)}`
    const { read } = rankCorpus([doc('d', 1, 100, null, text)], { documentTokens: 10 })
    expect(read[0]?.text).toBe('a'.repeat(30))
    expect(read[0]?.truncated).toBe(true)
    expect(read[0]?.tokens).toBe(8)
  })

  it('leaves a short document whole', () => {
    const { read } = rankCorpus([doc('d', 1, 100, null, 'short')])
    expect(read[0]?.truncated).toBe(false)
    expect(read[0]?.text).toBe('short')
  })
})
