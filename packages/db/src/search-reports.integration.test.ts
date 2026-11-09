import {
  DEFAULT_RESEARCH_THRESHOLDS,
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
  buildSearchReport,
  type Checkpoint,
} from '@boom-busters/schemas'
import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { latestSnapshotForVideo, truncateAnalytics, upsertAnalyticsSnapshot } from './analytics'
import { createCase } from './cases'
import { createChannel, ensureFirstChannel, getChannelBySlug } from './channels'
import { createDb } from './client'
import { createProjectFromCase } from './projects'
import { cases, projects } from './schema'
import {
  addRankCheck,
  countedVideosForChannel,
  dismissSearchTerm,
  dismissedTermKeys,
  freezeSearchReport,
  frozenReportsForChannel,
  latestOutcomeByProject,
  pendingReport,
  rankChecksForVideo,
  recordReportDeferral,
  searchReportsForVideo,
  truncateSearchReports,
} from './search-reports'
import { requireTestDatabase } from './test-database'

/**
 * Frozen per-video search reports against a real database: one row per
 * video and checkpoint, written once, and the reads the publish screen and the
 * Case Library depend on.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const emptyBaselines = {
  holdBand: [] as number[],
  holdChannel: [] as number[],
  dropBand: [] as number[],
  dropChannel: [] as number[],
  subsBand: [] as number[],
  subsChannel: [] as number[],
}

function reportFor(checkpoint: Checkpoint, views = 1000) {
  return buildSearchReport({
    checkpoint,
    range: { start: '2026-10-01', end: '2026-10-29' },
    publishedAt: '2026-10-01T10:00:00.000Z',
    durationSec: 150,
    views,
    searchViews: 400,
    avgViewDurationSec: 60,
    subscribersGained: 10,
    likes: 50,
    comments: 5,
    retentionCurve: [
      { pct: 0, ratio: 1 },
      { pct: 25, ratio: 0.5 },
    ],
    terms: [{ term: 't', views: 100, minutes: 100, bucket: 'target' }],
    targetKeyword: 't',
    matching: 'full',
    rank: null,
    baselineInputs: emptyBaselines,
    thresholds: DEFAULT_RESEARCH_THRESHOLDS,
    now: new Date('2026-11-02T10:00:00.000Z'),
  })
}

suite('search reports', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  async function project(channelId: string, title: string): Promise<string> {
    const kase = await createCase(db, { channelId, title, category: 'con' })
    return (await createProjectFromCase(db, { caseId: kase.id, title })).id
  }

  async function secondChannel() {
    return (
      (await getChannelBySlug(db, 'search-reports-second')) ??
      (await createChannel(db, {
        name: 'Second channel',
        handle: null,
        slug: 'search-reports-second',
        settings: DEFAULT_SETTINGS,
        bible: EMPTY_BIBLE,
      }))
    )
  }

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await truncateSearchReports(db)
    await truncateAnalytics(db)
    await ensureFirstChannel(db)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('pending is idempotent per video and checkpoint', async () => {
    const projectId = await project(FIRST_CHANNEL_ID, 'A')
    const input = { channelId: FIRST_CHANNEL_ID, projectId, videoId: 'v1', checkpoint: 28 }
    const first = await pendingReport(db, input)
    const second = await pendingReport(db, input)
    expect(second.id).toBe(first.id)
    expect(first.state).toBe('pending')
    expect(first.modelAttempts).toBe(0)
    expect(first.report).toBeNull()
    await pendingReport(db, { ...input, checkpoint: 7 })
    expect(await searchReportsForVideo(db, 'v1')).toHaveLength(2)
  })

  it('freeze writes once and never overwrites a frozen report', async () => {
    const projectId = await project(FIRST_CHANNEL_ID, 'A')
    const row = await pendingReport(db, {
      channelId: FIRST_CHANNEL_ID,
      projectId,
      videoId: 'v1',
      checkpoint: 28,
    })
    const original = reportFor(28, 1000)
    await freezeSearchReport(db, row.id, original)
    await freezeSearchReport(db, row.id, reportFor(28, 5000))
    const [stored] = await searchReportsForVideo(db, 'v1')
    expect(stored!.state).toBe('frozen')
    expect(stored!.frozenAt).not.toBeNull()
    expect(stored!.report).toEqual(original)
  })

  it('deferrals count per kind', async () => {
    const projectId = await project(FIRST_CHANNEL_ID, 'A')
    const row = await pendingReport(db, {
      channelId: FIRST_CHANNEL_ID,
      projectId,
      videoId: 'v1',
      checkpoint: 7,
    })
    await recordReportDeferral(db, row.id, 'model')
    await recordReportDeferral(db, row.id, 'model')
    const after = await recordReportDeferral(db, row.id, 'rank')
    expect(after.modelAttempts).toBe(2)
    expect(after.rankAttempts).toBe(1)
  })

  it('frozen reports list by channel and checkpoint only', async () => {
    const other = await secondChannel()
    const mine = await project(FIRST_CHANNEL_ID, 'Mine')
    const theirs = await project(other.id, 'Theirs')
    const mk = async (channelId: string, projectId: string, videoId: string, cp: Checkpoint) => {
      const row = await pendingReport(db, { channelId, projectId, videoId, checkpoint: cp })
      return row.id
    }
    await freezeSearchReport(db, await mk(FIRST_CHANNEL_ID, mine, 'v28', 28), reportFor(28))
    await freezeSearchReport(db, await mk(FIRST_CHANNEL_ID, mine, 'v7', 7), reportFor(7))
    await mk(FIRST_CHANNEL_ID, mine, 'vpending', 28)
    await freezeSearchReport(db, await mk(other.id, theirs, 'vother', 28), reportFor(28))

    const list = await frozenReportsForChannel(db, FIRST_CHANNEL_ID, 28)
    expect(list).toHaveLength(1)
    expect(list[0]!.videoId).toBe('v28')
    expect(list[0]!.projectId).toBe(mine)
    expect(list[0]!.report.checkpoint).toBe(28)
  })

  it('latest outcome per project prefers 90 over 28 over 7', async () => {
    const a = await project(FIRST_CHANNEL_ID, 'A')
    const b = await project(FIRST_CHANNEL_ID, 'B')
    const freeze = async (projectId: string, videoId: string, cp: Checkpoint) => {
      const row = await pendingReport(db, {
        channelId: FIRST_CHANNEL_ID,
        projectId,
        videoId,
        checkpoint: cp,
      })
      await freezeSearchReport(db, row.id, reportFor(cp))
    }
    await freeze(a, 'va', 7)
    await freeze(a, 'va', 90)
    await freeze(a, 'va', 28)
    await freeze(b, 'vb', 7)
    await pendingReport(db, {
      channelId: FIRST_CHANNEL_ID,
      projectId: b,
      videoId: 'vb',
      checkpoint: 28,
    })

    const latest = await latestOutcomeByProject(db, FIRST_CHANNEL_ID)
    expect(latest.size).toBe(2)
    expect(latest.get(a)?.checkpoint).toBe(90)
    expect(latest.get(a)?.outcome).toBe(reportFor(90).outcome)
    expect(latest.get(b)?.checkpoint).toBe(7)
  })

  it('dismissals are per channel', async () => {
    const other = await secondChannel()
    await dismissSearchTerm(db, FIRST_CHANNEL_ID, 'a b')
    await dismissSearchTerm(db, FIRST_CHANNEL_ID, 'a b')
    expect(await dismissedTermKeys(db, FIRST_CHANNEL_ID)).toEqual(new Set(['a b']))
    expect((await dismissedTermKeys(db, other.id)).size).toBe(0)
  })

  it('stores manual rank checks per video, newest first', async () => {
    await addRankCheck(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: 'v1',
      keyword: 'k',
      position: 4,
      checkedAt: new Date('2026-11-01T10:00:00.000Z'),
    })
    await addRankCheck(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: 'v1',
      keyword: 'k',
      position: null,
      checkedAt: new Date('2026-11-02T10:00:00.000Z'),
    })
    const checks = await rankChecksForVideo(db, 'v1')
    expect(checks).toHaveLength(2)
    expect(checks[0]!.position).toBeNull()
    expect(await rankChecksForVideo(db, 'other')).toHaveLength(0)
  })

  it('snapshots store search terms and engagement', async () => {
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: 'snap-video',
      date: new Date('2026-10-29T00:00:00.000Z'),
      views: 10,
      searchTerms: [{ term: 'a b', views: 3, minutes: 5 }],
      subscribersGained: 2,
      likes: 7,
      comments: 1,
    })
    const row = await latestSnapshotForVideo(db, 'snap-video')
    expect(row?.searchTerms).toEqual([{ term: 'a b', views: 3, minutes: 5 }])
    expect(row?.subscribersGained).toBe(2)
    expect(row?.likes).toBe(7)
    expect(row?.comments).toBe(1)
  })

  it('counted videos read day-28 frozen reports with their frozen verdicts', async () => {
    const other = await secondChannel()
    const mine = await project(FIRST_CHANNEL_ID, 'Mine')
    const noVerdict = await project(FIRST_CHANNEL_ID, 'No verdict')
    const day7 = await project(FIRST_CHANNEL_ID, 'Day seven')
    const theirs = await project(other.id, 'Theirs')
    const brief = {
      subject: 'Mine',
      measuredAt: '2026-10-01T10:00:00.000Z',
      targetKeyword: {
        keyword: 't',
        volume: 1,
        competition: 1,
        overall: 1,
        estimatedMonthlySearch: 3200,
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
    const verdict = {
      lines: [{ check: 'demand', state: 'ok', reason: 'fine' }],
      thresholds: { ...DEFAULT_RESEARCH_THRESHOLDS },
      frozenAt: '2026-10-01T10:00:00.000Z',
    }
    await db
      .update(projects)
      .set({ searchBrief: brief as never, researchVerdict: verdict })
      .where(eq(projects.id, mine))
    await db
      .update(projects)
      .set({ searchBrief: brief as never })
      .where(eq(projects.id, theirs))
    const freeze = async (
      channelId: string,
      projectId: string,
      videoId: string,
      cp: Checkpoint,
      views = 1000,
    ) => {
      const row = await pendingReport(db, { channelId, projectId, videoId, checkpoint: cp })
      await freezeSearchReport(db, row.id, reportFor(cp, views))
    }
    await freeze(FIRST_CHANNEL_ID, mine, 'vm', 28)
    await freeze(FIRST_CHANNEL_ID, noVerdict, 'vn', 28)
    await freeze(FIRST_CHANNEL_ID, day7, 'v7', 7)
    await freeze(other.id, theirs, 'vt', 28)
    await freeze(FIRST_CHANNEL_ID, mine, 'vm90', 90)
    const list = await countedVideosForChannel(db, FIRST_CHANNEL_ID)
    expect(list).toHaveLength(1)
    expect(list[0]!.projectId).toBe(mine)
    expect(list[0]!.title).toBe('Mine')
    expect(list[0]!.verdict.lines[0]!.check).toBe('demand')
    expect(list[0]!.verdict.recomputed).toBeUndefined()
    expect(list[0]!.demandSearches).toBe(3200)
    expect(list[0]!.targetIntent).toBe('how it collapsed')
    expect(list[0]!.targetTopic).toBe('collapse')
    expect(list[0]!.report.checkpoint).toBe(28)
  })
})
