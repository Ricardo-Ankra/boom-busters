import { describe, expect, it } from 'vitest'
import {
  SearchBriefSchema,
  type FieldCheck,
  type FieldResult,
  type SearchBrief,
  type SearchKeyword,
} from './search-brief'
import {
  briefHasFullChecks,
  briefVerdict,
  fieldCompetition,
  isStaleField,
  openDoors,
  shortCount,
  topicDemand,
} from './brief-verdict'

const NOW = new Date('2026-11-05T00:00:00.000Z')

const kw = (keyword: string, extra: Partial<SearchKeyword> = {}): SearchKeyword => ({
  keyword,
  volume: null,
  competition: null,
  overall: 60,
  estimatedMonthlySearch: null,
  growthPct: null,
  ...extra,
})

const result = (
  i: number,
  subscribers: number | null,
  views: number | null,
  publishedAt: string | null,
  seconds: number | null,
): FieldResult => ({
  videoId: `v${i}`,
  title: `Video ${i}`,
  channelTitle: `Channel ${i}`,
  subscribers,
  views,
  publishedAt,
  seconds,
})

/** The live probe for "wework documentary" (2026-11-05), durations converted by hand. */
const WEWORK: FieldResult[] = [
  result(1, 5_190_000, 4_211_558, '2019-11-07', 809), // Bloomberg PT13M29S
  result(2, 1_860_000, 2_015_621, '2025-03-15', 7506), // MagnatesMedia PT2H5M6S
  result(3, 11, 822, '2026-08-09', 1630), // Corporate Faultline PT27M10S
  result(4, 440_000, 683_740, '2022-01-14', 5534), // Coffee and Cults PT1H32M14S
  result(5, 30, 176, '2026-08-11', 207), // SketchStrategy PT3M27S
  result(6, 2_200_000, 226_353, '2021-03-17', 155), // Forbes PT2M35S
  result(7, 9_300_000, 423_414, '2024-06-18', 837), // VICE PT13M57S
  result(8, 5_260_000, 5_396_032, '2019-11-20', 1198), // ColdFusion PT19M58S
  result(9, 6_730_000, 913_313, '2023-11-07', 301), // WSJ PT5M1S
  result(10, 1_420_000, 14_366, '2021-03-22', 163), // Rotten Tomatoes PT2M43S
]

const check = (results: FieldResult[], keyword = 'wework documentary'): FieldCheck => ({
  keyword,
  checkedAt: NOW.toISOString(),
  results,
})

const ANGLE = 'The founder story told through the lease obligations nobody read'

function brief(over: Partial<SearchBrief> = {}): SearchBrief {
  return {
    subject: 'WeWork',
    measuredAt: NOW.toISOString(),
    targetKeyword: kw('wework documentary', {
      fit: 'fits',
      topic: 'wework',
      estimatedMonthlySearch: 6000,
    }),
    secondaryKeywords: [],
    searchedQuestions: [],
    outliers: [],
    titlePatterns: [],
    toldAlready: [],
    angleOptions: [
      { angle: ANGLE, keyword: 'wework documentary', answers: [], gap: 'No one covers leases.' },
    ],
    chosenAngle: null,
    formatKey: null,
    fit: { inScope: true, pillarKey: 'business', reason: 'Business collapse.' },
    searchedTitles: [],
    otherLanguages: [],
    recommendedAngle: 0,
    recommendationReason: null,
    ownAngle: false,
    ...over,
  }
}

const ctx = { caseCategory: 'business', checkedAngle: 0 }
const line = (b: SearchBrief, name: string, c = ctx) =>
  briefVerdict(b, c).find((l) => l.check === name)!

describe('field competition', () => {
  it('finds no open doors in the WeWork field and calls it recent', () => {
    const c = check(WEWORK)
    expect(openDoors(c)).toBe(0)
    expect(isStaleField(c, NOW)).toBe(false)
    expect(fieldCompetition(c)).toBe('bad')
    const l = line(brief({ fieldChecks: [c] }), 'competition')
    expect(l.state).toBe('bad')
    expect(l.reason).toContain('wework documentary')
  })

  it('counts a small channel with real views as an open door', () => {
    const c = check([
      result(1, 99_999, 10_000, '2026-01-01', 600),
      result(2, 100_000, 50_000, '2026-01-01', 600),
      result(3, 500, 9_999, '2026-01-01', 600),
      result(4, 500, 30_000, '2026-01-01', 600),
      result(5, 500, 30_000, '2026-01-01', 600),
    ])
    expect(openDoors(c)).toBe(3)
    expect(fieldCompetition(c)).toBe('ok')
    expect(fieldCompetition(check(c.results.slice(0, 2)))).toBe('warn')
  })

  it('warns on no open doors in a stale field', () => {
    const old = Array.from({ length: 10 }, (_, i) =>
      result(i, 2_000_000, 900_000, i < 6 ? '2020-05-01' : '2026-05-01', 600),
    )
    const c = check(old)
    expect(isStaleField(c, NOW)).toBe(true)
    expect(openDoors(c)).toBe(0)
    expect(fieldCompetition(c)).toBe('warn')
  })

  it('calls a field of Shorts bad', () => {
    const shorts = Array.from({ length: 10 }, (_, i) =>
      result(i, 500, 50_000, '2026-05-01', i < 6 ? 45 : 600),
    )
    const c = check(shorts)
    expect(shortCount(c)).toBe(6)
    expect(openDoors(c)).toBe(10)
    expect(fieldCompetition(c)).toBe('bad')
    expect(shortCount(check([result(1, 1, 1, null, 60), result(2, 1, 1, null, 61)]))).toBe(1)
  })

  it('judges a short field with nulls without crashing', () => {
    const c = check([
      result(1, null, null, null, null),
      result(2, 500, null, '2026-01-01', 600),
      result(3, null, 40_000, null, 600),
      result(4, 500, 40_000, '2026-01-01', null),
    ])
    expect(['ok', 'warn', 'bad']).toContain(fieldCompetition(c))
    expect(openDoors(c)).toBe(1)
    expect(() => briefVerdict(brief({ fieldChecks: [c] }), ctx)).not.toThrow()
  })

  it('judges staleness from the research date, not today', () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      result(i, 2_000_000, 900_000, i < 6 ? '2022-06-01' : '2023-12-01', 600),
    )
    // Researched in January 2024 the 2022 videos were under three years old: a recent field.
    const early = { ...check(results), checkedAt: '2024-01-01T00:00:00.000Z' }
    expect(fieldCompetition(early)).toBe('bad')
    expect(line(brief({ fieldChecks: [early] }), 'competition').state).toBe('bad')
    // The same videos are three years old by a late 2026 research date.
    expect(fieldCompetition(check(results))).toBe('warn')
  })

  it('treats a field check with no results as not checked', () => {
    const empty = check([])
    expect(fieldCompetition(empty)).toBe('warn')
    const l = line(brief({ fieldChecks: [empty] }), 'competition')
    expect(l.state).toBe('warn')
    expect(l.reason).toBe('No results came back for "wework documentary"')
  })

  it('shows Not checked for a target with no field check', () => {
    const l = line(brief(), 'competition')
    expect(l.state).toBe('warn')
    expect(l.reason).toBe('Not checked for this keyword')
    const other = brief({ fieldChecks: [check(WEWORK, 'something else')] })
    expect(line(other, 'competition').reason).toBe('Not checked for this keyword')
  })

  it('shows the credit cap when the run skipped a check', () => {
    const l = line(brief({ skipped: ['field check: credit cap'] }), 'competition')
    expect(l.state).toBe('warn')
    expect(l.reason).toBe('Not checked: credit cap')
  })
})

describe('topic demand', () => {
  it('sums topic demand over keyword rows that are not off', () => {
    const b = brief({
      targetKeyword: kw('wework documentary', {
        topic: 'wework',
        estimatedMonthlySearch: 3000,
        growthPct: 20,
      }),
      secondaryKeywords: [
        kw('wework story', { topic: 'wework', estimatedMonthlySearch: 1500 }),
        kw('wework 47 billion', { topic: 'wework', estimatedMonthlySearch: 500 }),
        kw('wework fraud', { topic: 'wework', estimatedMonthlySearch: 9000, fit: 'off' }),
        kw('cult documentary', { topic: 'cults', estimatedMonthlySearch: 7000 }),
        kw('WeWork: The Spectacular Rise and Fall', {
          topic: 'wework',
          estimatedMonthlySearch: 800,
        }),
        kw('wework nulls', { topic: 'wework', estimatedMonthlySearch: null }),
      ],
      searchedTitles: [
        kw('wework full documentary 2024 explained', {
          topic: 'wework',
          estimatedMonthlySearch: 4000,
        }),
      ],
    })
    expect(topicDemand(b)).toEqual({ topic: 'wework', searches: 5000, growth: 20 })
  })

  it('counts the target itself even when its fit is off', () => {
    const b = brief({
      targetKeyword: kw('wework documentary', {
        topic: 'wework',
        fit: 'off',
        estimatedMonthlySearch: 6000,
      }),
    })
    expect(topicDemand(b).searches).toBe(6000)
    expect(line(b, 'demand').state).toBe('ok')
  })

  it('is unmeasured with no target, topic or figures', () => {
    expect(topicDemand(brief({ targetKeyword: null }))).toEqual({
      topic: null,
      searches: null,
      growth: null,
    })
    const bare = brief({ targetKeyword: kw('wework documentary') })
    expect(topicDemand(bare).searches).toBeNull()
    expect(line(bare, 'demand').state).toBe('bad')
  })

  it('warns on a news spike', () => {
    const b = brief({
      targetKeyword: kw('wework documentary', {
        topic: 'wework',
        estimatedMonthlySearch: 9000,
        growthPct: 250,
      }),
    })
    const l = line(b, 'demand')
    expect(l.state).toBe('warn')
    expect(l.reason).toContain('news spike')
    expect(line(brief(), 'demand').state).toBe('ok')
    const mid = brief({
      targetKeyword: kw('wework documentary', { topic: 'wework', estimatedMonthlySearch: 1000 }),
    })
    expect(line(mid, 'demand').state).toBe('warn')
    const low = brief({
      targetKeyword: kw('wework documentary', { topic: 'wework', estimatedMonthlySearch: 999 }),
    })
    expect(line(low, 'demand').state).toBe('bad')
  })
})

describe('intent, fit and angle', () => {
  it('marks intent from the target fit', () => {
    const withFit = (fit?: 'fits' | 'partly' | 'off') =>
      brief({ targetKeyword: kw('wework documentary', { fit }) })
    expect(line(withFit('fits'), 'intent').state).toBe('ok')
    expect(line(withFit('partly'), 'intent').state).toBe('warn')
    expect(line(withFit('off'), 'intent').state).toBe('bad')
    expect(line(brief({ targetKeyword: null }), 'intent').state).toBe('bad')
    const unknown = line(withFit(undefined), 'intent')
    expect(unknown.state).toBe('warn')
    expect(unknown.reason).toBe('Intent was not measured')
  })

  it('judges channel fit against the case category', () => {
    expect(line(brief(), 'fit').state).toBe('ok')
    expect(line(brief({ fit: { inScope: true, pillarKey: null, reason: '' } }), 'fit').state).toBe(
      'ok',
    )
    expect(
      line(brief({ fit: { inScope: true, pillarKey: 'crime', reason: '' } }), 'fit').state,
    ).toBe('warn')
    expect(line(brief({ fit: { inScope: false, pillarKey: null, reason: '' } }), 'fit').state).toBe(
      'bad',
    )
    const none = line(brief({ fit: null }), 'fit')
    expect(none.state).toBe('warn')
    expect(none.reason).toBe('Channel fit was not measured')
  })

  it('needs comment-theme or direct niche evidence for an ok angle', () => {
    const theme = {
      theme: 'Viewers ask about the lease deals',
      count: 4,
      quote: null,
      videoId: 'v1',
    }
    const base = (evidence?: string[], themeBacked?: number) =>
      brief({
        angleOptions: [
          {
            angle: ANGLE,
            keyword: 'wework documentary',
            answers: [],
            gap: 'g',
            evidence,
            themeBacked,
          },
        ],
      })
    const niche = (direct: boolean, angle = ANGLE) => ({
      angle,
      verdict: 'v',
      direct,
      evidence: [],
      notes: '',
    })

    expect(line(base(), 'angle').state).toBe('warn')
    expect(line({ ...base(), commentThemes: [theme] }, 'angle').state).toBe('warn')
    expect(
      line({ ...base(['Four viewers ask about leases'], 1), commentThemes: [theme] }, 'angle')
        .state,
    ).toBe('ok')
    expect(line(base(['Four viewers ask']), 'angle').state).toBe('warn')
    expect(line({ ...base(), nicheTests: [niche(true)] }, 'angle').state).toBe('ok')
    expect(line({ ...base(), nicheTests: [niche(false)] }, 'angle').state).toBe('warn')
    expect(line({ ...base(), nicheTests: [niche(true, 'another')] }, 'angle').state).toBe('warn')
    expect(line(brief({ angleOptions: [] }), 'angle').state).toBe('bad')
    expect(line({ ...base(), skipped: ['comments: credit cap'] }, 'angle').reason).toBe(
      'Not checked: credit cap',
    )
    expect(line({ ...base(), skipped: ['niche test: timed out'] }, 'angle').reason).not.toBe(
      'Not checked: credit cap',
    )
  })

  it('warns when an angle cites only the field', () => {
    const theme = { theme: 'Viewers ask about leases', count: 4, quote: null, videoId: 'v1' }
    const fieldOnly = brief({
      angleOptions: [
        {
          angle: ANGLE,
          keyword: 'wework documentary',
          answers: [],
          gap: 'g',
          evidence: ['None of the top ten covers the filing'],
          themeBacked: 0,
        },
      ],
      commentThemes: [theme],
    })
    const out = line(fieldOnly, 'angle')
    expect(out.state).toBe('warn')
    expect(out.reason).toContain('none tied to this angle')
  })

  it('never judges the recommended option when the owner kept their own angle', () => {
    const theme = { theme: 'Viewers ask about leases', count: 4, quote: null, videoId: 'v1' }
    const own = brief({
      ownAngle: true,
      recommendedAngle: 0,
      commentThemes: [theme],
      angleOptions: [
        {
          angle: ANGLE,
          keyword: 'wework documentary',
          answers: [],
          gap: 'g',
          evidence: ['Four ask about leases'],
          themeBacked: 1,
        },
      ],
    })
    const out = line(own, 'angle')
    expect(out.state).toBe('warn')
    expect(out.reason).toBe('Your own angle has no evidence check yet')
  })

  it('names the pillar by its label, not its key', () => {
    const other = brief({ fit: { inScope: true, pillarKey: 'docs-key', reason: '' } })
    expect(line(other, 'fit').reason).toContain('docs-key')
    const labelled = briefVerdict(other, {
      ...ctx,
      caseCategory: 'crime',
      pillarLabels: { 'docs-key': 'Documentaries' },
    }).find((l) => l.check === 'fit')
    expect(labelled?.reason).toBe('In scope, but it belongs to the Documentaries pillar')
  })

  it('returns the five lines in order', () => {
    expect(briefVerdict(brief(), ctx).map((l) => l.check)).toEqual([
      'intent',
      'angle',
      'fit',
      'demand',
      'competition',
    ])
  })
})

describe('old briefs', () => {
  it('knows an old brief has no full checks', () => {
    const plain = brief({ targetKeyword: kw('a'), secondaryKeywords: [kw('b')] })
    expect(briefHasFullChecks(plain)).toBe(false)
    expect(briefHasFullChecks(brief({ targetKeyword: kw('a', { fit: 'off' }) }))).toBe(true)
    expect(
      briefHasFullChecks(
        brief({ targetKeyword: null, secondaryKeywords: [kw('b', { fit: 'partly' })] }),
      ),
    ).toBe(true)
    expect(briefHasFullChecks(brief({ targetKeyword: kw('a'), fieldChecks: [] }))).toBe(true)
  })

  it('still parses a full brief without any new field and reads identically', () => {
    const old = {
      subject: 'WeWork',
      measuredAt: NOW.toISOString(),
      targetKeyword: kw('wework documentary'),
      secondaryKeywords: [kw('wework story')],
      searchedQuestions: ['why did wework fail'],
      outliers: [],
      titlePatterns: [],
      toldAlready: [],
      angleOptions: [{ angle: ANGLE, keyword: 'wework documentary', answers: [], gap: 'g' }],
      chosenAngle: null,
    }
    const parsed = SearchBriefSchema.parse(old)
    for (const key of [
      'language',
      'niche',
      'offIntent',
      'fieldChecks',
      'commentThemes',
      'commentsRead',
      'nicheTests',
      'skipped',
    ])
      expect(key in parsed).toBe(false)
    expect('evidence' in parsed.angleOptions[0]!).toBe(false)
    expect('fit' in parsed.targetKeyword!).toBe(false)
    expect(parsed.fit).toBeNull()
    expect(briefHasFullChecks(parsed)).toBe(false)
    expect(JSON.parse(JSON.stringify(parsed)).secondaryKeywords).toEqual(old.secondaryKeywords)
    expect(briefVerdict(parsed, ctx)).toHaveLength(5)
  })
})
