import { and, desc, eq, gte, min, sql } from 'drizzle-orm'
import type { Database } from './client'
import { analyticsSnapshots } from './schema'
import type { AnalyticsSnapshotRow } from './schema'

/**
 * Analytics snapshots (build spec section 5, filled by the analytics-runner,
 * M8). One row per video per UTC day, upserted: the cron may re-run, a
 * manual refresh may land on the same day, and neither must duplicate.
 *
 * Numbers are lifetime-to-date at snapshot time, not per-day deltas — the
 * digest computes deltas by subtracting two snapshots, which stays correct
 * even when a day's cron never ran.
 */

export interface AnalyticsSnapshotInput {
  channelId: string
  videoId: string
  /** UTC midnight of the day the snapshot was taken for. */
  date: Date
  retentionCurve?: { pct: number; ratio: number }[] | null
  /**
   * Named for the spec section 5 column. The Analytics API exposes no
   * impressions CTR, so this carries the closest honest thing: views by
   * traffic source type.
   */
  ctrBySource?: Record<string, number> | null
  avgViewDurationSec?: number | null
  views?: number | null
  /** Stays null until the yt-analytics-monetary scope is granted. */
  rpm?: number | null
  shortsFeedStats?: Record<string, number> | null
  /** YouTube search terms for the snapshot's range. */
  searchTerms?: { term: string; views: number; minutes: number }[] | null
  subscribersGained?: number | null
  likes?: number | null
  comments?: number | null
}

export async function upsertAnalyticsSnapshot(
  db: Database,
  input: AnalyticsSnapshotInput,
): Promise<void> {
  const values = {
    channelId: input.channelId,
    videoId: input.videoId,
    date: input.date,
    retentionCurve: input.retentionCurve ?? null,
    ctrBySource: input.ctrBySource ?? null,
    avgViewDurationSec: input.avgViewDurationSec ?? null,
    views: input.views ?? null,
    rpm: input.rpm === undefined || input.rpm === null ? null : String(input.rpm),
    shortsFeedStats: input.shortsFeedStats ?? null,
    searchTerms: input.searchTerms ?? null,
    subscribersGained: input.subscribersGained ?? null,
    likes: input.likes ?? null,
    comments: input.comments ?? null,
  }
  await db
    .insert(analyticsSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [analyticsSnapshots.videoId, analyticsSnapshots.date],
      set: {
        retentionCurve: values.retentionCurve,
        ctrBySource: values.ctrBySource,
        avgViewDurationSec: values.avgViewDurationSec,
        views: values.views,
        rpm: values.rpm,
        shortsFeedStats: values.shortsFeedStats,
        searchTerms: values.searchTerms,
        subscribersGained: values.subscribersGained,
        likes: values.likes,
        comments: values.comments,
        updatedAt: sql`now()`,
      },
    })
}

/** The newest snapshot for one video — the retention overlay's read. */
export async function latestSnapshotForVideo(
  db: Database,
  videoId: string,
): Promise<AnalyticsSnapshotRow | undefined> {
  const [row] = await db
    .select()
    .from(analyticsSnapshots)
    .where(eq(analyticsSnapshots.videoId, videoId))
    .orderBy(desc(analyticsSnapshots.date))
    .limit(1)
  return row
}

/**
 * The day of a video's earliest snapshot, or null when it has none. Snapshots start the day the
 * daily run first sees the video live and never move, so this is a stable publish date.
 */
export async function firstSnapshotDateForVideo(
  db: Database,
  videoId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ first: min(analyticsSnapshots.date) })
    .from(analyticsSnapshots)
    .where(eq(analyticsSnapshots.videoId, videoId))
  return row?.first ?? null
}

/** Snapshots on or after a moment, oldest first — the weekly digest's read. */
export async function snapshotsSince(
  db: Database,
  channelId: string,
  since: Date,
): Promise<AnalyticsSnapshotRow[]> {
  return db
    .select()
    .from(analyticsSnapshots)
    .where(and(eq(analyticsSnapshots.channelId, channelId), gte(analyticsSnapshots.date, since)))
    .orderBy(analyticsSnapshots.videoId, analyticsSnapshots.date)
}

/** Test-only: empty the table. */
export async function truncateAnalytics(db: Database): Promise<void> {
  await db.delete(analyticsSnapshots)
}
