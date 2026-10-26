import type { ShotSlotRow } from '@boom-busters/db'
import { ShotBriefSchema } from '@boom-busters/schemas'
import { anchoredTimes, type TimedParagraph } from './shot-list'
import type { StretchRow } from './stretch'

/**
 * One chapter's rows on the clock the board shows (the stretch re-plan
 * design, 3.3): anchored over the whole film, exactly as the board anchors
 * them, then narrowed to the chapter. Shared by the stretch-replanner's `cut`
 * step and the action that refuses a selection, so both cut the same stretch.
 */
export function anchoredChapterRows(
  all: readonly ShotSlotRow[],
  chapterId: string,
  paragraphs: readonly TimedParagraph[],
): StretchRow[] {
  const covers = all.map((row) => {
    const brief = ShotBriefSchema.safeParse(row.brief)
    return brief.success ? brief.data.coversText : null
  })
  const times = anchoredTimes(
    all.map((row, at) => ({
      startMs: row.startMs,
      durationMs: row.durationMs,
      coversText: covers[at] ?? null,
    })),
    paragraphs,
  )
  return all.flatMap((row, at) =>
    row.chapterId === chapterId
      ? [
          {
            id: row.id,
            chapterId: row.chapterId,
            index: row.index,
            type: row.type,
            brief: row.brief,
            startMs: times[at]!.startMs,
            durationMs: times[at]!.durationMs,
            coversText: covers[at] ?? null,
          },
        ]
      : [],
  )
}
