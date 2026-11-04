import { sql } from 'drizzle-orm'
import type { Database } from './client'
import { projects, voiceTakes } from './schema'

export interface MeasuredPace {
  wordsPerMinute: number
  /** How many takes the rate is drawn from. */
  takes: number
}

/**
 * The pace the channel's voice actually speaks at: the words in each of its
 * latest takes (one timing per word) over the take's voiced seconds. A
 * paragraph's current take is its highest take number; only takes holding both
 * timings and a duration count, newest first, up to `takeLimit`. Null when none
 * does, so the formats card can say "Not measured yet".
 */
export async function measuredPace(
  db: Database,
  channelId: string,
  takeLimit = 40,
): Promise<MeasuredPace | null> {
  const rows = await db.execute(sql`
    select
      coalesce(sum(latest.words), 0)::float8 as words,
      coalesce(sum(latest.duration_ms), 0)::float8 as duration_ms,
      count(*)::int as takes
    from (
      select current_take.duration_ms, current_take.words
      from (
        select distinct on (${voiceTakes.projectId}, ${voiceTakes.chapterId}, ${voiceTakes.paragraphIndex})
          ${voiceTakes.durationMs} as duration_ms,
          case when jsonb_typeof(${voiceTakes.timings}) = 'array'
            then jsonb_array_length(${voiceTakes.timings}) end as words,
          ${voiceTakes.createdAt} as created_at
        from ${voiceTakes}
        join ${projects} on ${projects.id} = ${voiceTakes.projectId}
        where ${projects.channelId} = ${channelId}
        order by ${voiceTakes.projectId}, ${voiceTakes.chapterId}, ${voiceTakes.paragraphIndex},
          ${voiceTakes.takeNumber} desc
      ) as current_take
      where current_take.duration_ms > 0 and current_take.words > 0
      order by current_take.created_at desc
      limit ${takeLimit}
    ) as latest
  `)
  const row = rows[0] as { words: number; duration_ms: number; takes: number } | undefined
  if (!row || row.takes === 0 || row.duration_ms <= 0) return null
  return {
    wordsPerMinute: Math.round(row.words / (row.duration_ms / 60_000)),
    takes: row.takes,
  }
}
