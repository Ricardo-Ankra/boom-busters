import { describe, expect, test } from 'vitest'
import { SearchBriefSchema, type SearchBrief } from './search-brief'
import { matchTermDeterministic, normaliseTerm, researchKeywords } from './search-terms-match'

const kw = (keyword: string) => ({
  keyword,
  volume: null,
  competition: null,
  overall: null,
  estimatedMonthlySearch: null,
  growthPct: null,
})

function brief(over: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'WeWork Pune',
    measuredAt: '2026-11-02T12:00:00.000Z',
    targetKeyword: kw('wework pune collapse'),
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
    ...over,
  } as SearchBrief
}

const angle = (keyword: string) => ({
  angle: 'An angle that is long enough to pass',
  keyword,
  answers: [],
  gap: '',
})

describe('matchTermDeterministic', () => {
  const keywords = { target: 'wework pune collapse', researched: [] }

  test('matches reordered, accented and dated forms of the target', () => {
    for (const term of [
      'Collapse of WeWork Pune',
      'wework pune collapse 2024',
      'WeWork Pune collapse!',
    ]) {
      expect(matchTermDeterministic(term, keywords)).toEqual({
        bucket: 'target',
        keyword: 'wework pune collapse',
      })
    }
    expect(matchTermDeterministic('wework india', keywords)).toBeNull()
  })

  test('matches a researched keyword when the target does not', () => {
    const k = { target: 'wework pune collapse', researched: ['adam neumann'] }
    expect(matchTermDeterministic('adam neumann wework story', k)).toEqual({
      bucket: 'researched',
      keyword: 'adam neumann',
    })
  })

  test('keeps accents for a language whose rule keeps them', () => {
    const k = { target: 'fundação', researched: [] }
    expect(matchTermDeterministic('fundacao', k, 'pt')).toBeNull()
    expect(matchTermDeterministic('fundação', k, 'pt')).not.toBeNull()
    expect(matchTermDeterministic('fundacao', k, 'en')).not.toBeNull()
  })

  test('drops english stop words only for english', () => {
    expect(normaliseTerm('the fall of rome', 'en')).toEqual(['fall', 'rome'])
    expect(normaliseTerm('the fall of rome', 'pt')).toEqual(['fall', 'of', 'rome', 'the'])
  })

  test('never matches against an empty keyword', () => {
    const k = { target: 'what is the', researched: ['of the', ''] }
    expect(matchTermDeterministic('what is the story of the fall', k)).toBeNull()
  })

  test('folds plurals and years', () => {
    expect(normaliseTerm('Banks failures 1999 class', 'en')).toEqual(['bank', 'class', 'failure'])
  })
})

describe('researchKeywords', () => {
  test('takes the chosen angle, else the recommended one, and removes the target', () => {
    const base = {
      secondaryKeywords: [kw('adam neumann'), kw('WeWork Pune Collapse'), kw('Adam Neumann ')],
      searchedQuestions: ['why did wework fail'],
      angleOptions: [angle('first angle kw'), angle('second angle kw')],
    }
    const chosen = researchKeywords(brief({ ...base, chosenAngle: 1, recommendedAngle: 0 }))
    expect(chosen).toEqual({
      target: 'wework pune collapse',
      researched: ['adam neumann', 'why did wework fail', 'second angle kw'],
    })
    const recommended = researchKeywords(brief({ ...base, recommendedAngle: 0 }))
    expect(recommended.researched.at(-1)).toBe('first angle kw')
    expect(researchKeywords(brief({ ...base })).researched).toHaveLength(2)
    expect(researchKeywords(brief({ targetKeyword: null })).target).toBeNull()
  })

  test('the fixture is a valid brief shape', () => {
    expect(SearchBriefSchema.safeParse(brief()).success).toBe(true)
  })
})
