import { TimelineSchema } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { CHAPTER_HOLD_MS, CHAPTER_OVERLAP_MS } from './compile'
import { buildDuckingCurve } from './ducking'

/**
 * Where the music is cued: the one rule for the compiler and for bed swaps
 * (decision 457). The opening chapter cues at 0; a later chapter cues at its
 * card (the chapterCard for that index, or the titleCard that resumes right
 * into its first word), else at its unmarked break's lead point, the hold
 * before its first word.
 *
 * A timeline without a chapters list predates decision 457 and keeps the old
 * rule: every chapterCard start, or, if there are none, each chapter's first
 * word.
 */
export function chapterCuePoints(
  timeline: Pick<Timeline, 'narration' | 'overlays' | 'chapters'>,
): { tMs: number; style: 'chapter' }[] {
  const firstSegments: { chapterId: string; startMs: number }[] = []
  const seen = new Set<string>()
  for (const segment of timeline.narration) {
    if (seen.has(segment.chapterId)) continue
    seen.add(segment.chapterId)
    firstSegments.push(segment)
  }

  if (timeline.chapters === undefined) {
    const cards = timeline.overlays.filter((overlay) => overlay.kind === 'chapterCard')
    const starts =
      cards.length > 0 ? cards.map((o) => o.startMs) : firstSegments.map((s) => s.startMs)
    return starts.map((tMs) => ({ tMs, style: 'chapter' as const }))
  }

  return firstSegments.map((first, i) => {
    if (i === 0) return { tMs: 0, style: 'chapter' as const }
    const card = timeline.overlays.find(
      (overlay) =>
        (overlay.kind === 'chapterCard' || overlay.kind === 'titleCard') &&
        overlay.startMs + overlay.durationMs - CHAPTER_OVERLAP_MS === first.startMs,
    )
    return {
      tMs: card ? card.startMs : Math.max(0, first.startMs - CHAPTER_HOLD_MS),
      style: 'chapter' as const,
    }
  })
}

/**
 * Swap the music bed under a compiled timeline — the preview screen's music
 * picker (build spec section 11.3: "changing it recompiles the timeline,
 * which is cheap and free").
 *
 * Cheap and free because nothing about the bed depends on the assembly
 * inputs: the ducking curve is a function of the NARRATION (where speech is,
 * where the silences are) and the brand's gain numbers, and the cue points
 * are the chapter starts — all of which the compiled timeline already
 * carries. So a swap is a pure function of the timeline itself, not a re-run
 * of the assembly stage: same curve for any bed, rebuilt here so a timeline
 * whose first compile had NO music (empty library) gains a correct curve the
 * moment a bed is chosen.
 */
export function swapMusicBed(
  timeline: Timeline,
  bed: { r2Key: string; durationMs?: number | null } | null,
): Timeline {
  if (bed === null) {
    return TimelineSchema.parse({ ...timeline, music: null })
  }

  return TimelineSchema.parse({
    ...timeline,
    music: {
      r2Key: bed.r2Key,
      // The length travels with the key: the renderer overlaps loop copies
      // with it rather than restarting the file on its fade-out (decision 256).
      ...(bed.durationMs ? { durationMs: bed.durationMs } : {}),
      gainDb: timeline.brand.music.bedGainDb,
      duckingCurve: buildDuckingCurve(timeline.narration, {
        bedGainDb: timeline.brand.music.bedGainDb,
        duckDepthDb: timeline.brand.music.duckDepthDb,
      }),
      cuePoints: chapterCuePoints(timeline),
    },
  })
}
