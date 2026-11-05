import { describe, expect, test } from 'vitest'
import {
  CASE_RESEARCH_CREDITS,
  caseResearchCredits,
  CaseResearchJobSchema,
  SEARCH_BRIEF_STALE_DAYS,
  SearchBriefSchema,
  briefDemandNotes,
  briefIsStale,
  caseResearchJobIsRunning,
  chooseTargetKeyword,
  keywordHasFigure,
  maskFigures,
  searchBriefLine,
  type SearchBrief,
  type SearchKeyword,
} from './search-brief'

const kw = (
  keyword: string,
  overall: number | null,
  extra: Partial<SearchKeyword> = {},
): SearchKeyword => ({
  keyword,
  volume: null,
  competition: null,
  overall,
  estimatedMonthlySearch: null,
  growthPct: null,
  ...extra,
})

const NOW = new Date('2026-11-02T12:00:00.000Z')

function outlier(i: number, views: number, breakoutScore: number) {
  return {
    videoId: `v${i}`,
    title: `Video ${i}`,
    channel: null,
    subscribers: null,
    views,
    breakoutScore,
    publishedAt: null,
    tags: [],
  }
}

function fixture(over: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'WeWork',
    measuredAt: NOW.toISOString(),
    targetKeyword: kw('wework documentary', 63, { volume: 64, competition: 38 }),
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [
      outlier(1, 20000, 5),
      outlier(2, 172000, 40.4),
      outlier(3, 90000, 12),
      outlier(4, 1000, 2),
      outlier(5, 3000, 3),
      outlier(6, 4000, 4),
    ],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [],
    chosenAngle: null,
    formatKey: null,
    fit: null,
    ...over,
  }
}

describe('keywordHasFigure', () => {
  test('true for digits and currency amounts', () => {
    expect(keywordHasFigure('how wework went from $47 billion to bankruptcy')).toBe(true)
    expect(keywordHasFigure('wework 2019')).toBe(true)
    expect(keywordHasFigure('€1.9 billion')).toBe(true)
    expect(keywordHasFigure('R5 million')).toBe(true)
  })
  test('false without a figure', () => {
    expect(keywordHasFigure('wework documentary')).toBe(false)
    expect(keywordHasFigure('Rise and fall of wework')).toBe(false)
  })
})

describe('maskFigures', () => {
  test('replaces a figure run', () => {
    expect(maskFigures('how wework went from $47 billion to bankruptcy')).toBe(
      'how wework went from {figure} to bankruptcy',
    )
  })
  test('leaves a phrase with no figure unchanged', () => {
    expect(maskFigures('wework documentary')).toBe('wework documentary')
  })
})

describe('chooseTargetKeyword', () => {
  const recon = [
    kw('wework documentary', 63),
    kw('the rise and fall of wework', 50),
    kw('how wework went from $47 billion to bankruptcy', 70),
  ]
  test('excludes figure rows despite a higher score', () => {
    expect(chooseTargetKeyword(recon, 'WeWork')?.keyword).toBe('wework documentary')
  })
  test('breaks an overall tie toward a documentary search naming the subject', () => {
    const rows = [kw('wework office', 60), kw('what happened to wework', 60)]
    expect(chooseTargetKeyword(rows, 'WeWork')?.keyword).toBe('what happened to wework')
    expect(chooseTargetKeyword([...rows].reverse(), 'WeWork')?.keyword).toBe(
      'what happened to wework',
    )
  })
  test('null when every row carries a figure or the list is empty', () => {
    expect(chooseTargetKeyword([kw('wework 2019', 80), kw('$47 billion', 70)], 'WeWork')).toBeNull()
    expect(chooseTargetKeyword([], 'WeWork')).toBeNull()
  })
})

describe('briefDemandNotes', () => {
  test('summarises the target keyword and the best outlier', () => {
    expect(briefDemandNotes(fixture())).toBe(
      'wework documentary: 64 volume, competition 38; 6 winning videos, best 172,000 views at 40x',
    )
  })
  test('says so with no target keyword', () => {
    expect(briefDemandNotes(fixture({ targetKeyword: null }))).toBe(
      'No searched keyword measured; 6 winning videos',
    )
  })
  test('says "video" for exactly one winner', () => {
    const one = fixture({ outliers: fixture().outliers.slice(0, 1) })
    expect(briefDemandNotes(one)).toContain('; 1 winning video,')
    expect(briefDemandNotes({ ...one, targetKeyword: null })).toBe(
      'No searched keyword measured; 1 winning video',
    )
  })
  test('keeps the plural for none', () => {
    expect(briefDemandNotes(fixture({ outliers: [], targetKeyword: null }))).toBe(
      'No searched keyword measured; 0 winning videos',
    )
  })
})

describe('briefIsStale', () => {
  const day = 86_400_000
  test('false at 30 days, true at 31', () => {
    expect(SEARCH_BRIEF_STALE_DAYS).toBe(30)
    const at = (d: number) =>
      fixture({ measuredAt: new Date(NOW.getTime() - d * day).toISOString() })
    expect(briefIsStale(at(30), NOW)).toBe(false)
    expect(briefIsStale(at(31), NOW)).toBe(true)
  })
})

describe('schemas', () => {
  test('SearchBriefSchema accepts the fixture and refuses a fourth angle option', () => {
    expect(SearchBriefSchema.parse(fixture()).subject).toBe('WeWork')
    const angle = {
      angle: 'The collapse told through the people who signed the leases',
      keyword: 'wework documentary',
      answers: [],
      gap: 'No one covers the landlords',
    }
    expect(() =>
      SearchBriefSchema.parse(fixture({ angleOptions: [angle, angle, angle] })),
    ).not.toThrow()
    expect(() =>
      SearchBriefSchema.parse(fixture({ angleOptions: [angle, angle, angle, angle] })),
    ).toThrow()
  })
  test('CaseResearchJobSchema parses a job without heartbeatAt', () => {
    const job = CaseResearchJobSchema.parse({
      state: 'running',
      current: null,
      error: null,
      startedAt: NOW.toISOString(),
      subject: 'WeWork',
    })
    expect(caseResearchJobIsRunning(job, NOW)).toBe(true)
    expect(caseResearchJobIsRunning(job, new Date(NOW.getTime() + 31 * 60_000))).toBe(false)
    expect(caseResearchJobIsRunning({ ...job, state: 'done' }, NOW)).toBe(false)
    expect(CASE_RESEARCH_CREDITS).toBe(20)
  })
})

describe('searchBriefLine', () => {
  test('collapses every kind of whitespace, trims and caps', () => {
    expect(searchBriefLine('  what\n\n did\tit \r\n do?  ')).toBe('what did it do?')
    expect(searchBriefLine('a'.repeat(300))).toHaveLength(200)
    expect(searchBriefLine('abc def', 5)).toBe('abc d')
    expect(searchBriefLine(' \n ')).toBe('')
  })
})

describe('a brief and its format', () => {
  test('a stored brief without formatKey and fit parses with both null', () => {
    const { formatKey: _f, fit: _fit, ...stored } = fixture()
    const parsed = SearchBriefSchema.parse(stored)
    expect(parsed.formatKey).toBeNull()
    expect(parsed.fit).toBeNull()
  })

  test('a brief keeps its format key and fit', () => {
    const fit = { inScope: true, pillarKey: 'con', reason: 'A collapse the channel covers.' }
    const parsed = SearchBriefSchema.parse(fixture({ formatKey: 'sleep', fit }))
    expect(parsed.formatKey).toBe('sleep')
    expect(parsed.fit).toEqual(fit)
  })

  test('the estimate is 20 credits, and 25 with a format seed', () => {
    expect(caseResearchCredits(false)).toBe(20)
    expect(caseResearchCredits(true)).toBe(25)
  })
})

describe('chooseTargetKeyword and titles', () => {
  test('never picks a title as the target', () => {
    const rows = [
      kw('stellantis is losing everything: jeep, dodge & fiat on the brink', 75),
      kw('a stellantis está perdendo tudo: jeep, dodge e fiat à beira do abismo', 73),
      kw('stellantis is falling apart — jeep, dodge & chrysler owners should be worried', 70),
      kw('stellantis lo está perdiendo todo: jeep, dodge y fiat al borde del abismo', 68),
      kw(
        'stellantis is losing everything across the uk: vauxhall, peugeot & fiat on the brink',
        68,
      ),
      kw('jeep made billions. then stellantis happened.', 66),
      kw('stellantis is losing everything', 65),
      kw('stellantis lo está perdiendo todo en méxico: jeep, dodge y fiat al borde del abismo', 65),
      kw('stellantis lo está perdiendo todo: jeep, dodge y fiat, al borde del abismo', 64),
      kw('leapmotor stellantis', 63),
    ]
    expect(chooseTargetKeyword(rows, 'Stellantis')?.keyword).toBe('leapmotor stellantis')
  })
})
