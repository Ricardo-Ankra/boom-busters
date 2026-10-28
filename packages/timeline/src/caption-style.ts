import { TimelineSchema } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'

/**
 * Whether a compiled timeline burns its captions into the picture
 * (decision 326). The words are always carried, on or off: turning captions
 * on later is a style flip, never a re-snap.
 */
export function captionsBurnedIn(timeline: Pick<Timeline, 'captions'>): boolean {
  return timeline.captions.style !== 'none'
}

/**
 * The caption style an assembly compiles with (decision 326): off for a
 * project's first timeline, and on a re-assembly whatever the owner last
 * chose, read from the previous version's stored JSON. A previous version
 * that does not parse counts as none.
 */
export function assemblyCaptionStyle(previous: unknown): Timeline['captions']['style'] {
  const parsed = previous === undefined ? null : TimelineSchema.safeParse(previous)
  return parsed?.success ? parsed.data.captions.style : 'none'
}

/**
 * Turn a compiled timeline's captions on or off, the preview screen's
 * captions button. Like a music swap it is a pure function of the timeline,
 * so the action stores the result as a new version and every render after it
 * (draft, master) draws what the preview showed.
 */
export function withCaptions(timeline: Timeline, on: boolean): Timeline {
  return TimelineSchema.parse({
    ...timeline,
    captions: { ...timeline.captions, style: on ? 'karaoke' : 'none' },
  })
}
