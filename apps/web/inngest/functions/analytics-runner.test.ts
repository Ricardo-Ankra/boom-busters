// @vitest-environment node

import {
  archiveChannel,
  channelYoutubeConnection,
  createChannel,
  FIXTURE_PROJECT_ID,
  freezeSearchReport,
  getPublishRecord,
  latestSnapshotForVideo,
  pendingReport,
  publishRecords,
  recordChannelYoutubeVerify,
  requireTestDatabase,
  saveBibleVersion,
  saveChannelYoutubeConnection,
  searchReportsForVideo,
  seed,
  snapshotsSince,
  truncateAnalytics,
  truncateRunMirror,
  truncateSearchReports,
  updatePublishRecord,
  youtubeConnections,
} from '@boom-busters/db'
import { buildDigestRequest } from '@boom-busters/providers'
import type { DigestLine } from '@boom-busters/providers'
import {
  buildSearchReport,
  BudgetExceededError,
  DEFAULT_RESEARCH_THRESHOLDS,
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  FIRST_CHANNEL_IN_USE,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { forgetRunRows } from '../middleware/run-mirror'
import { YoutubeAuthError } from '@/lib/youtube'
import type * as YoutubeAnalytics from '@/lib/youtube-analytics'
import { mockVideoAnalytics, mockVideoFacts } from '@/lib/youtube-analytics'
import { analyticsRunner, worstRetentionDrop, writeDigestWith } from './analytics-runner'

/**
 * The analytics-runner in mock-provider mode against the real database:
 * scheduled records whose slot has passed go live, live videos get one
 * snapshot per day, and Mondays produce a digest through `notify()`. The
 * real-API parsing is covered in `lib/youtube-analytics.test.ts`.
 */

const notify = vi.fn()
vi.mock('@/lib/notify', () => ({
  notify: (...args: unknown[]) => notify(...args),
}))

const google = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  pingChannel: vi.fn(),
}))
vi.mock('@/lib/youtube', () => ({
  refreshAccessToken: (...args: unknown[]) => google.refreshAccessToken(...args),
  pingChannel: (...args: unknown[]) => google.pingChannel(...args),
  youtubeConfigured: () => true,
  YoutubeAuthError: class YoutubeAuthError extends Error {
    needsReconnect = true
  },
}))

const analytics = vi.hoisted(() => ({
  fetchPrivacyStatuses: vi.fn(),
  fetchVideoAnalytics: vi.fn(),
  fetchVideoFacts: vi.fn(),
}))
vi.mock('@/lib/youtube-analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof YoutubeAnalytics>()),
  fetchPrivacyStatuses: (...args: unknown[]) => analytics.fetchPrivacyStatuses(...args),
  fetchVideoAnalytics: (...args: unknown[]) => analytics.fetchVideoAnalytics(...args),
  fetchVideoFacts: (...args: unknown[]) => analytics.fetchVideoFacts(...args),
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const LIVE_VIDEO = 'yt-live-1'
const SCHEDULED_VIDEO = 'yt-scheduled-1'

function refreshEvent(
  data: Record<string, unknown> = {},
): [{ name: string; data: Record<string, unknown> }] {
  return [{ name: 'analytics/refresh.requested', data }]
}

async function connect(channelId: string, youtubeChannelId: string): Promise<void> {
  await saveChannelYoutubeConnection(db, channelId, {
    refreshToken: `1//refresh-${youtubeChannelId}`,
    encryptionKey: env.SECRETS_ENCRYPTION_KEY,
    youtubeChannelId,
    youtubeChannelTitle: youtubeChannelId,
  })
  await recordChannelYoutubeVerify(db, channelId, 'ok', youtubeChannelId)
}

/** A fresh channel each time: an earlier test may have archived the last one. */
async function secondChannel(): Promise<string> {
  const created = await createChannel(db, {
    name: 'Second channel',
    handle: null,
    slug: `analytics-second-${Math.random().toString(36).slice(2, 8)}`,
    settings: DEFAULT_SETTINGS,
    bible: EMPTY_BIBLE,
  })
  return created.id
}

describe('worstRetentionDrop', () => {
  it('names the steepest fall, ignores noise, and survives empty curves', () => {
    expect(worstRetentionDrop(null)).toBeNull()
    expect(worstRetentionDrop([])).toBeNull()
    expect(
      worstRetentionDrop([
        { pct: 0, ratio: 0.95 },
        { pct: 25, ratio: 0.9 },
        { pct: 50, ratio: 0.7 },
        { pct: 75, ratio: 0.65 },
      ]),
    ).toBe(50)
    // A flat curve has no drop worth naming.
    expect(
      worstRetentionDrop([
        { pct: 0, ratio: 0.9 },
        { pct: 50, ratio: 0.895 },
      ]),
    ).toBeNull()
  })
})

describe('writeDigestWith (decision 293)', () => {
  const lines: DigestLine[] = [
    {
      label: 'The audit',
      targetType: 'master',
      views: 1200,
      viewsDelta: 300,
      avgViewDurationSec: 210,
      topSource: 'BROWSE',
      worstDropPct: 40,
    },
  ]
  const input = { bible: FIRST_CHANNEL_IN_USE, weekOf: '2026-08-31', lines }
  const budget = buildDigestRequest(input).maxTokens

  it('asks once more at double the budget when the digest is cut off, and sends none of the half', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: 'Views rose by 300 this week, led by', truncated: true })
      .mockResolvedValueOnce({ text: 'Views rose by 300 this week, led by browse.' })
    expect(await writeDigestWith(complete, input)).toBe(
      'Views rose by 300 this week, led by browse.',
    )
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].maxTokens).toBe(budget * 2)
    expect(complete.mock.calls[1]![1]).toBe('retry: cut off')
  })

  it('stops with the reason after a second cut-off, for onFailure to report', async () => {
    const complete = vi.fn().mockResolvedValue({ text: 'Views rose by', truncated: true })
    const writing = writeDigestWith(complete, input)
    await expect(writing).rejects.toBeInstanceOf(NonRetriableError)
    await expect(writing).rejects.toThrow(
      'The weekly digest could not be written: the answer was cut off at its length limit',
    )
    expect(complete).toHaveBeenCalledTimes(2)
  })

  it('lets a budget stop through, for the step to skip the digest quietly', async () => {
    const over = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'llm.digest',
      budgetUsd: 30,
      monthSpendUsd: 30,
      estimateUsd: 0.01,
    })
    await expect(writeDigestWith(vi.fn().mockRejectedValue(over), input)).rejects.toBe(over)
  })
})

describeDb('analytics-runner (mock mode)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: analyticsRunner })
    vi.clearAllMocks()
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await truncateRunMirror(db)
    await truncateAnalytics(db)
    await truncateSearchReports(db)
    forgetRunRows()
    await db.delete(publishRecords)
    // Only the first channel is connected unless a test says otherwise.
    await db.delete(youtubeConnections)
    await connect(FIRST_CHANNEL_ID, 'UC-first')

    await db.insert(publishRecords).values([
      {
        channelId: FIRST_CHANNEL_ID,
        targetType: 'master',
        targetId: FIXTURE_PROJECT_ID,
        youtubeVideoId: LIVE_VIDEO,
        status: 'live',
        publishAt: new Date('2026-08-20T15:00:00Z'),
      },
      {
        channelId: FIRST_CHANNEL_ID,
        targetType: 'short',
        targetId: '01HQ00000000000000000000S1',
        youtubeVideoId: SCHEDULED_VIDEO,
        status: 'scheduled',
        // In the past: the mock reconciliation flips it live.
        publishAt: new Date('2026-08-21T09:00:00Z'),
      },
      {
        channelId: FIRST_CHANNEL_ID,
        targetType: 'short',
        targetId: '01HQ00000000000000000000S2',
        status: 'draft',
      },
    ])
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it(
    'flips past-slot scheduled records live and snapshots every live video',
    { timeout: 60_000 },
    async () => {
      const { result } = await engine.execute({ events: refreshEvent() })

      expect(result).toMatchObject({
        outcome: 'ran',
        channels: [{ channelId: FIRST_CHANNEL_ID, outcome: 'ran', reconciled: 1 }],
      })

      const flipped = await getPublishRecord(db, 'short', '01HQ00000000000000000000S1')
      expect(flipped?.status).toBe('live')
      // The draft with no video is untouched.
      expect((await getPublishRecord(db, 'short', '01HQ00000000000000000000S2'))?.status).toBe(
        'draft',
      )

      // Both live videos got a deterministic snapshot for today.
      for (const videoId of [LIVE_VIDEO, SCHEDULED_VIDEO]) {
        const snapshot = await latestSnapshotForVideo(db, videoId)
        expect(snapshot?.views).not.toBeNull()
        expect(snapshot?.retentionCurve).toHaveLength(20)
        expect(snapshot?.rpm).toBeNull()
        // The live search card reads these: the snapshot must carry them.
        expect(snapshot?.searchTerms?.length).toBeGreaterThan(0)
        expect(snapshot?.subscribersGained).not.toBeNull()
        expect(snapshot?.likes).not.toBeNull()
        expect(snapshot?.comments).not.toBeNull()
      }
    },
  )

  it(
    'freezes the due reports in mock mode and reports the count',
    { timeout: 60_000 },
    async () => {
      // Published 40 days ago: day 7 and day 28 are due, day 90 is not.
      const publishedAt = new Date(Date.now() - 40 * 86_400_000)
      const master = await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      await updatePublishRecord(db, master!.id, { publishAt: publishedAt })

      const { result } = await engine.execute({ events: refreshEvent() })

      expect(result).toMatchObject({ channels: [{ outcome: 'ran', searchReports: 2 }] })
      const rows = await searchReportsForVideo(db, LIVE_VIDEO)
      expect(rows.map((row) => [row.checkpoint, row.state])).toEqual([
        [7, 'frozen'],
        [28, 'frozen'],
      ])
      // The fixture project has no search brief, so there is nothing to judge.
      expect(rows[0]?.report).toMatchObject({ checkpoint: 7, outcome: 'no-research' })
      expect(rows[1]?.report).toMatchObject({ checkpoint: 28, outcome: 'no-research' })

      // The next day's run finds both frozen and does nothing more.
      engine = new InngestTestEngine({ function: analyticsRunner })
      const again = await engine.execute({ events: refreshEvent() })
      expect(again.result).toMatchObject({ channels: [{ outcome: 'ran', searchReports: 0 }] })
    },
  )

  it(
    're-running the same day updates the row rather than duplicating it',
    { timeout: 60_000 },
    async () => {
      await engine.execute({ events: refreshEvent() })
      // A NEW engine: the test engine memoises step results per instance, and
      // this test is about a genuine second run, not a replay.
      engine = new InngestTestEngine({ function: analyticsRunner })
      await engine.execute({ events: refreshEvent() })

      const today = new Date()
      const midnight = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
      )
      const rows = await snapshotsSince(db, FIRST_CHANNEL_ID, midnight)
      expect(rows.filter((row) => row.videoId === LIVE_VIDEO)).toHaveLength(1)
    },
  )

  it(
    'sends the digest on Mondays and stays quiet the rest of the week',
    { timeout: 60_000 },
    async () => {
      // Fake only Date — the engine's own timers must stay real.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-31T06:00:05Z')) // a Monday

      const { result } = await engine.execute({ events: refreshEvent() })
      expect(result).toMatchObject({ channels: [{ digestSent: true }] })

      const digest = notify.mock.calls
        .map(([notification]) => notification as { kind: string; body: string })
        .find((notification) => notification.kind === 'weekly-digest')
      expect(digest).toBeDefined()
      expect(digest!.body).toContain('[mock]')

      // Tuesday: numbers land, no email. Fresh engine — see above.
      notify.mockClear()
      vi.setSystemTime(new Date('2026-09-01T06:00:05Z'))
      engine = new InngestTestEngine({ function: analyticsRunner })
      const second = await engine.execute({ events: refreshEvent() })
      expect(second.result).toMatchObject({ channels: [{ digestSent: false }] })
      expect(
        notify.mock.calls.some(
          ([notification]) => (notification as { kind: string }).kind === 'weekly-digest',
        ),
      ).toBe(false)
    },
  )

  it(
    "the Monday digest carries this week's frozen report outcome",
    { timeout: 60_000 },
    async () => {
      const frozen = async (checkpoint: 7 | 28, outcome: 'hit-then-left' | 'missed-target') => {
        const row = await pendingReport(db, {
          channelId: FIRST_CHANNEL_ID,
          projectId: FIXTURE_PROJECT_ID,
          videoId: LIVE_VIDEO,
          checkpoint,
        })
        const report = buildSearchReport({
          checkpoint,
          range: { start: '2026-08-20', end: '2026-09-17' },
          publishedAt: '2026-08-20T15:00:00.000Z',
          durationSec: 150,
          views: 1000,
          searchViews: 400,
          avgViewDurationSec: 60,
          subscribersGained: 10,
          likes: 50,
          comments: 5,
          retentionCurve: null,
          terms: [{ term: 't', views: 100, minutes: 100, bucket: 'target' }],
          targetKeyword: 't',
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
          thresholds: DEFAULT_RESEARCH_THRESHOLDS,
          now: new Date('2026-09-20T10:00:00.000Z'),
        })
        await freezeSearchReport(db, row.id, { ...report, outcome })
      }
      // Two froze this week: the higher checkpoint is the one named.
      await frozen(7, 'missed-target')
      await frozen(28, 'hit-then-left')

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-31T06:00:05Z')) // a Monday

      await engine.execute({ events: refreshEvent() })

      const digest = notify.mock.calls
        .map(([notification]) => notification as { kind: string; body: string })
        .find((notification) => notification.kind === 'weekly-digest')
      expect(digest!.body).toContain('Day 28 search report: Hit, then left')
      expect(digest!.body).not.toContain('Day 7 search report')
    },
  )

  describe('across channels', () => {
    function liveMode(): void {
      vi.stubEnv('MOCK_PROVIDERS', '0')
      // A Tuesday: no digest unless a test asks for one.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-09-01T06:00:05Z'))
      google.refreshAccessToken.mockResolvedValue({ accessToken: 'ya29.fresh' })
      google.pingChannel.mockResolvedValue({ ok: true, channelId: 'UC-first' })
      analytics.fetchPrivacyStatuses.mockResolvedValue(new Map())
      // No publish dates: the live runs here take snapshots and no search reports.
      analytics.fetchVideoFacts.mockImplementation((_token: string, ids: string[]) =>
        Promise.resolve(mockVideoFacts(ids, new Map())),
      )
      analytics.fetchVideoAnalytics.mockImplementation((_token: string, videoId: string) =>
        Promise.resolve(mockVideoAnalytics(videoId)),
      )
    }

    it(
      'with two channels and one connected: one token, one digest, no failure, the other untouched',
      { timeout: 60_000 },
      async () => {
        const second = await secondChannel()
        vi.setSystemTime(new Date('2026-08-31T06:00:05Z')) // a Monday
        const { result } = await engine.execute({ events: refreshEvent() })

        // Mock mode on a Monday: the connected channel's digest, nobody else's.
        expect(result).toMatchObject({
          outcome: 'ran',
          channels: [{ channelId: FIRST_CHANNEL_ID, outcome: 'ran', digestSent: true }],
        })
        const digests = notify.mock.calls.filter(
          ([notification]) => (notification as { kind: string }).kind === 'weekly-digest',
        )
        expect(digests).toHaveLength(1)
        expect(await channelYoutubeConnection(db, second)).toBeUndefined()

        // Live mode: exactly one token is minted, for the connected channel.
        vi.unstubAllEnvs()
        liveMode()
        engine = new InngestTestEngine({ function: analyticsRunner })
        const live = await engine.execute({ events: refreshEvent() })
        expect(live.result).toMatchObject({ channels: [{ channelId: FIRST_CHANNEL_ID }] })
        expect(google.refreshAccessToken).toHaveBeenCalledTimes(1)
        expect(google.refreshAccessToken).toHaveBeenCalledWith('1//refresh-UC-first')
        expect(await channelYoutubeConnection(db, second)).toBeUndefined()
      },
    )

    it(
      'skips the digest of a channel whose bible is incomplete and sends the next channel its own',
      { timeout: 60_000 },
      async () => {
        const second = await createChannel(db, {
          name: 'Second channel',
          handle: null,
          slug: `analytics-second-${Math.random().toString(36).slice(2, 8)}`,
          settings: DEFAULT_SETTINGS,
          bible: FIRST_CHANNEL_BIBLE,
        })
        await connect(second.id, 'UC-second')
        await db.insert(publishRecords).values({
          channelId: second.id,
          targetType: 'master',
          targetId: '01HQ00000000000000000000S9',
          youtubeVideoId: 'yt-second-1',
          status: 'live',
          publishAt: new Date('2026-08-20T15:00:00Z'),
        })
        // The first channel's current bible goes blank, then is put back.
        await saveBibleVersion(db, FIRST_CHANNEL_ID, EMPTY_BIBLE, 'Blanked for a test')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        try {
          vi.setSystemTime(new Date('2026-08-31T06:00:05Z')) // a Monday
          const { result } = await engine.execute({ events: refreshEvent() })

          expect(result).toMatchObject({
            channels: [
              { channelId: FIRST_CHANNEL_ID, outcome: 'ran', digestSent: false },
              { channelId: second.id, outcome: 'ran', digestSent: true },
            ],
          })
          const digests = notify.mock.calls
            .map(([notification]) => notification as { kind: string; title: string })
            .filter((notification) => notification.kind === 'weekly-digest')
          expect(digests).toHaveLength(1)
          expect(digests[0]!.title).toContain('Second channel')
          expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom-busters'))
          expect(warn).toHaveBeenCalledWith(expect.stringContaining('subject'))
        } finally {
          warn.mockRestore()
          await saveBibleVersion(db, FIRST_CHANNEL_ID, FIRST_CHANNEL_BIBLE, 'Restored after a test')
        }
      },
    )

    it(
      'skips a connected channel that is archived, and leaves its connection alone',
      { timeout: 60_000 },
      async () => {
        const second = await secondChannel()
        await connect(second, 'UC-second')
        await archiveChannel(db, second)
        const before = await channelYoutubeConnection(db, second)

        liveMode()
        const { result } = await engine.execute({ events: refreshEvent() })

        expect(result).toMatchObject({ channels: [{ channelId: FIRST_CHANNEL_ID }] })
        expect((result as { channels: unknown[] }).channels).toHaveLength(1)
        expect(google.refreshAccessToken).toHaveBeenCalledTimes(1)
        expect(google.refreshAccessToken).not.toHaveBeenCalledWith('1//refresh-UC-second')
        expect(await channelYoutubeConnection(db, second)).toEqual(before)
      },
    )

    it('a refresh that names a channel runs only that channel', { timeout: 60_000 }, async () => {
      const second = await secondChannel()
      await connect(second, 'UC-second')
      liveMode()
      google.pingChannel.mockResolvedValue({ ok: true, channelId: 'UC-second' })

      const { result } = await engine.execute({ events: refreshEvent({ channelId: second }) })

      expect((result as { channels: { channelId: string }[] }).channels).toEqual([
        expect.objectContaining({ channelId: second, outcome: 'ran' }),
      ])
      expect(google.refreshAccessToken).toHaveBeenCalledTimes(1)
      expect(google.refreshAccessToken).toHaveBeenCalledWith('1//refresh-UC-second')
    })

    it(
      'a dead token marks that channel and notifies with its href; the others still run',
      { timeout: 60_000 },
      async () => {
        const second = await secondChannel()
        await connect(second, 'UC-second')
        liveMode()
        google.refreshAccessToken.mockImplementation((token: string) =>
          token === '1//refresh-UC-first'
            ? Promise.reject(new YoutubeAuthError('invalid_grant'))
            : Promise.resolve({ accessToken: 'ya29.second' }),
        )
        google.pingChannel.mockResolvedValue({ ok: true, channelId: 'UC-second' })

        const { result } = await engine.execute({ events: refreshEvent() })

        const outcomes = (result as { channels: { channelId: string; outcome: string }[] }).channels
        expect(outcomes).toEqual([
          { channelId: FIRST_CHANNEL_ID, outcome: 'needs-reconnect' },
          expect.objectContaining({ channelId: second, outcome: 'ran' }),
        ])
        expect((await channelYoutubeConnection(db, FIRST_CHANNEL_ID))?.verifyStatus).toBe('invalid')
        expect((await channelYoutubeConnection(db, second))?.verifyStatus).toBe('ok')

        const reconnect = notify.mock.calls
          .map(([notification]) => notification as { kind: string; href: string })
          .filter((notification) => notification.kind === 'reconnect-youtube')
        expect(reconnect).toHaveLength(1)
        expect(reconnect[0]!.href).toBe('/c/boom-busters/settings?tab=connections')
      },
    )

    it(
      'a connection stored invalid is pinged again and heals when the ping answers with its own id',
      { timeout: 60_000 },
      async () => {
        // A transient failure (5xx, quota) marked it invalid yesterday.
        await recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, 'invalid')
        liveMode() // the ping answers ok with UC-first, the stored id

        const { result } = await engine.execute({ events: refreshEvent() })

        expect(result).toMatchObject({
          channels: [{ channelId: FIRST_CHANNEL_ID, outcome: 'ran', reconciled: 0, snapshots: 1 }],
        })
        expect((await channelYoutubeConnection(db, FIRST_CHANNEL_ID))?.verifyStatus).toBe('ok')
        expect(await latestSnapshotForVideo(db, LIVE_VIDEO)).toBeDefined()
        expect(
          notify.mock.calls.some(
            ([notification]) => (notification as { kind: string }).kind === 'reconnect-youtube',
          ),
        ).toBe(false)
      },
    )

    it(
      'a retriable ping failure leaves an ok connection ok, sends no notice and skips the channel',
      { timeout: 60_000 },
      async () => {
        liveMode()
        await recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, 'ok', 'UC-first')
        google.pingChannel.mockResolvedValue({ ok: false, error: 'Backend Error', retriable: true })

        const { result } = await engine.execute({ events: refreshEvent() })

        expect(result).toMatchObject({
          channels: [{ channelId: FIRST_CHANNEL_ID, outcome: 'ping-unavailable' }],
        })
        expect((await channelYoutubeConnection(db, FIRST_CHANNEL_ID))?.verifyStatus).toBe('ok')
        expect(
          notify.mock.calls.some(
            ([notification]) => (notification as { kind: string }).kind === 'reconnect-youtube',
          ),
        ).toBe(false)
        expect(await latestSnapshotForVideo(db, LIVE_VIDEO)).toBeUndefined()
      },
    )

    it(
      'an auth failure on the ping (401) still marks the connection invalid',
      { timeout: 60_000 },
      async () => {
        liveMode()
        await recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, 'ok', 'UC-first')
        google.pingChannel.mockResolvedValue({ ok: false, error: 'Invalid Credentials' })

        await engine.execute({ events: refreshEvent() })

        expect((await channelYoutubeConnection(db, FIRST_CHANNEL_ID))?.verifyStatus).toBe('invalid')
      },
    )

    it(
      'a ping naming another YouTube channel marks it invalid, says so once, and does no work for it',
      { timeout: 60_000 },
      async () => {
        const second = await secondChannel()
        await connect(second, 'UC-second')
        liveMode()
        google.refreshAccessToken.mockImplementation((token: string) =>
          Promise.resolve({
            accessToken: token === '1//refresh-UC-first' ? 'ya29.first' : 'ya29.second',
          }),
        )
        // The first channel's grant now answers for a different YouTube channel.
        google.pingChannel.mockImplementation((accessToken: string) =>
          Promise.resolve({
            ok: true,
            channelId: accessToken === 'ya29.first' ? 'UC-someone-else' : 'UC-second',
          }),
        )

        const { result } = await engine.execute({ events: refreshEvent() })

        expect((result as { channels: { channelId: string; outcome: string }[] }).channels).toEqual(
          [
            { channelId: FIRST_CHANNEL_ID, outcome: 'needs-reconnect' },
            expect.objectContaining({ channelId: second, outcome: 'ran' }),
          ],
        )
        expect((await channelYoutubeConnection(db, FIRST_CHANNEL_ID))?.verifyStatus).toBe('invalid')
        expect((await channelYoutubeConnection(db, second))?.verifyStatus).toBe('ok')

        const reconnect = notify.mock.calls
          .map(([notification]) => notification as { kind: string; href: string })
          .filter((notification) => notification.kind === 'reconnect-youtube')
        expect(reconnect).toHaveLength(1)
        expect(reconnect[0]!.href).toBe('/c/boom-busters/settings?tab=connections')

        // No reconcile or snapshot work was done with the wrong account's token.
        for (const call of [
          ...analytics.fetchPrivacyStatuses.mock.calls,
          ...analytics.fetchVideoAnalytics.mock.calls,
        ]) {
          expect(call[0]).not.toBe('ya29.first')
        }
        expect(await latestSnapshotForVideo(db, LIVE_VIDEO)).toBeUndefined()
      },
    )
  })
})
