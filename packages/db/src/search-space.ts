import { SEARCH_BRIEF_STALE_DAYS } from '@boom-busters/schemas'
import { desc, eq } from 'drizzle-orm'
import type { Database } from './client'
import { measurementKey } from './keyword-measurements'
import { channelSearchSpace } from './schema'
import type { NewSearchSpaceRow, SearchSpaceDurations, SearchSpaceRow } from './schema'

/**
 * What winning looks like in each format keyword, kept outside bible versions.
 * One row per analysis; the latest per keyword (compared without case) shows.
 */

export async function saveSearchSpace(db: Database, row: NewSearchSpaceRow): Promise<void> {
  await db.insert(channelSearchSpace).values(row)
}

/** The channel's latest analysis of each keyword, keyed by the lower-cased keyword. */
export async function latestSearchSpace(
  db: Database,
  channelId: string,
): Promise<Map<string, SearchSpaceRow>> {
  const rows = await db
    .select()
    .from(channelSearchSpace)
    .where(eq(channelSearchSpace.channelId, channelId))
    .orderBy(desc(channelSearchSpace.measuredAt))
  const latest = new Map<string, SearchSpaceRow>()
  for (const row of rows) {
    const key = measurementKey(row.keyword)
    if (!latest.has(key)) latest.set(key, row)
  }
  return latest
}

/** The shortest, middle and longest of the durations (the lower middle when even); null for none. */
export function durationSpread(seconds: readonly number[]): SearchSpaceDurations | null {
  if (seconds.length === 0) return null
  const sorted = [...seconds].sort((a, b) => a - b)
  return {
    minSec: sorted[0]!,
    medianSec: sorted[Math.floor((sorted.length - 1) / 2)]!,
    maxSec: sorted[sorted.length - 1]!,
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A format's keywords, once each (compared without case), that have no analysis
 * from the last `SEARCH_BRIEF_STALE_DAYS` days. Order follows the format.
 */
export function searchSpaceKeywords(
  keywords: readonly string[],
  latest: Map<string, SearchSpaceRow>,
  now: Date,
): string[] {
  const seen = new Set<string>()
  const wanted: string[] = []
  for (const raw of keywords) {
    const keyword = raw.trim()
    const key = measurementKey(keyword)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    const last = latest.get(key)
    const fresh =
      last !== undefined &&
      now.getTime() - last.measuredAt.getTime() <= SEARCH_BRIEF_STALE_DAYS * DAY_MS
    if (!fresh) wanted.push(keyword)
  }
  return wanted
}
