import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  latestSnapshotForVideo,
  snapshotBefore,
  snapshotsSince,
  truncateAnalytics,
  upsertAnalyticsSnapshot,
} from './analytics'
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
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it('upserts on (video, day) — a re-run updates, never duplicates', async () => {
    await upsertAnalyticsSnapshot(db, { videoId: VIDEO, date: day('2026-08-27'), views: 100 })
    await upsertAnalyticsSnapshot(db, {
      videoId: VIDEO,
      date: day('2026-08-27'),
      views: 140,
      retentionCurve: [{ pct: 0, ratio: 0.95 }],
    })

    const rows = await snapshotsSince(db, day('2026-08-01'))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.views).toBe(140)
    expect(rows[0]!.retentionCurve).toEqual([{ pct: 0, ratio: 0.95 }])
  })

  it('latestSnapshotForVideo reads the newest day, per video', async () => {
    await upsertAnalyticsSnapshot(db, { videoId: VIDEO, date: day('2026-08-25'), views: 90 })
    await upsertAnalyticsSnapshot(db, { videoId: VIDEO, date: day('2026-08-27'), views: 150 })
    await upsertAnalyticsSnapshot(db, { videoId: 'other', date: day('2026-08-28'), views: 5 })

    const latest = await latestSnapshotForVideo(db, VIDEO)
    expect(latest?.views).toBe(150)
    expect(await latestSnapshotForVideo(db, 'never-seen')).toBeUndefined()
  })

  it('snapshotsSince and snapshotBefore bound the digest week honestly', async () => {
    await upsertAnalyticsSnapshot(db, { videoId: VIDEO, date: day('2026-08-18'), views: 10 })
    await upsertAnalyticsSnapshot(db, { videoId: VIDEO, date: day('2026-08-24'), views: 60 })
    await upsertAnalyticsSnapshot(db, { videoId: VIDEO, date: day('2026-08-27'), views: 80 })

    const week = await snapshotsSince(db, day('2026-08-24'))
    expect(week.map((row) => row.views)).toEqual([60, 80])

    const baseline = await snapshotBefore(db, VIDEO, day('2026-08-24'))
    expect(baseline?.views).toBe(60)
  })

  it('stores rpm as null until the monetary scope exists — never a guess', async () => {
    await upsertAnalyticsSnapshot(db, { videoId: VIDEO, date: day('2026-08-27'), views: 1 })
    const row = await latestSnapshotForVideo(db, VIDEO)
    expect(row?.rpm).toBeNull()
  })
})
