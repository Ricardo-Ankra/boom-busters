// @vitest-environment node

import { eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildSearchReport,
  DEFAULT_RESEARCH_THRESHOLDS,
  FIRST_CHANNEL_ID as CHANNEL_ID,
  suggestTuning,
} from '@boom-busters/schemas'
import { applySuggestionAction, dismissSuggestionAction, resetTuningAction } from './tuning-actions'

const store = vi.hoisted(() => ({
  applyResearchTuning: vi.fn(),
  channelResearchThresholds: vi.fn(),
  countedVideosForChannel: vi.fn(),
  dismissSuggestion: vi.fn(),
  resetResearchTuning: vi.fn(),
  suggestionDismissals: vi.fn(),
}))
vi.mock('@boom-busters/db', () => store)
vi.mock('@/lib/db', () => ({ db: { marker: 'db' } }))
const session = vi.hoisted(() => vi.fn())
vi.mock('@/auth', () => ({ auth: session }))
const writeRefusal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/channel-lookup', () => ({ channelWriteRefusal: writeRefusal }))
const revalidatePath = vi.hoisted(() => vi.fn())
vi.mock('next/cache', () => ({ revalidatePath }))
const suggestions = vi.hoisted(() => vi.fn())
vi.mock('./track-record-data', () => ({ liveSuggestions: suggestions }))

const STANDING = {
  key: 'demandWarn',
  direction: 'lower',
  from: 1000,
  to: 500,
  support: ['a', 'b', 'c'],
  sentence: 'Lower the warning line to 500?',
}

beforeEach(() => {
  for (const fn of Object.values(store)) fn.mockReset()
  store.applyResearchTuning.mockResolvedValue({})
  store.channelResearchThresholds.mockResolvedValue({ ...DEFAULT_RESEARCH_THRESHOLDS })
  store.countedVideosForChannel.mockResolvedValue([])
  store.suggestionDismissals.mockResolvedValue([])
  session.mockReset().mockResolvedValue({ user: { email: 'owner@example.com' } })
  writeRefusal.mockReset().mockResolvedValue(null)
  revalidatePath.mockReset()
  suggestions.mockReset().mockReturnValue([STANDING])
})

describe('tuning actions', () => {
  it('apply refuses a suggestion that no longer stands', async () => {
    suggestions.mockReturnValue([])
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({
      ok: false,
      error: 'That suggestion no longer stands.',
    })
    expect(store.applyResearchTuning).not.toHaveBeenCalled()
  })

  it('apply refuses the wrong direction or an unknown key', async () => {
    expect((await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'raise')).ok).toBe(false)
    expect((await applySuggestionAction(CHANNEL_ID, 'nonsense', 'lower')).ok).toBe(false)
    expect(store.applyResearchTuning).not.toHaveBeenCalled()
  })

  it('apply writes the live value with its sentence as evidence', async () => {
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({ ok: true })
    expect(store.applyResearchTuning).toHaveBeenCalledWith(
      { marker: 'db' },
      {
        channelId: CHANNEL_ID,
        key: 'demandWarn',
        value: 500,
        evidence: 'Lower the warning line to 500?',
      },
    )
    expect(revalidatePath).toHaveBeenCalled()
  })

  it('apply passes the store refusal back as the plain error', async () => {
    store.applyResearchTuning.mockRejectedValue(new Error('demandOk must be above demandWarn'))
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({
      ok: false,
      error: 'demandOk must be above demandWarn',
    })
  })

  it('dismiss records the live support count', async () => {
    expect(await dismissSuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({ ok: true })
    expect(store.dismissSuggestion).toHaveBeenCalledWith(
      { marker: 'db' },
      { channelId: CHANNEL_ID, key: 'demandWarn', direction: 'lower', support: 3 },
    )
  })

  it('dismiss refuses a suggestion that is gone', async () => {
    suggestions.mockReturnValue([])
    expect((await dismissSuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).error).toBe(
      'That suggestion no longer stands.',
    )
    expect(store.dismissSuggestion).not.toHaveBeenCalled()
  })

  it('reset deletes the override for a known key', async () => {
    expect(await resetTuningAction(CHANNEL_ID, 'demandWarn')).toEqual({ ok: true })
    expect(store.resetResearchTuning).toHaveBeenCalledWith(
      { marker: 'db' },
      CHANNEL_ID,
      'demandWarn',
    )
    expect((await resetTuningAction(CHANNEL_ID, 'nonsense')).ok).toBe(false)
  })

  it('every action checks the session first and refuses an unknown channel', async () => {
    session.mockResolvedValue(null)
    await expect(applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).rejects.toThrow(
      'Not signed in',
    )
    await expect(dismissSuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).rejects.toThrow()
    await expect(resetTuningAction(CHANNEL_ID, 'demandWarn')).rejects.toThrow()
    session.mockResolvedValue({ user: { email: 'owner@example.com' } })
    writeRefusal.mockResolvedValue({ ok: false, error: 'Unknown channel' })
    expect(await applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({
      ok: false,
      error: 'Unknown channel',
    })
    expect((await resetTuningAction('bad', 'demandWarn')).ok).toBe(false)
    expect(store.resetResearchTuning).not.toHaveBeenCalled()
  })
})

// Apply recomputes the suggestion on the server from the stored videos. This
// one runs the real store, the real read and the real suggestion rules against
// the test database, with only the session, the channel check and the cache
// stubbed, so a drift between the suggestion and what gets stored shows here.
const describeDb = process.env['TEST_DATABASE_URL'] ? describe : describe.skip

describeDb('apply against the real store', () => {
  const projectIds: string[] = []

  let cleanup: (() => Promise<void>) | null = null

  afterEach(async () => {
    await cleanup?.()
    cleanup = null
  })

  it('stores exactly the value the suggestion rules compute for the stored videos', async () => {
    vi.resetModules()
    vi.doUnmock('@boom-busters/db')
    vi.doUnmock('./track-record-data')
    const real = await vi.importActual<typeof import('@boom-busters/db')>('@boom-busters/db')
    const realDb = real.getDb(process.env['DATABASE_URL'] as string)
    vi.doMock('@/lib/db', () => ({ db: realDb }))
    // Only what this case created: its projects with their reports, and the
    // channel's tuning rows (none stood before it ran).
    cleanup = async () => {
      if (projectIds.length > 0) {
        await realDb
          .delete(real.searchReports)
          .where(inArray(real.searchReports.projectId, projectIds))
        await realDb.delete(real.projects).where(inArray(real.projects.id, projectIds))
        projectIds.length = 0
      }
      await realDb.delete(real.researchTuning).where(eq(real.researchTuning.channelId, CHANNEL_ID))
    }
    const actions = await import('./tuning-actions')

    await real.seed(realDb)
    const before = await real.channelResearchThresholds(realDb, CHANNEL_ID)
    const published = '2026-09-01T10:00:00.000Z'
    for (const [i, searches] of [300, 400, 500, 600, 700].entries()) {
      const title = `Unmocked apply video ${i + 1}`
      const project = await real.createProjectFromCase(realDb, {
        caseId: real.FIXTURE_CASE_ID,
        title,
      })
      projectIds.push(project.id)
      const brief = {
        subject: title,
        measuredAt: published,
        targetKeyword: {
          keyword: 'wirecard scandal',
          volume: 1,
          competition: 1,
          overall: 1,
          estimatedMonthlySearch: searches,
          growthPct: null,
          fit: 'fits',
          intent: 'how it collapsed',
          topic: 'collapse',
        },
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
        fieldChecks: [],
      }
      await realDb
        .update(real.projects)
        .set({
          searchBrief: brief as never,
          researchVerdict: {
            lines: [{ check: 'demand', state: 'warn', reason: 'Few searches a month.' }],
            thresholds: { ...before },
            frozenAt: published,
          },
        })
        .where(eq(real.projects.id, project.id))
      const report = buildSearchReport({
        checkpoint: 28,
        range: { start: '2026-09-01', end: '2026-09-29' },
        publishedAt: published,
        durationSec: 840,
        views: 4_000,
        searchViews: 1_600,
        avgViewDurationSec: 210,
        subscribersGained: 4,
        likes: 30,
        comments: 5,
        retentionCurve: null,
        terms: [
          { term: 'wirecard scandal', views: 900, minutes: 2_700, bucket: 'target' },
          { term: 'wirecard auditors', views: 300, minutes: 900, bucket: 'unresearched' },
        ],
        targetKeyword: 'wirecard scandal',
        matching: 'full',
        rank: null,
        baselineInputs: {
          holdBand: [],
          holdChannel: [],
          dropBand: [],
          dropChannel: [],
          subsBand: [],
          subsChannel: [],
        },
        thresholds: before,
        now: new Date('2026-10-02T06:00:00.000Z'),
      })
      const row = await real.pendingReport(realDb, {
        channelId: CHANNEL_ID,
        projectId: project.id,
        videoId: `mock-unmocked-apply-${i + 1}`,
        checkpoint: 28,
      })
      await real.freezeSearchReport(realDb, row.id, report)
    }

    const videos = await real.countedVideosForChannel(realDb, CHANNEL_ID)
    const dismissals = (await real.suggestionDismissals(realDb, CHANNEL_ID)).map((d) => ({
      key: d.key,
      direction: d.direction,
      support: d.supportAtDismissal,
    }))
    const expected = suggestTuning(videos, before, dismissals).find(
      (s) => s.key === 'demandWarn' && s.direction === 'lower',
    )
    expect(expected).toBeDefined()
    expect(expected!.to).toBeLessThan(before.demandWarn)

    expect(await actions.applySuggestionAction(CHANNEL_ID, 'demandWarn', 'lower')).toEqual({
      ok: true,
    })
    const after = await real.channelResearchThresholds(realDb, CHANNEL_ID)
    expect(after.demandWarn).toBe(expected!.to)
  })
})
