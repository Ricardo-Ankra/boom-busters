import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  latestSnapshotForVideo,
  snapshotsSince,
  truncateAnalytics,
  upsertAnalyticsSnapshot,
} from './analytics'
import { createChannel, ensureFirstChannel, getChannelBySlug } from './channels'
import { createDb } from './client'
import { requireTestDatabase } from './test-database'

/**
 * Snapshot bookkeeping: one row per video per UTC day whatever re-runs, and
 * the reads the overlay and the digest depend on.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const VIDEO = 'yt-video-abc123'

suite('analytics snapshots', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await truncateAnalytics(db)
    await ensureFirstChannel(db)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('upserts on (video, day) — a re-run updates, never duplicates', async () => {
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-27'),
      views: 100,
    })
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-27'),
      views: 140,
      retentionCurve: [{ pct: 0, ratio: 0.95 }],
    })

    const rows = await snapshotsSince(db, FIRST_CHANNEL_ID, day('2026-08-01'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.views).toBe(140)
    expect(rows[0]!.retentionCurve).toEqual([{ pct: 0, ratio: 0.95 }])
  })

  it('latestSnapshotForVideo reads the newest day, per video', async () => {
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-25'),
      views: 90,
    })
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-27'),
      views: 150,
    })
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: 'other',
      date: day('2026-08-28'),
      views: 5,
    })

    const latest = await latestSnapshotForVideo(db, VIDEO)
    expect(latest?.views).toBe(150)
    expect(await latestSnapshotForVideo(db, 'never-seen')).toBeUndefined()
  })

  it('snapshotsSince bounds the digest week honestly', async () => {
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-18'),
      views: 10,
    })
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-24'),
      views: 60,
    })
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-27'),
      views: 80,
    })

    const week = await snapshotsSince(db, FIRST_CHANNEL_ID, day('2026-08-24'))
    expect(week.map((row) => row.views)).toEqual([60, 80])
  })

  it('snapshotsSince reads one channel only', async () => {
    const second =
      (await getChannelBySlug(db, 'analytics-second')) ??
      (await createChannel(db, {
        name: 'Second channel',
        handle: null,
        slug: 'analytics-second',
        settings: DEFAULT_SETTINGS,
        bible: EMPTY_BIBLE,
      }))
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-27'),
      views: 10,
    })
    await upsertAnalyticsSnapshot(db, {
      channelId: second.id,
      videoId: 'second-video',
      date: day('2026-08-27'),
      views: 20,
    })

    const first = await snapshotsSince(db, FIRST_CHANNEL_ID, day('2026-08-01'))
    expect(first.map((row) => row.videoId)).toEqual([VIDEO])
    const other = await snapshotsSince(db, second.id, day('2026-08-01'))
    expect(other.map((row) => row.videoId)).toEqual(['second-video'])
  })

  it('stores rpm as null until the monetary scope exists — never a guess', async () => {
    await upsertAnalyticsSnapshot(db, {
      channelId: FIRST_CHANNEL_ID,
      videoId: VIDEO,
      date: day('2026-08-27'),
      views: 1,
    })
    const row = await latestSnapshotForVideo(db, VIDEO)
    expect(row?.rpm).toBeNull()
  })
})
