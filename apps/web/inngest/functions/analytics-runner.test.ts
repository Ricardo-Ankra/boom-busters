// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  latestSnapshotForVideo,
  publishRecords,
  requireTestDatabase,
  seed,
  snapshotsSince,
  truncateAnalytics,
  truncateRunMirror,
} from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { analyticsRunner, worstRetentionDrop } from './analytics-runner'

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

const describeDb = requireTestDatabase() ? describe : describe.skip

const LIVE_VIDEO = 'yt-live-1'
const SCHEDULED_VIDEO = 'yt-scheduled-1'

function refreshEvent(): [{ name: string; data: Record<string, unknown> }] {
  return [{ name: 'analytics/refresh.requested', data: {} }]
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

    await db.insert(publishRecords).values([
      {
        targetType: 'master',
        targetId: FIXTURE_PROJECT_ID,
        youtubeVideoId: LIVE_VIDEO,
        status: 'live',
        publishAt: new Date('2026-08-20T15:00:00Z'),
      },
      {
        targetType: 'short',
        targetId: '01HQ00000000000000000000S1',
        youtubeVideoId: SCHEDULED_VIDEO,
        status: 'scheduled',
        // In the past: the mock reconciliation flips it live.
        publishAt: new Date('2026-08-21T09:00:00Z'),
      },
      {
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

      expect(result).toMatchObject({ outcome: 'ran', reconciled: 1 })

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
      const rows = await snapshotsSince(db, midnight)
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
      expect(result).toMatchObject({ digestSent: true })

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
      expect(second.result).toMatchObject({ digestSent: false })
      expect(
        notify.mock.calls.some(
          ([notification]) => (notification as { kind: string }).kind === 'weekly-digest',
        ),
      ).toBe(false)
    },
  )
})
