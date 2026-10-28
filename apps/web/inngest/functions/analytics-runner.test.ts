// @vitest-environment node

import {
  archiveChannel,
  channelYoutubeConnection,
  createChannel,
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  latestSnapshotForVideo,
  publishRecords,
  recordChannelYoutubeVerify,
  requireTestDatabase,
  saveChannelYoutubeConnection,
  seed,
  snapshotsSince,
  truncateAnalytics,
  truncateRunMirror,
  youtubeConnections,
} from '@boom-busters/db'
import { buildDigestRequest } from '@boom-busters/providers'
import type { DigestLine } from '@boom-busters/providers'
import {
  BudgetExceededError,
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { forgetRunRows } from '../middleware/run-mirror'
import { YoutubeAuthError } from '@/lib/youtube'
import type * as YoutubeAnalytics from '@/lib/youtube-analytics'
import { mockVideoAnalytics } from '@/lib/youtube-analytics'
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
}))
vi.mock('@/lib/youtube-analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof YoutubeAnalytics>()),
  fetchPrivacyStatuses: (...args: unknown[]) => analytics.fetchPrivacyStatuses(...args),
  fetchVideoAnalytics: (...args: unknown[]) => analytics.fetchVideoAnalytics(...args),
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
  const input = { weekOf: '2026-08-31', lines }
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
      }
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

  describe('across channels', () => {
    function liveMode(): void {
      vi.stubEnv('MOCK_PROVIDERS', '0')
      // A Tuesday: no digest unless a test asks for one.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-09-01T06:00:05Z'))
      google.refreshAccessToken.mockResolvedValue({ accessToken: 'ya29.fresh' })
      google.pingChannel.mockResolvedValue({ ok: true, channelId: 'UC-first' })
      analytics.fetchPrivacyStatuses.mockResolvedValue(new Map())
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
