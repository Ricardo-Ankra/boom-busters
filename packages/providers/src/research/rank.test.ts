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
      doc('undated', 1, 10),
      doc('far', 1, 10, '2015-01-01'),
      doc('near', 1, 10, '2020-06'),
      doc('mid', 1, 10, '2018'),
    ]
    const { read } = rankCorpus(docs, { anchorDate: '2020-07-01' })
    expect(read.map((d) => d.id)).toEqual(['near', 'mid', 'far', 'undated'])
  })

  it('reads the reporting tier nearest the anchor and newest in turn, undated last', () => {
    const docs = [
      doc('undated', 2, 10),
      doc('newest', 2, 10, '2024-05-01'),
      doc('later', 2, 10, '2023-01-01'),
      doc('nearest', 2, 10, '2020-02-01'),
      doc('before', 2, 10, '2019-11-01'),
      doc('oldest', 2, 10, '2018-01-01'),
    ]
    const { read } = rankCorpus(docs, { anchorDate: '2020-01-01' })
    // Nearest: nearest, before, oldest, later, newest. Newest: newest, later, nearest, before, oldest.
    expect(read.map((d) => d.id)).toEqual([
      'nearest',
      'newest',
      'before',
      'later',
      'oldest',
      'undated',
    ])
  })

  it('reads court and regulator records newest first whatever the anchor, undated last', () => {
    const docs = [
      doc('undated', 5, 10),
      doc('near-anchor', 5, 10, '2014-12-01'),
      doc('newest', 5, 10, '2023-06-01'),
      doc('middle', 5, 10, '2016'),
    ]
    const { read } = rankCorpus(docs, { anchorDate: '2015-01-01' })
    expect(read.map((d) => d.id)).toEqual(['newest', 'middle', 'near-anchor', 'undated'])
  })

  it('reads pinned documents first in their tier, in the order given, and no earlier than their tier', () => {
    const docs = [
      doc('filing', 1, 10, '2020-06-01'),
      { ...doc('owner-undated', 1, 10), pinned: true },
      doc('filing-far', 1, 10, '2010-01-01'),
      { ...doc('owner-far', 1, 10, '2001-01-01'), pinned: true },
      { ...doc('pinned-reporting', 2, 10, '1990'), pinned: true },
      doc('reporting', 2, 10, '2020-07-01'),
    ]
    const { read } = rankCorpus(docs, { anchorDate: '2020-07-01' })
    expect(read.map((d) => d.id)).toEqual([
      'owner-undated',
      'owner-far',
      'filing',
      'filing-far',
      'pinned-reporting',
      'reporting',
    ])
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
