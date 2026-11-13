// @vitest-environment node

import {
  createCase,
  deleteCase,
  getCase,
  requireTestDatabase,
  seed,
  setCaseFormat,
  truncateRunMirror,
  updateCase,
  updateWorkspace,
  vidiqCredits,
  withTemporaryBible,
  writeCaseResearchJob,
} from '@boom-busters/db'
import type { AngleOption, CaseResearchJob, ChannelFormat } from '@boom-busters/schemas'
import type * as ProvidersModule from '@boom-busters/providers'
import type * as VidiqModule from '@boom-busters/providers/vidiq'
import type * as EvidenceModule from '@/lib/case-evidence'
import type * as RateAnglesModule from '@/lib/rate-angles'
import {
  CASE_RESEARCH_CREDITS,
  EXACT_KEYWORD_CREDITS,
  DEFAULT_WORKSPACE_SETTINGS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  SearchBriefSchema,
  caseResearchJobIsRunning,
  defaultFormat,
} from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { caseResearcher, failCaseResearch } from './case-researcher'

/**
 * The case researcher in mock-provider mode against the real database: four
 * VidIQ calls land four ledger rows worth 20 credits, the brief holds no
 * transcript and no description, and a run that fails leaves its reason on the
 * case, its credits in the ledger and no half-written brief.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

vi.mock('@/lib/rate-angles', async (importOriginal) => {
  const original = await importOriginal<typeof RateAnglesModule>()
  return {
    ...original,
    rateAngles: (...args: Parameters<typeof original.rateAngles>) =>
      seams.ratingOverride ? seams.ratingOverride() : original.rateAngles(...args),
  }
})

const seams = vi.hoisted(() => ({
  clientOverride: null as null | ((real: unknown) => unknown),
  winnersOverride: null as null | { titlePatterns: string[]; toldAlready: string[] },
  anglesOverride: null as null | AngleOption[],
  ratingOverride: null as null | (() => Promise<{ ok: false; error: string }>),
  understandingOverride: null as
    null | ((input: { rows: readonly { keyword: string }[] }) => unknown),
  nicheTimesOut: false,
}))

vi.mock('@/lib/case-evidence', async (importOriginal) => {
  const original = await importOriginal<typeof EvidenceModule>()
  return {
    ...original,
    awaitNicheTest: (...args: Parameters<typeof original.awaitNicheTest>) =>
      seams.nicheTimesOut
        ? Promise.resolve({ state: 'running' as const })
        : original.awaitNicheTest(...args),
  }
})

vi.mock('@boom-busters/providers', async (importOriginal) => {
  const original = await importOriginal<typeof ProvidersModule>()
  return {
    ...original,
    mockWinners: () => seams.winnersOverride ?? original.mockWinners(),
    mockKeywordUnderstanding: (input: Parameters<typeof original.mockKeywordUnderstanding>[0]) =>
      seams.understandingOverride
        ? (seams.understandingOverride(input) as ReturnType<
            typeof original.mockKeywordUnderstanding
          >)
        : original.mockKeywordUnderstanding(input),
    mockAngleOptions: (input: Parameters<typeof original.mockAngleOptions>[0]) =>
      seams.anglesOverride ?? original.mockAngleOptions(input),
  }
})

vi.mock('@boom-busters/providers/vidiq', async (importOriginal) => {
  const original = await importOriginal<typeof VidiqModule>()
  return {
    ...original,
    vidiqClientFor: (key: string | undefined) => {
      const real = original.vidiqClientFor(key)
      return seams.clientOverride ? seams.clientOverride(real) : real
    },
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

const SUBJECT = 'WeWork'

/** The optional checks' tools; the rest are the run's required calls. */
const OPTIONAL_TOOLS = ['vidiq_youtube_search', 'vidiq_video_comments', 'vidiq_comment_insights']

/** The ledger rows of the required calls (terms, questions, outliers, details), leaving out the optional checks. */
async function requiredRows() {
  const rows = await db.select().from(vidiqCredits)
  return rows.filter((r) => !OPTIONAL_TOOLS.includes(r.tool))
}

/** Every longest string in a value, so a stored description or transcript would show. */
function longestString(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return Math.max(0, ...value.map(longestString))
  if (value && typeof value === 'object') {
    return Math.max(0, ...Object.values(value).map(longestString))
  }
  return 0
}

describeDb('case-researcher (mock mode)', () => {
  let engine: InngestTestEngine
  let caseId: string
  let startedAt: string

  const request = (
    jobStartedAt: string = startedAt,
  ): { events: [{ name: string; data: { caseId: string; jobStartedAt: string } }] } => ({
    events: [{ name: 'case/research.requested', data: { caseId, jobStartedAt } }],
  })

  const job = (over: Partial<CaseResearchJob> = {}): CaseResearchJob => ({
    state: 'running',
    current: null,
    error: null,
    startedAt,
    subject: SUBJECT,
    ...over,
  })

  /** The same hook Inngest runs when a function ends in failure; the harness does not run it. */
  const fail = async (message: string, jobStartedAt: string = startedAt) => {
    const opts = (
      caseResearcher as unknown as { opts: { onFailure: (args: unknown) => Promise<void> } }
    ).opts
    await opts.onFailure({
      event: { data: { event: { data: { caseId, jobStartedAt } }, error: { message } } },
    })
  }

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    seams.clientOverride = null
    seams.winnersOverride = null
    seams.anglesOverride = null
    seams.ratingOverride = null
    seams.understandingOverride = null
    seams.nicheTimesOut = false
    engine = new InngestTestEngine({ function: caseResearcher })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    await db.delete(vidiqCredits)
    const row = await createCase(db, {
      channelId: FIRST_CHANNEL_ID,
      title: 'WeWork research case',
      category: 'con',
      subject: SUBJECT,
      angle: 'How the lease model hid the losses',
    })
    caseId = row.id
    startedAt = new Date().toISOString()
    await writeCaseResearchJob(db, caseId, () => job())
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await deleteCase(db, caseId)
  })

  it('saves a brief with a target keyword, short lists and two or three angles, in five required ledger rows worth 25 credits', async () => {
    const { result } = await engine.execute(request())
    expect(result).toMatchObject({ outcome: 'researched' })

    const row = await getCase(db, caseId)
    const brief = SearchBriefSchema.parse(row?.searchBrief)
    expect(brief.subject).toBe(SUBJECT)
    expect(brief.targetKeyword).not.toBeNull()
    expect(brief.secondaryKeywords.length).toBeLessThanOrEqual(10)
    expect(brief.searchedQuestions.length).toBeLessThanOrEqual(10)
    expect(brief.outliers.length).toBeGreaterThan(0)
    expect(brief.outliers.length).toBeLessThanOrEqual(10)
    expect(brief.titlePatterns.length).toBeGreaterThan(0)
    expect(brief.angleOptions.length).toBeGreaterThanOrEqual(2)
    expect(brief.angleOptions.length).toBeLessThanOrEqual(3)
    expect(brief.chosenAngle).toBeNull()
    // The target is not repeated among the secondary keywords.
    expect(brief.secondaryKeywords.map((k) => k.keyword)).not.toContain(
      brief.targetKeyword?.keyword,
    )
    // Digest-sized fields only: no transcript, no full description.
    expect(longestString(brief)).toBeLessThanOrEqual(400)

    expect(row?.searchJob).toMatchObject({ state: 'done', current: null, error: null })

    const rows = await requiredRows()
    expect(rows).toHaveLength(5)
    expect(rows.reduce((sum, r) => sum + r.credits, 0)).toBe(
      CASE_RESEARCH_CREDITS + EXACT_KEYWORD_CREDITS,
    )
    expect(
      rows.every(
        (r) =>
          r.purpose === 'case-research' && r.channelId === FIRST_CHANNEL_ID && r.projectId === null,
      ),
    ).toBe(true)
    expect(rows.map((r) => r.tool).sort()).toEqual([
      'vidiq_get_videos_by_ids',
      'vidiq_keyword_research',
      'vidiq_keyword_research',
      'vidiq_keyword_research',
      'vidiq_outliers',
    ])
    // The ledger holds the arguments as sent on the wire: the subject phrase is measured on its own.
    const modes = rows
      .filter((r) => r.tool === 'vidiq_keyword_research')
      .map((r) => (r.args as { mode?: string }).mode)
      .sort()
    expect(modes).toEqual(['matching_terms', 'questions', 'research'])
    const exact = rows.find((r) => (r.args as { mode?: string }).mode === 'research')
    expect(exact?.args).toEqual({
      keyword: SUBJECT,
      mode: 'research',
      limit: 1,
      includeRelated: false,
    })
  })

  it('stores titles apart from keywords', async () => {
    const row = (keyword: string, overall: number, monthly: number) => ({
      keyword,
      volume: 50,
      competition: 30,
      overall,
      estimatedMonthlySearch: monthly,
      growthPct: null,
    })
    seams.clientOverride = (real) => ({
      ...(real as object),
      keywordResearch: async (_subject: string, options: { mode: string }) => ({
        data:
          options.mode === 'questions'
            ? [row('why did wework fail', 1, 0)]
            : [row('wework documentary', 60, 100), row('wework: the rise and fall', 90, 500)],
        credits: 5,
        args: { keyword: SUBJECT, mode: options.mode },
      }),
    })
    await engine.execute(request())
    const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
    expect(brief.targetKeyword?.keyword).toBe('wework documentary')
    expect(brief.secondaryKeywords).toEqual([])
    expect(brief.searchedTitles.map((r) => r.keyword)).toEqual(['wework: the rise and fall'])
    expect(brief.otherLanguages).toEqual([])
  })

  it('stores a recommendation', async () => {
    await engine.execute(request())
    const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
    expect(brief.recommendedAngle).not.toBeNull()
    expect(brief.recommendedAngle).toBeLessThan(brief.angleOptions.length)
    expect(brief.recommendationReason).toBeTruthy()
  })

  it('saves the brief when the rating cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    seams.ratingOverride = async () => ({ ok: false, error: 'unreadable' })
    const { result } = await engine.execute(request())
    expect(result).toMatchObject({ outcome: 'researched' })
    const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
    expect(brief.recommendedAngle).toBeNull()
    expect(brief.recommendationReason).toBeNull()
    expect(brief.angleOptions.length).toBeGreaterThanOrEqual(2)
  })

  it('a winners answer at the parser allowance still saves a brief, cut to the brief limits', async () => {
    // Six patterns and ten beats were the parser's old caps; the brief holds 5 and 8.
    seams.winnersOverride = {
      titlePatterns: Array.from({ length: 6 }, (_, i) => `Pattern ${'x'.repeat(i)} {subject}`),
      toldAlready: Array.from({ length: 10 }, (_, i) => `beat ${'y'.repeat(i)}`),
    }
    const { result } = await engine.execute(request())
    expect(result).toMatchObject({ outcome: 'researched' })
    const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
    expect(brief.titlePatterns).toHaveLength(5)
    expect(brief.toldAlready).toHaveLength(8)
    expect((await getCase(db, caseId))?.searchJob?.state).toBe('done')
  })

  it('a result that cannot fit the brief stops without a retry, with a plain reason and no brief', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // An angle under the schema's minimum length is no list overrun, so no slice mends it.
    seams.anglesOverride = [{ angle: 'too short', keyword: 'wework', answers: [], gap: 'g' }]
    const { error } = await engine.execute(request())
    const plain = 'The research result did not fit the brief format, so nothing was saved.'
    expect(JSON.stringify(error)).toContain(plain)
    expect(JSON.stringify(error)).not.toContain('ZodError')
    await fail(plain)

    const row = await getCase(db, caseId)
    expect(row?.searchBrief).toBeNull()
    expect(row?.searchJob).toMatchObject({ state: 'failed', error: plain })
  })

  it('keeps the first of a keyword or question VidIQ repeats, ignoring case', async () => {
    const row = (keyword: string, overall: number) => ({
      keyword,
      volume: 50,
      competition: 30,
      overall,
      estimatedMonthlySearch: null,
      growthPct: null,
    })
    seams.clientOverride = (real) => ({
      ...(real as object),
      keywordResearch: async (_subject: string, options: { mode: string }) => ({
        data:
          options.mode === 'questions'
            ? [
                row('why did wework fail', 1),
                row('Why did WeWork fail', 1),
                row('is wework dead', 1),
              ]
            : [
                row('wework documentary', 60),
                row('WeWork Documentary', 99),
                row('wework podcast', 40),
              ],
        credits: 5,
        args: { keyword: SUBJECT, mode: options.mode },
      }),
    })
    const { result } = await engine.execute(request())
    expect(result).toMatchObject({ outcome: 'researched' })
    const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
    const keywords = [brief.targetKeyword, ...brief.secondaryKeywords].map((k) => k?.keyword)
    expect(keywords.map((k) => k?.toLowerCase()).sort()).toEqual([
      'wework documentary',
      'wework podcast',
    ])
    // The first row wins, so the later row's higher score never lands.
    expect(brief.targetKeyword?.overall).toBe(60)
    expect(brief.searchedQuestions).toEqual(['why did wework fail', 'is wework dead'])
  })

  it('a subject VidIQ barely knows still saves a brief, with no target keyword and angles from the bible (Review Focus 1)', async () => {
    seams.clientOverride = (real) => ({
      ...(real as object),
      keywordResearch: async () => ({ data: [], credits: 5, args: { keyword: SUBJECT } }),
      outliers: async () => ({ data: [], credits: 5, args: { keyword: SUBJECT } }),
    })
    const { result } = await engine.execute(request())
    expect(result).toMatchObject({ outcome: 'researched' })

    const row = await getCase(db, caseId)
    const brief = SearchBriefSchema.parse(row?.searchBrief)
    expect(brief.targetKeyword).toBeNull()
    expect(brief.secondaryKeywords).toEqual([])
    expect(brief.searchedQuestions).toEqual([])
    expect(brief.outliers).toEqual([])
    expect(brief.titlePatterns).toEqual([])
    expect(brief.toldAlready).toEqual([])
    expect(brief.angleOptions).toHaveLength(2)
    expect(row?.searchJob?.state).toBe('done')

    // Four calls were made (no details call with no outliers), and no volume was invented.
    expect(await db.select().from(vidiqCredits)).toHaveLength(4)
  })

  it('a VidiqError on the outliers call fails the job with its message, keeps the three keyword rows before it and stores no brief (Review Focus 2)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { VidiqError } = await import('@boom-busters/providers/vidiq')
    seams.clientOverride = (real) => ({
      ...(real as object),
      outliers: async () => {
        throw new VidiqError('vidiq_outliers', 'The VidIQ key was refused')
      },
    })
    const { error } = await engine.execute(request())
    expect(JSON.stringify(error)).toContain('The VidIQ key was refused')
    await fail('vidiq_outliers: The VidIQ key was refused')

    const row = await getCase(db, caseId)
    expect(row?.searchBrief).toBeNull()
    expect(row?.searchJob).toMatchObject({
      state: 'failed',
      current: null,
      error: 'vidiq_outliers: The VidIQ key was refused',
    })
    const rows = await db.select().from(vidiqCredits)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.tool === 'vidiq_keyword_research')).toBe(true)
  })

  it('stops at the call where the cap is reached, with the cap message and no further call (Review Focus 5)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Three calls fit (15 credits); the fourth would make 20 of 17.
    await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 17 } })
    const calls: string[] = []
    seams.clientOverride = (real) => {
      const client = real as Record<string, (...args: unknown[]) => unknown>
      return {
        ...client,
        getVideosByIds: (...args: unknown[]) => {
          calls.push('getVideosByIds')
          return client['getVideosByIds']!(...args)
        },
      }
    }
    const { error } = await engine.execute(request())
    expect(JSON.stringify(error)).toContain('The VidIQ cap is reached: 15 of 17 credits used')
    await fail('The VidIQ cap is reached: 15 of 17 credits used this month')

    expect(calls).toEqual([])
    expect(await db.select().from(vidiqCredits)).toHaveLength(3)
    const row = await getCase(db, caseId)
    expect(row?.searchBrief).toBeNull()
    expect(row?.searchJob).toMatchObject({
      state: 'failed',
      error: 'The VidIQ cap is reached: 15 of 17 credits used this month',
    })
  })

  describe('the new checks', () => {
    const kw = (keyword: string, overall: number, monthly: number) => ({
      keyword,
      volume: 50,
      competition: 30,
      overall,
      estimatedMonthlySearch: monthly,
      growthPct: null,
    })
    const rowsOf = (rows: ReturnType<typeof kw>[]) => {
      seams.clientOverride = (real) => ({
        ...(real as object),
        keywordResearch: async (_subject: string, options: { mode: string }) => ({
          data: options.mode === 'questions' ? [] : rows,
          credits: 5,
          args: { keyword: SUBJECT, mode: options.mode },
        }),
      })
    }

    it('stores intent, fit and topic, and keeps off rows apart', async () => {
      rowsOf([
        kw('wework documentary', 60, 900),
        kw('wework office in pune', 70, 400),
        kw('wework podcast', 40, 100),
      ])
      seams.understandingOverride = () => ({
        niche: 'business collapses',
        terms: [
          { keyword: 'wework documentary', intent: 'wants the story', fit: 'fits', topic: 'story' },
          {
            keyword: 'wework office in pune',
            intent: 'wants an office',
            fit: 'off',
            topic: 'office',
          },
          { keyword: 'wework podcast', intent: 'wants audio', fit: 'partly', topic: 'audio' },
        ],
      })
      await engine.execute(request())
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.targetKeyword).toMatchObject({
        keyword: 'wework documentary',
        intent: 'wants the story',
        fit: 'fits',
        topic: 'story',
      })
      expect(brief.secondaryKeywords.map((k) => k.keyword)).toEqual(['wework podcast'])
      expect(brief.secondaryKeywords[0]).toMatchObject({ fit: 'partly', topic: 'audio' })
      expect(brief.offIntent?.map((k) => k.keyword)).toEqual(['wework office in pune'])
      expect(brief.niche).toBe('business collapses')
      expect(brief.language).toBe(FIRST_CHANNEL_BIBLE.language)
    })

    it('picks the first candidate whose field is not bad', async () => {
      rowsOf([kw('wework documentary', 60, 900), kw('wework story', 60, 100)])
      const base = seams.clientOverride!
      seams.clientOverride = (real) => {
        const client = base(real) as Record<string, unknown>
        const now = new Date().toISOString()
        const result = (subs: number, views: number, i: number) => ({
          videoId: `v${i}`,
          title: `Video ${i}`,
          channelTitle: 'Channel',
          subscribers: subs,
          views,
          publishedAt: now,
          seconds: 600,
        })
        return {
          ...client,
          youtubeSearch: async (query: string) => ({
            data:
              query === 'wework documentary'
                ? Array.from({ length: 10 }, (_, i) => result(5_000_000, 1_000_000, i))
                : Array.from({ length: 10 }, (_, i) => result(2_000, 50_000, i)),
            credits: 15,
            args: { query },
          }),
        }
      }
      await engine.execute(request())
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.fieldChecks?.map((c) => c.keyword)).toEqual([
        'wework documentary',
        'wework story',
      ])
      expect(brief.targetKeyword?.keyword).toBe('wework story')
      expect(brief.secondaryKeywords.map((k) => k.keyword)).toEqual(['wework documentary'])
    })

    it('stores comment themes and how many comments were read', async () => {
      await engine.execute(request())
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.commentsRead?.videos).toBe(Math.min(3, brief.outliers.length))
      expect(brief.commentsRead?.comments).toBeGreaterThan(0)
      expect(brief.commentThemes?.length).toBeGreaterThan(0)
      expect(brief.commentThemes?.[0]?.videoId).toBeTruthy()
      const rows = await db.select().from(vidiqCredits)
      expect(rows.filter((r) => r.tool === 'vidiq_video_comments')).toHaveLength(
        brief.commentsRead!.videos,
      )
    })

    it('stores the niche test for the recommended angle', async () => {
      await engine.execute(request())
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.nicheTests).toHaveLength(1)
      expect(brief.nicheTests?.[0]?.angle).toBe(brief.angleOptions[brief.recommendedAngle!]?.angle)
      expect(brief.skipped ?? []).toEqual([])
      const rows = await db.select().from(vidiqCredits)
      expect(rows.filter((r) => r.tool === 'vidiq_comment_insights')).toHaveLength(1)
    })

    it('saves the brief when the niche test times out', async () => {
      seams.nicheTimesOut = true
      const { result } = await engine.execute(request())
      expect(result).toMatchObject({ outcome: 'researched' })
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.nicheTests).toEqual([])
      expect(brief.skipped).toContain('niche test: no result')
    })

    it('keeps the paid niche job when the test times out, so the panel can collect it', async () => {
      seams.nicheTimesOut = true
      await engine.execute(request())
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.nicheJobs).toHaveLength(1)
      expect(brief.nicheJobs?.[0]).toEqual({
        angle: brief.angleOptions[brief.recommendedAngle!]?.angle,
        jobId: expect.any(String),
        startedAt: expect.any(String),
      })
    })

    it('skips optional steps at the cap and says so', async () => {
      // The 25 credits of the required calls and the subject measure fit; the field check (15) does not.
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 27 } })
      const { result } = await engine.execute(request())
      expect(result).toMatchObject({ outcome: 'researched' })
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.fieldChecks).toEqual([])
      expect(brief.skipped).toEqual(
        expect.arrayContaining(['field check: credit cap', 'comments: credit cap']),
      )
      expect(brief.skipped).toContain('niche test: credit cap')
      expect(await db.select().from(vidiqCredits)).toHaveLength(5)
    })

    it('an exact measure the cap refuses is skipped and recorded, and the run goes on', async () => {
      // matching terms (5) fit; the subject's exact measure would make 10 of 9.
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 9 } })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { error } = await engine.execute(request())
      // The required questions call then stops the run at the cap, as it always did.
      expect(JSON.stringify(error)).toContain('The VidIQ cap is reached')
      const rows = await db.select().from(vidiqCredits)
      expect(rows.map((r) => (r.args as { mode?: string }).mode)).toEqual(['matching_terms'])
    })

    it("measures the owner's seed keywords exactly, marks them theirs and keeps every one on the brief (decision 467)", async () => {
      const seeds = ['wework documentary', 'my own phrase', 'another own phrase']
      await updateCase(db, caseId, { seedKeywords: seeds })
      const { result } = await engine.execute(request())
      expect(result).toMatchObject({ outcome: 'researched' })
      const exact = (await db.select().from(vidiqCredits))
        .filter((r) => (r.args as { mode?: string }).mode === 'research')
        .map((r) => (r.args as { keyword: string }).keyword)
      expect(exact).toEqual([SUBJECT, ...seeds])
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      const shown = [
        ...(brief.targetKeyword ? [brief.targetKeyword] : []),
        ...brief.secondaryKeywords,
        ...(brief.offIntent ?? []),
      ]
      for (const seed of seeds) {
        expect(shown.find((k) => k.keyword === seed)).toMatchObject({ owner: true })
      }
      // The subject phrase is measured, not marked as the owner's.
      expect(shown.find((k) => k.keyword === SUBJECT.toLowerCase())?.owner).toBeUndefined()
    })

    it('gives the fit the pillar the owner filed under, so the mock keeps it (decision 467)', async () => {
      await engine.execute(request())
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.fit?.pillarKey).toBe('con')
    })

    it('seeds research with up to two people', async () => {
      await updateCase(db, caseId, { people: ['Adam Neumann', 'Miguel McKelvey', 'Third Person'] })
      const searched: string[] = []
      type Real = {
        keywordResearch: (subject: string, options: { mode: string }) => Promise<unknown>
      }
      seams.clientOverride = (real) => ({
        ...(real as object),
        keywordResearch: async (subject: string, options: { mode: string }) => {
          if (options.mode === 'matching_terms') searched.push(subject)
          return (real as Real).keywordResearch(subject, options)
        },
      })
      await engine.execute(request())
      expect(searched).toEqual([SUBJECT, 'Adam Neumann', 'Miguel McKelvey'])
    })

    it('seeds a person once, ignoring case and spaces, before taking two', async () => {
      await updateCase(db, caseId, {
        people: [' Adam Neumann ', 'adam neumann', 'ADAM NEUMANN', 'Miguel McKelvey'],
      })
      const searched: string[] = []
      type Real = {
        keywordResearch: (subject: string, options: { mode: string }) => Promise<unknown>
      }
      seams.clientOverride = (real) => ({
        ...(real as object),
        keywordResearch: async (subject: string, options: { mode: string }) => {
          if (options.mode === 'matching_terms') searched.push(subject)
          return (real as Real).keywordResearch(subject, options)
        },
      })
      await engine.execute(request())
      expect(searched).toEqual([SUBJECT, 'Adam Neumann', 'Miguel McKelvey'])
    })
  })

  describe('the job it owns', () => {
    it('refreshes the heartbeat and names the step before it spends, so a long run stays alive', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const old = new Date(Date.now() - 40 * 60_000).toISOString()
      await writeCaseResearchJob(db, caseId, () => job({ startedAt: old }))
      // The run stops at its first call (the cap), after the heartbeat.
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 3 } })
      await engine.execute(request(old))
      const stored = (await getCase(db, caseId))!.searchJob!
      expect(stored.startedAt).toBe(old)
      expect(stored.current).toBe('keywords-terms')
      expect(Date.now() - Date.parse(stored.heartbeatAt!)).toBeLessThan(60_000)
      expect(caseResearchJobIsRunning(stored)).toBe(true)
    })

    it('a run that lost its job writes nothing: no call, no row, no brief, and the newer job is left alone', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const before = (await getCase(db, caseId))!.searchJob
      const lost = new Date(Date.now() - 5 * 60_000).toISOString()
      const { error } = await engine.execute(request(lost))
      expect(JSON.stringify(error)).toContain('A newer job has taken the case')
      await fail('A newer job has taken the case', lost)

      expect(await db.select().from(vidiqCredits)).toHaveLength(0)
      const row = await getCase(db, caseId)
      expect(row?.searchBrief).toBeNull()
      expect(row?.searchJob).toEqual(before)
    })

    it('a stopped job (no longer running) is not written to either', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      await writeCaseResearchJob(db, caseId, () => job({ state: 'failed', error: 'Stopped' }))
      const { error } = await engine.execute(request())
      expect(JSON.stringify(error)).toContain('A newer job has taken the case')
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)
      expect((await getCase(db, caseId))?.searchBrief).toBeNull()
    })

    it('the fail writer marks the job it owns failed, and no other', async () => {
      await failCaseResearch(caseId, 'VidIQ did not answer', 'not-this-job')
      expect((await getCase(db, caseId))!.searchJob).toMatchObject({ state: 'running' })
      await failCaseResearch(caseId, 'VidIQ did not answer', startedAt)
      expect((await getCase(db, caseId))!.searchJob).toMatchObject({
        state: 'failed',
        error: 'VidIQ did not answer',
        startedAt,
      })
    })
  })

  describe('the format seed and the fit', () => {
    const sleep = {
      ...defaultFormat('Sleep'),
      key: 'sleep',
      primary: false,
      keywords: ['history for sleep'],
    }
    const main = { ...defaultFormat('Main'), keywords: [] as string[] }

    /** Runs with the channel's bible holding these formats, then puts the first channel's bible back. */
    async function withFormats(
      formats: ChannelFormat[],
      formatKey: string | null,
      check: () => Promise<void>,
    ) {
      await withTemporaryBible(
        db,
        FIRST_CHANNEL_ID,
        { ...FIRST_CHANNEL_BIBLE, formats },
        async () => {
          await setCaseFormat(db, caseId, formatKey)
          await check()
        },
      )
    }

    /** Records each matching-terms search the run makes. */
    function recordSearches(): string[] {
      const searched: string[] = []
      type Real = {
        keywordResearch: (subject: string, options: { mode: string }) => Promise<unknown>
      }
      seams.clientOverride = (real) => ({
        ...(real as object),
        keywordResearch: async (subject: string, options: { mode: string }) => {
          if (options.mode === 'matching_terms') searched.push(subject)
          return (real as Real).keywordResearch(subject, options)
        },
      })
      return searched
    }

    it('a format with a lead keyword makes a second matching-terms spend and saves formatKey and fit', async () => {
      const searched = recordSearches()
      await withFormats([main, sleep], 'sleep', async () => {
        const { result } = await engine.execute(request())
        expect(result).toMatchObject({ outcome: 'researched' })
        expect(searched).toEqual([SUBJECT, `${SUBJECT} history for sleep`])
        const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
        expect(brief.formatKey).toBe('sleep')
        expect(brief.fit).toMatchObject({ inScope: true, reason: 'Mock fit.' })
        const rows = await requiredRows()
        expect(rows).toHaveLength(6)
        expect(rows.reduce((sum, r) => sum + r.credits, 0)).toBe(
          CASE_RESEARCH_CREDITS + 5 + EXACT_KEYWORD_CREDITS,
        )
      })
    })

    it('a format without keywords makes the one matching-terms spend it always did', async () => {
      const searched = recordSearches()
      await withFormats([main, sleep], 'main', async () => {
        await engine.execute(request())
        expect(searched).toEqual([SUBJECT])
        const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
        expect(brief.formatKey).toBe('main')
        expect(await requiredRows()).toHaveLength(5)
      })
    })

    it('a load result memoised before the deploy (no leadKeyword, no formatKey) buys no format search and saves a null key', async () => {
      const searched = recordSearches()
      const { result } = await engine.execute({
        ...request(),
        steps: [
          {
            id: 'load',
            handler: () => ({
              channelId: FIRST_CHANNEL_ID,
              subject: SUBJECT,
              angleIdea: null,
            }),
          },
        ],
      })
      expect(result).toMatchObject({ outcome: 'researched' })
      expect(searched).toEqual([SUBJECT])
      const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
      expect(brief.formatKey).toBeNull()
      expect(await requiredRows()).toHaveLength(5)
    })

    it('a stale case key resolves to the primary', async () => {
      const searched = recordSearches()
      const primary = { ...sleep, primary: true }
      await withFormats([{ ...main, primary: false }, primary], 'gone', async () => {
        await engine.execute(request())
        expect(searched).toEqual([SUBJECT, `${SUBJECT} history for sleep`])
        const brief = SearchBriefSchema.parse((await getCase(db, caseId))?.searchBrief)
        expect(brief.formatKey).toBe('sleep')
      })
    })
  })
})
