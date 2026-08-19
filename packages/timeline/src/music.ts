import { TimelineSchema } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { buildDuckingCurve } from './ducking'

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
export function swapMusicBed(timeline: Timeline, bed: { r2Key: string } | null): Timeline {
  if (bed === null) {
    return TimelineSchema.parse({ ...timeline, music: null })
  }

  // Chapter starts, from the narration: the first segment of each chapter in
  // playback order. The compiler derives its cue points the same way.
  const seen = new Set<string>()
  const cuePoints: { tMs: number; style: string }[] = []
  for (const segment of timeline.narration) {
    if (seen.has(segment.chapterId)) continue
    seen.add(segment.chapterId)
    cuePoints.push({ tMs: segment.startMs, style: 'chapter' })
  }

  return TimelineSchema.parse({
    ...timeline,
    music: {
      r2Key: bed.r2Key,
      gainDb: timeline.brand.music.bedGainDb,
      duckingCurve: buildDuckingCurve(timeline.narration, {
        bedGainDb: timeline.brand.music.bedGainDb,
        duckDepthDb: timeline.brand.music.duckDepthDb,
      }),
      cuePoints,
    },
  })
}
