import { SEARCH_BRIEF_STALE_DAYS } from '@boom-busters/schemas'
import type { ChannelBible } from '@boom-busters/schemas'
import { desc, eq } from 'drizzle-orm'
import type { Database } from './client'
import { keywordMeasurements } from './schema'
import type { KeywordMeasurementRow, NewKeywordMeasurement } from './schema'

/**
 * VidIQ readings of the bible's keywords, kept outside bible versions. One row
 * per measurement; the latest per keyword (compared without case) is what shows.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** The map's key for a keyword: trimmed and lower-cased. */
export const measurementKey = (keyword: string): string => keyword.trim().toLowerCase()

export async function recordKeywordMeasurement(
  db: Database,
  row: NewKeywordMeasurement,
): Promise<void> {
  await db.insert(keywordMeasurements).values(row)
}

/** The channel's latest reading of each keyword, keyed by the lower-cased keyword. */
export async function latestKeywordMeasurements(
  db: Database,
  channelId: string,
): Promise<Map<string, KeywordMeasurementRow>> {
  const rows = await db
    .select()
    .from(keywordMeasurements)
    .where(eq(keywordMeasurements.channelId, channelId))
    .orderBy(desc(keywordMeasurements.measuredAt))
  const latest = new Map<string, KeywordMeasurementRow>()
  for (const row of rows) {
    const key = measurementKey(row.keyword)
    if (!latest.has(key)) latest.set(key, row)
  }
  return latest
}

/**
 * Every format and pillar keyword, once (compared without case), that has no
 * reading from the last `SEARCH_BRIEF_STALE_DAYS` days. Order follows the bible:
 * formats first, then pillars.
 */
export function keywordsToMeasure(
  bible: ChannelBible,
  latest: Map<string, KeywordMeasurementRow>,
  now: Date,
): string[] {
  const seen = new Set<string>()
  const wanted: string[] = []
  const all = [
    ...bible.formats.flatMap((format) => format.keywords),
    ...bible.caseCategories.flatMap((category) => category.keywords),
  ]
  for (const raw of all) {
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
