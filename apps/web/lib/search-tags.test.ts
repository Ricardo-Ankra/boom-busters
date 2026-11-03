import type { SearchBrief, SearchKeyword, SearchOutlier } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { searchTags } from './search-tags'

const keyword = (word: string): SearchKeyword => ({
  keyword: word,
  volume: 50,
  competition: 40,
  overall: 50,
  estimatedMonthlySearch: 1000,
  growthPct: 0,
})

const outlier = (id: string, tags: string[]): SearchOutlier => ({
  videoId: id,
  title: `Video ${id}`,
  channel: null,
  subscribers: null,
  views: null,
  breakoutScore: null,
  publishedAt: null,
  tags,
})

const brief = (over: Partial<SearchBrief> = {}): SearchBrief => ({
  subject: 'Wirecard',
  measuredAt: '2026-11-02T12:00:00.000Z',
  targetKeyword: keyword('wirecard scandal'),
  secondaryKeywords: [keyword('wirecard documentary'), keyword('markus braun trial')],
  searchedQuestions: [],
  outliers: [],
  titlePatterns: [],
  toldAlready: [],
  angleOptions: [],
  chosenAngle: null,
  formatKey: null,
  fit: null,
  ...over,
})

describe('searchTags', () => {
  it('lists the target and secondary keywords in brief order, then the cast', () => {
    expect(searchTags(brief(), ['Markus Braun', 'Jan Marsalek'])).toEqual([
      'wirecard scandal',
      'wirecard documentary',
      'markus braun trial',
      'Markus Braun',
      'Jan Marsalek',
    ])
  })

  it('takes an outlier tag only when two outliers carry it and it names the subject, a cast member or a year', () => {
    const tags = searchTags(
      brief({
        searchedQuestions: ['What happened at Wirecard in 2020?'],
        outliers: [
          outlier('a', [
            'wirecard fraud',
            'fraud',
            'braun arrest',
            'fintech 2019',
            'only once wirecard',
          ]),
          outlier('b', ['Wirecard Fraud', 'fraud', 'Braun Arrest', 'fintech 2020', 'bank']),
          outlier('c', ['bank', 'fintech 2020']),
        ],
      }),
      ['Markus Braun'],
    )
    // "wirecard fraud" (subject, two outliers), "braun arrest" (cast surname), "fintech 2020" (year, two outliers).
    // "fraud" and "bank" name nothing; "fintech 2019" and "only once wirecard" are on one outlier.
    expect(tags).toEqual([
      'wirecard scandal',
      'wirecard documentary',
      'markus braun trial',
      'wirecard fraud',
      'braun arrest',
      'fintech 2020',
      'Markus Braun',
    ])
  })

  it('no longer adds "business documentary" on its own', () => {
    const outliers = [
      outlier('a', ['Business Documentary']),
      outlier('b', ['business documentary']),
    ]
    expect(searchTags(brief({ outliers }), [])).toEqual([
      'wirecard scandal',
      'wirecard documentary',
      'markus braun trial',
    ])
  })

  it("takes a shared outlier tag the channel's keywords name, spelled as the outliers spell it", () => {
    const outliers = [
      outlier('a', ['Business Documentary']),
      outlier('b', ['business documentary']),
    ]
    expect(searchTags(brief({ outliers }), [], ['business documentary'])).toEqual([
      'wirecard scandal',
      'wirecard documentary',
      'markus braun trial',
      'Business Documentary',
    ])
    expect(searchTags(brief({ outliers }), [], ['Business Documentary'])).toContain(
      'Business Documentary',
    )
  })

  it('still wants two outliers for a keyword tag', () => {
    const outliers = [outlier('a', ['business documentary'])]
    expect(searchTags(brief({ outliers }), [], ['Business Documentary'])).not.toContain(
      'business documentary',
    )
  })

  it('counts a tag once per outlier, however often it repeats there', () => {
    expect(
      searchTags(
        brief({
          secondaryKeywords: [],
          outliers: [outlier('a', ['wirecard fraud', 'wirecard fraud'])],
        }),
        [],
      ),
    ).toEqual(['wirecard scandal'])
  })

  it('removes duplicates case-insensitively, keeping the first spelling', () => {
    expect(
      searchTags(
        brief({
          secondaryKeywords: [keyword('Wirecard Scandal'), keyword('markus braun trial')],
        }),
        ['MARKUS BRAUN TRIAL', 'Markus Braun'],
      ),
    ).toEqual(['wirecard scandal', 'markus braun trial', 'Markus Braun'])
  })

  it('keeps a keyword that carries a figure, as a tag, and drops one YouTube would refuse', () => {
    expect(
      searchTags(
        brief({
          targetKeyword: null,
          secondaryKeywords: [keyword('wirecard $2 billion fraud'), keyword('x'.repeat(101))],
        }),
        [],
      ),
    ).toEqual(['wirecard $2 billion fraud'])
  })

  it('puts a newline-bearing keyword on one line', () => {
    expect(
      searchTags(
        brief({ targetKeyword: keyword('wirecard\n scandal'), secondaryKeywords: [] }),
        [],
      ),
    ).toEqual(['wirecard scandal'])
  })

  it('is empty for an empty brief and no cast', () => {
    expect(searchTags(brief({ targetKeyword: null, secondaryKeywords: [] }), [])).toEqual([])
  })
})
