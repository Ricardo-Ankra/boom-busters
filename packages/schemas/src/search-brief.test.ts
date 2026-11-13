import { describe, expect, test } from 'vitest'
import {
  CASE_RESEARCH_CREDITS,
  SECONDARY_KEYWORDS_MAX,
  briefPhrases,
  exactPhrases,
  phraseKey,
  caseResearchCredits,
  CaseResearchJobSchema,
  SEARCH_BRIEF_STALE_DAYS,
  SearchBriefSchema,
  StoredSearchBriefSchema,
  WEAK_TARGET_OVERALL,
  angleDemand,
  angleIsChosen,
  briefNeedsResearch,
  upgradeSearchBrief,
  briefDemandNotes,
  briefIsStale,
  caseResearchJobIsRunning,
  chooseTargetKeyword,
  pickTargetCandidates,
  keywordHasFigure,
  maskFigures,
  searchBriefLine,
  type SearchBrief,
  type SearchKeyword,
  pendingNicheJob,
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
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: null,
    recommendationReason: null,
    ownAngle: false,
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
  test('breaks an overall tie toward the row naming the subject, then the most searches', () => {
    const rows = [kw('office space', 60), kw('wework office', 60)]
    expect(chooseTargetKeyword(rows, 'WeWork')?.keyword).toBe('wework office')
    expect(chooseTargetKeyword([...rows].reverse(), 'WeWork')?.keyword).toBe('wework office')
    const both = [
      kw('wework office', 60, { estimatedMonthlySearch: 100 }),
      kw('wework story', 60, { estimatedMonthlySearch: 900 }),
    ]
    expect(chooseTargetKeyword(both, 'WeWork')?.keyword).toBe('wework story')
    expect(chooseTargetKeyword([...both].reverse(), 'WeWork')?.keyword).toBe('wework story')
  })
  test('skips a plain copy of a punctuated title', () => {
    const rows = [
      kw('jeep made billions then stellantis happened', 90),
      kw('jeep made billions. then stellantis happened.', 80),
      kw('leapmotor stellantis', 50),
    ]
    expect(chooseTargetKeyword(rows, 'Stellantis')?.keyword).toBe('leapmotor stellantis')
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

  test('counts every call in the estimate, the subject phrase measure included', () => {
    expect(caseResearchCredits({ formatSeed: true, people: 2 })).toBe(75)
    expect(caseResearchCredits({ formatSeed: false, people: 0 })).toBe(60)
    expect(caseResearchCredits({ formatSeed: false, people: 5 })).toBe(70)
    // The subject and two seeds: three exact measures.
    expect(caseResearchCredits({ formatSeed: false, people: 0, exactPhrases: 3 })).toBe(70)
  })

  test('a brief holds the owner flag and up to fifteen other keywords (decision 467)', () => {
    const owned = kw('owned', 50, { owner: true })
    const fifteen = Array.from({ length: 15 }, (_, i) => ({ ...owned, keyword: `k${i}` }))
    expect(
      SearchBriefSchema.parse(fixture({ secondaryKeywords: fifteen })).secondaryKeywords,
    ).toHaveLength(15)
    expect(SECONDARY_KEYWORDS_MAX).toBe(15)
    expect(
      SearchBriefSchema.safeParse(fixture({ secondaryKeywords: [...fifteen, owned] })).success,
    ).toBe(false)
  })
})

describe('exactPhrases, phraseKey and briefPhrases (decision 467)', () => {
  test('the subject first, then each seed once, compared without case or extra spaces', () => {
    expect(
      exactPhrases('Ueno Bank Paraguay', [
        'ueno  bank paraguay',
        ' Ueno bank collapse ',
        'UENO BANK COLLAPSE',
        '',
      ]),
    ).toEqual(['Ueno Bank Paraguay', 'Ueno bank collapse'])
  })

  test('takes five seeds at most, and no seeds by default', () => {
    expect(exactPhrases('S', ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'])).toEqual([
      'S',
      'a1',
      'a2',
      'a3',
      'a4',
      'a5',
    ])
    expect(exactPhrases('S')).toEqual(['S'])
    expect(exactPhrases('', ['only seed'])).toEqual(['only seed'])
  })

  test('phraseKey folds case and spaces', () => {
    expect(phraseKey('  Ueno   Bank ')).toBe('ueno bank')
  })

  test('briefPhrases names every list a phrase can already be on', () => {
    const k = (keyword: string) => kw(keyword, 50)
    const phrases = briefPhrases(
      fixture({
        targetKeyword: k('Target One'),
        secondaryKeywords: [k('second')],
        searchedTitles: [k('a title')],
        otherLanguages: [k('otra lengua')],
        offIntent: [k('off one')],
      }),
    )
    expect([...phrases].sort()).toEqual([
      'a title',
      'off one',
      'otra lengua',
      'second',
      'target one',
    ])
  })
})

describe('pickTargetCandidates', () => {
  const rows = [
    kw('wework documentary', 64, { estimatedMonthlySearch: 900, fit: 'fits' }),
    kw('wework office pune', 74, { estimatedMonthlySearch: 5000, fit: 'off' }),
    kw('wework stock', 68, { estimatedMonthlySearch: 4000, fit: 'partly' }),
    kw('wework collapse', 63, { estimatedMonthlySearch: 2000, fit: 'fits' }),
    kw('wework story', 62, { estimatedMonthlySearch: 3000, fit: 'fits' }),
    kw('wework scene', 58, { estimatedMonthlySearch: 9000, fit: 'off' }),
    kw('wework ceo', 57, { estimatedMonthlySearch: 8000, fit: 'off' }),
  ]
  test('picks by fit, then bible words, then searches', () => {
    const out = pickTargetCandidates(rows, { preferredWords: ['documentary'] })
    expect(out.map((r) => r.keyword)).toEqual([
      'wework documentary',
      'wework story',
      'wework collapse',
    ])
  })
  test('falls back to partly when nothing fits', () => {
    const none = rows.map((r) => (r.fit === 'fits' ? { ...r, fit: 'off' as const } : r))
    expect(pickTargetCandidates(none, { preferredWords: [] }).map((r) => r.keyword)).toEqual([
      'wework stock',
    ])
  })
  test('pickTargetCandidates honours a lower floor', () => {
    const low = [kw('wework low', 40, { fit: 'fits' }), kw('wework high', 60, { fit: 'fits' })]
    expect(pickTargetCandidates(low, { preferredWords: [] }).map((r) => r.keyword)).toEqual([
      'wework high',
    ])
    expect(
      pickTargetCandidates(low, { preferredWords: [], floor: 40 })
        .map((r) => r.keyword)
        .sort(),
    ).toEqual(['wework high', 'wework low'])
  })
  test('an undefined fit counts as fitting', () => {
    const out = pickTargetCandidates([kw('wework news', 60, { estimatedMonthlySearch: 10 })], {
      preferredWords: [],
    })
    expect(out).toHaveLength(1)
  })
  test('never offers a row under 50, with a figure, or a title', () => {
    const bad = [
      kw('wework low', 49, { fit: 'fits' }),
      kw('wework 2019', 80, { fit: 'fits' }),
      kw('wework: the fall', 80, { fit: 'fits' }),
      kw('wework null', null, { fit: 'fits' }),
    ]
    expect(pickTargetCandidates(bad, { preferredWords: [] })).toEqual([])
  })
  test('a preferred word is a whole word, and nulls sort last', () => {
    const out = pickTargetCandidates(
      [
        kw('documentaryish thing', 70, { estimatedMonthlySearch: 9000 }),
        kw('wework nulls', 70),
        kw('wework documentary', 70, { estimatedMonthlySearch: 5 }),
      ],
      { preferredWords: ['documentary'] },
    )
    expect(out.map((r) => r.keyword)).toEqual([
      'wework documentary',
      'documentaryish thing',
      'wework nulls',
    ])
  })
  test('keeps an accented keyword on a Portuguese channel', () => {
    const out = pickTargetCandidates([kw('dom pedro documentário', 60, { fit: 'fits' })], {
      preferredWords: [],
      language: 'pt-BR',
    })
    expect(out).toHaveLength(1)
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

const STELLANTIS_ROWS = [
  kw('stellantis is losing everything: jeep, dodge & fiat on the brink', 75, {
    estimatedMonthlySearch: 109212,
  }),
  kw('a stellantis está perdendo tudo: jeep, dodge e fiat à beira do abismo', 73, {
    estimatedMonthlySearch: 7261,
  }),
  kw('stellantis is falling apart — jeep, dodge & chrysler owners should be worried', 70, {
    estimatedMonthlySearch: 3000,
  }),
  kw('stellantis lo está perdiendo todo: jeep, dodge y fiat al borde del abismo', 68, {
    estimatedMonthlySearch: 9337,
  }),
  kw('stellantis is losing everything across the uk: vauxhall, peugeot & fiat on the brink', 68, {
    estimatedMonthlySearch: 2000,
  }),
  kw('jeep made billions. then stellantis happened.', 66, { estimatedMonthlySearch: 1000 }),
  kw('stellantis is losing everything', 65, { estimatedMonthlySearch: 52004 }),
  kw('stellantis lo está perdiendo todo en méxico: jeep, dodge y fiat al borde del abismo', 65, {
    estimatedMonthlySearch: 500,
  }),
  kw('stellantis lo está perdiendo todo: jeep, dodge y fiat, al borde del abismo', 64, {
    estimatedMonthlySearch: 400,
  }),
  kw('leapmotor stellantis', 63, { estimatedMonthlySearch: 8167 }),
]

function stellantisBrief(): SearchBrief {
  return fixture({
    subject: 'Stellantis',
    targetKeyword: STELLANTIS_ROWS[0],
    secondaryKeywords: STELLANTIS_ROWS.slice(1),
  })
}

const OPTION_ANGLE = 'An angle that is long enough to pass'

describe('the brief fields added with the case library redesign', () => {
  test('parses a brief stored before the new fields', () => {
    const old: Record<string, unknown> = { ...fixture() }
    for (const k of [
      'searchedTitles',
      'otherLanguages',
      'recommendedAngle',
      'recommendationReason',
      'ownAngle',
    ]) {
      delete old[k]
    }
    const parsed = SearchBriefSchema.parse(old)
    expect(parsed.searchedTitles).toEqual([])
    expect(parsed.otherLanguages).toEqual([])
    expect(parsed.recommendedAngle).toBeNull()
    expect(parsed.recommendationReason).toBeNull()
    expect(parsed.ownAngle).toBe(false)
  })
})

describe('upgradeSearchBrief', () => {
  test('moves the Stellantis titles out and re-picks the target', () => {
    const up = upgradeSearchBrief(stellantisBrief())
    expect(up.targetKeyword?.keyword).toBe('leapmotor stellantis')
    expect(up.secondaryKeywords).toEqual([])
    expect(up.searchedTitles).toHaveLength(5)
    expect(up.otherLanguages).toHaveLength(4)
    expect(up.searchedTitles[0]?.keyword).toBe(
      'stellantis is losing everything: jeep, dodge & fiat on the brink',
    )
    expect(up.otherLanguages[0]?.estimatedMonthlySearch).toBe(9337)
  })

  test('is idempotent', () => {
    const once = upgradeSearchBrief(stellantisBrief())
    expect(upgradeSearchBrief(once)).toEqual(once)
  })

  test('returns a deep-equal brief when nothing moves', () => {
    const b = fixture({ secondaryKeywords: [kw('wework bankruptcy', 40)] })
    expect(upgradeSearchBrief(b)).toEqual(b)
  })

  test('keeps a keyword target the owner chose', () => {
    const b = fixture({
      targetKeyword: kw('wework documentary', 40),
      secondaryKeywords: [kw('wework story', 70), kw('wework: the fall!', 60)],
    })
    const up = upgradeSearchBrief(b)
    expect(up.targetKeyword?.keyword).toBe('wework documentary')
    expect(up.secondaryKeywords.map((r) => r.keyword)).toEqual(['wework story'])
    expect(up.searchedTitles.map((r) => r.keyword)).toEqual(['wework: the fall!'])
  })

  test('merges with the lists already there, without duplicates', () => {
    const b = fixture({
      secondaryKeywords: [kw('Wework: The Fall!', 60)],
      searchedTitles: [kw('wework: the fall!', 60), kw('wework: the end!', 10)],
    })
    expect(upgradeSearchBrief(b).searchedTitles).toHaveLength(2)
  })

  test('nulls a recommendation index out of range', () => {
    const option = { angle: OPTION_ANGLE, keyword: 'wework documentary', answers: [], gap: '' }
    expect(
      upgradeSearchBrief(fixture({ angleOptions: [option], recommendedAngle: 1 })).recommendedAngle,
    ).toBeNull()
    expect(
      upgradeSearchBrief(fixture({ angleOptions: [option], recommendedAngle: 0 })).recommendedAngle,
    ).toBe(0)
  })

  test('StoredSearchBriefSchema upgrades as it parses', () => {
    const parsed = StoredSearchBriefSchema.parse(stellantisBrief())
    expect(parsed.targetKeyword?.keyword).toBe('leapmotor stellantis')
  })
})

describe('angleDemand', () => {
  const option = (keyword: string, answers: string[]) => ({
    angle: OPTION_ANGLE,
    keyword,
    answers,
    gap: '',
  })
  const questions = ['why did it fail', 'who is adam', 'how much', 'when', 'where', 'what']

  test('scores demand from overall and answered questions', () => {
    const b = fixture({ searchedQuestions: questions })
    const d = angleDemand(option('Wework Documentary', ['Why did it fail ', 'who is adam']), b)
    expect(d).toEqual({
      score: 56,
      keyword: 'wework documentary',
      keywordOverall: 63,
      servesSearchedTerm: false,
      answers: 2,
    })
  })

  test('caps at 100 and at five answers', () => {
    const b = fixture({
      targetKeyword: kw('wework documentary', 100),
      searchedQuestions: questions,
    })
    const d = angleDemand(option('wework documentary', questions), b)
    expect(d.answers).toBe(5)
    expect(d.score).toBe(100)
  })

  test('scores a title-serving option on questions only', () => {
    const b = fixture({
      searchedTitles: [kw('wework: the fall!', 90)],
      searchedQuestions: questions,
    })
    const d = angleDemand(option('wework: the fall!', ['why did it fail']), b)
    expect(d.score).toBe(6)
    expect(d.servesSearchedTerm).toBe(true)
  })

  test('scores an unknown keyword on questions only, without serving a term', () => {
    expect(angleDemand(option('', []), fixture())).toEqual({
      score: 0,
      keyword: null,
      keywordOverall: null,
      servesSearchedTerm: false,
      answers: 0,
    })
  })

  test('counts a repeated answer once', () => {
    const b = fixture({ searchedQuestions: questions })
    const d = angleDemand(option('wework documentary', ['who is adam', 'Who is Adam']), b)
    expect(d.answers).toBe(1)
  })
})

describe('angleIsChosen and briefNeedsResearch', () => {
  test('counts an own angle as chosen', () => {
    expect(angleIsChosen(fixture())).toBe(false)
    expect(angleIsChosen(fixture({ chosenAngle: 0 }))).toBe(true)
    expect(angleIsChosen(fixture({ ownAngle: true }))).toBe(true)
  })

  test('flags a weak or missing target for research', () => {
    expect(WEAK_TARGET_OVERALL).toBe(50)
    expect(briefNeedsResearch(fixture())).toBe(false)
    expect(briefNeedsResearch(fixture({ targetKeyword: null }))).toBe(true)
    expect(briefNeedsResearch(fixture({ targetKeyword: kw('wework', 49) }))).toBe(true)
    expect(briefNeedsResearch(fixture({ targetKeyword: kw('wework', null) }))).toBe(true)
    expect(briefNeedsResearch(fixture({ targetKeyword: kw('wework', 50) }))).toBe(false)
  })

  test('flags a brief with an option that serves a searched title', () => {
    const b = fixture({
      searchedTitles: [kw('wework: the fall!', 90)],
      angleOptions: [{ angle: OPTION_ANGLE, keyword: 'wework: the fall!', answers: [], gap: '' }],
    })
    expect(briefNeedsResearch(b)).toBe(true)
  })
})

describe('pendingNicheJob', () => {
  const now = new Date('2026-11-06T12:00:00.000Z')
  const job = (angle: string, minutesAgo: number) => ({
    angle,
    jobId: `job-${angle}`,
    startedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
  })

  test('finds the angle job started under thirty minutes ago', () => {
    expect(pendingNicheJob({ nicheJobs: [job('a', 29), job('b', 1)] }, 'a', now)?.jobId).toBe(
      'job-a',
    )
  })

  test('ignores an old job, another angle and a brief without jobs', () => {
    expect(pendingNicheJob({ nicheJobs: [job('a', 30)] }, 'a', now)).toBeUndefined()
    expect(pendingNicheJob({ nicheJobs: [job('b', 1)] }, 'a', now)).toBeUndefined()
    expect(pendingNicheJob({}, 'a', now)).toBeUndefined()
  })
})
