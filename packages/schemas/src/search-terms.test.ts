import { describe, expect, it } from 'vitest'
import type { SearchKeyword } from './search-brief'
import {
  SEARCHED_TERMS_MAX,
  classifySearchTerms,
  hasDiacritic,
  isTitleShaped,
  splitSearchTerms,
} from './search-terms'

const STELLANTIS: Array<[string, 'keyword' | 'title' | 'other-language']> = [
  ['stellantis is losing everything: jeep, dodge & fiat on the brink', 'title'],
  ['a stellantis está perdendo tudo: jeep, dodge e fiat à beira do abismo', 'other-language'],
  ['stellantis is falling apart — jeep, dodge & chrysler owners should be worried', 'title'],
  ['stellantis lo está perdiendo todo: jeep, dodge y fiat al borde del abismo', 'other-language'],
  ['stellantis is losing everything across the uk: vauxhall, peugeot & fiat on the brink', 'title'],
  ['jeep made billions. then stellantis happened.', 'title'],
  ['stellantis is losing everything', 'title'],
  [
    'stellantis lo está perdiendo todo en méxico: jeep, dodge y fiat al borde del abismo',
    'other-language',
  ],
  ['stellantis lo está perdiendo todo: jeep, dodge y fiat, al borde del abismo', 'other-language'],
  ['leapmotor stellantis', 'keyword'],
]

const row = (keyword: string, estimatedMonthlySearch: number | null): SearchKeyword => ({
  keyword,
  volume: null,
  competition: null,
  overall: null,
  estimatedMonthlySearch,
  growthPct: null,
})

describe('classifySearchTerms', () => {
  it('files the Stellantis rows as the worked example does', () => {
    const kinds = classifySearchTerms(STELLANTIS.map(([t]) => t))
    for (const [term, kind] of STELLANTIS) {
      expect(kinds.get(term.trim().toLowerCase()), term).toBe(kind)
    }
  })

  it('treats a plain copy of a punctuated title as a title', () => {
    const plain = 'jeep made billions then stellantis happened'
    const kinds = classifySearchTerms([plain, 'jeep made billions. then stellantis happened.'])
    expect(kinds.get(plain)).toBe('title')
  })

  it('keeps a seven-word search as a keyword', () => {
    const t = 'sears holdings prairie stone hoffman estates headquarters'
    expect(classifySearchTerms([t]).get(t)).toBe('keyword')
  })

  it('does not treat a hyphen as punctuation', () => {
    const t = 'wework co-founder adam neumann'
    expect(isTitleShaped(t)).toBe(false)
    expect(classifySearchTerms([t]).get(t)).toBe('keyword')
  })

  it('treats nine words as a title', () => {
    expect(isTitleShaped('one two three four five six seven eight nine')).toBe(true)
    expect(isTitleShaped('one two three four five six seven eight')).toBe(false)
  })

  it('needs three words for the prefix rule', () => {
    const kinds = classifySearchTerms(['stellantis: the fall', 'stellantis'])
    expect(kinds.get('stellantis')).toBe('keyword')
  })

  it('matches the prefix on whole words', () => {
    const kinds = classifySearchTerms([
      'stellantis is losing everything: jeep',
      'stellantis is losing ever',
    ])
    expect(kinds.get('stellantis is losing ever')).toBe('keyword')
  })

  it('files a title in another language as other language', () => {
    const t = 'o fim da fiat: a história'
    expect(isTitleShaped(t)).toBe(true)
    expect(hasDiacritic(t)).toBe(true)
    expect(classifySearchTerms([t]).get(t)).toBe('other-language')
  })

  it('only counts the listed diacritics, in either case', () => {
    expect(hasDiacritic('ÁRBOL')).toBe(true)
    expect(hasDiacritic('Stellantis')).toBe(false)
  })
})

describe('splitSearchTerms', () => {
  it('keeps keywords in input order and sorts the rest by searches, nulls last', () => {
    const rows = [
      row('leapmotor stellantis', 8167),
      row('stellantis is losing everything: jeep', 109212),
      row('stellantis is losing everything', 52004),
      row('jeep made billions. then it ended.', null),
      row('stellantis jeep', 10),
      row('stellantis lo está perdiendo todo: jeep', 9337),
      row('a stellantis está perdendo tudo', 7261),
      row('stellantis: the end!', 7000),
    ]
    const out = splitSearchTerms(rows)
    expect(out.keywords.map((r) => r.keyword)).toEqual(['leapmotor stellantis', 'stellantis jeep'])
    expect(out.searchedTitles.map((r) => r.estimatedMonthlySearch)).toEqual([
      109212,
      52004,
      7000,
      null,
    ])
    expect(out.otherLanguages.map((r) => r.estimatedMonthlySearch)).toEqual([9337, 7261])
  })

  it('sorts titles by monthly searches, nulls last, at most ten', () => {
    const rows = Array.from({ length: 14 }, (_, i) => row(`title number ${i}: x`, i * 100))
    rows.push(row('title without figure: x', null))
    const out = splitSearchTerms(rows)
    expect(SEARCHED_TERMS_MAX).toBe(10)
    expect(out.searchedTitles).toHaveLength(10)
    expect(out.searchedTitles[0]!.estimatedMonthlySearch).toBe(1300)
    expect(out.searchedTitles.some((r) => r.estimatedMonthlySearch === null)).toBe(false)
  })
})
