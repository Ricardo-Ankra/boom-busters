// @vitest-environment node

import {
  createCase,
  deleteCase,
  getCase,
  requireTestDatabase,
  seed,
  truncateRunMirror,
  updateWorkspace,
  vidiqCredits,
  writeCaseResearchJob,
} from '@boom-busters/db'
import type { CaseResearchJob } from '@boom-busters/schemas'
import type * as VidiqModule from '@boom-busters/providers/vidiq'
import {
  CASE_RESEARCH_CREDITS,
  DEFAULT_WORKSPACE_SETTINGS,
  FIRST_CHANNEL_ID,
  SearchBriefSchema,
  caseResearchJobIsRunning,
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

const seams = vi.hoisted(() => ({
  clientOverride: null as null | ((real: unknown) => unknown),
}))

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

  it('saves a brief with a target keyword, short lists and two or three angles, in four ledger rows worth 20 credits', async () => {
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

    const rows = await db.select().from(vidiqCredits)
    expect(rows).toHaveLength(4)
    expect(rows.reduce((sum, r) => sum + r.credits, 0)).toBe(CASE_RESEARCH_CREDITS)
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
      'vidiq_outliers',
    ])
    // The ledger holds the arguments as sent on the wire.
    const modes = rows
      .filter((r) => r.tool === 'vidiq_keyword_research')
      .map((r) => (r.args as { mode?: string }).mode)
      .sort()
    expect(modes).toEqual(['matching_terms', 'questions'])
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

    // Three calls were made (no details call with no outliers), and no volume was invented.
    expect(await db.select().from(vidiqCredits)).toHaveLength(3)
  })

  it('a VidiqError on the outliers call fails the job with its message, keeps the first two ledger rows and stores no brief (Review Focus 2)', async () => {
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
    expect(rows).toHaveLength(2)
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
})
