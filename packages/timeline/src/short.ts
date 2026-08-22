import { canonicalTimelineIssues, TimelineSchema, ValidationError } from '@boom-busters/schemas'
import type {
  Caption,
  NarrationSegment,
  Overlay,
  Timeline,
  TimelineSlot,
} from '@boom-busters/schemas'
import { buildDuckingCurve } from './ducking'

/**
 * The Short compiler (build spec section 7.2 item 7): a pure function from a
 * compiled MASTER timeline plus a segment reference to a vertical timeline.
 *
 * It slices rather than recompiles, and that is the point: the master already
 * carries everything a Short needs in its final, paid-for form — measured
 * narration audio, captions snapped to the script, visuals whose bytes were
 * ingested into R2 at assembly. Re-deriving any of that from board rows would
 * re-run work and could drift from what the human approved in the preview.
 * Re-framing 16:9 media into the 9:16 canvas is the composition's job
 * (cover-crop), not the compiler's.
 *
 * Golden-tested like the master compiler: same input, byte-identical output,
 * forever.
 */

export const SHORT_WIDTH = 1080
export const SHORT_HEIGHT = 1920

/**
 * YouTube treats vertical videos up to 3 minutes as Shorts (the limit rose
 * from 60 s in October 2024). Anything longer would silently upload as a
 * regular video, so a too-long segment is a compile error, not a warning.
 */
export const SHORT_MAX_DURATION_MS = 180_000

/** The CTA ending card's screen time, mirroring the chapter card's 2600 ms. */
export const END_CTA_MS = 2600

export const DEFAULT_CTA_TEXT = 'The full story is on the channel'

/** chapterId + paragraph range — the `shorts.segmentRef` column's shape. */
export interface ShortSegmentRef {
  chapterId: string
  fromParagraph: number
  toParagraph: number
}

export interface ShortCompileInput {
  /** The canonical (keys-only) master timeline the preview gate approved. */
  master: Timeline
  segmentRef: ShortSegmentRef
  /**
   * `loop`: the Short just ends and YouTube's player wraps to the start —
   * expressed as the absence of an ending overlay. `cta`: an endCta overlay
   * covers the final moments pointing viewers at the full video.
   */
  ending: 'loop' | 'cta'
  /** The shorts-style bed the caller picked from the music library. */
  music: { r2Key: string } | null
  ctaText?: string
}

export function compileShortTimeline(input: ShortCompileInput): Timeline {
  const { master, segmentRef } = input

  const materialised = canonicalTimelineIssues(master)
  if (materialised.length > 0) {
    throw new ValidationError(
      `the master timeline passed to the Short compiler contains materialised URLs ` +
        `(${materialised.join(', ')}) — slice the canonical stored form, never a render copy`,
      { field: materialised[0] ?? 'master' },
    )
  }

  if (segmentRef.toParagraph < segmentRef.fromParagraph) {
    throw new ValidationError(
      `segment paragraph range is inverted (${segmentRef.fromParagraph}..${segmentRef.toParagraph})`,
      { field: 'segmentRef' },
    )
  }

  // The window on the master clock: the chosen paragraphs' narration bounds.
  const segments = master.narration
    .filter(
      (segment) =>
        segment.chapterId === segmentRef.chapterId &&
        segment.paragraphIndex >= segmentRef.fromParagraph &&
        segment.paragraphIndex <= segmentRef.toParagraph,
    )
    .sort((a, b) => a.startMs - b.startMs)

  const expected = segmentRef.toParagraph - segmentRef.fromParagraph + 1
  if (segments.length !== expected) {
    throw new ValidationError(
      `the master timeline has ${segments.length} of the ${expected} narration segment(s) the ` +
        `Short references (chapter ${segmentRef.chapterId}, paragraphs ` +
        `${segmentRef.fromParagraph}..${segmentRef.toParagraph})`,
      { field: 'segmentRef' },
    )
  }

  const windowStart = segments[0]!.startMs
  const windowEnd = Math.max(...segments.map((segment) => segment.startMs + segment.durationMs))
  const durationMs = windowEnd - windowStart

  if (durationMs > SHORT_MAX_DURATION_MS) {
    throw new ValidationError(
      `the segment runs ${Math.round(durationMs / 1000)} s — longer than the ` +
        `${SHORT_MAX_DURATION_MS / 1000} s YouTube Shorts limit. Narrow the paragraph range.`,
      { field: 'segmentRef' },
    )
  }

  const narration: NarrationSegment[] = segments.map((segment) => ({
    r2Key: segment.r2Key,
    startMs: segment.startMs - windowStart,
    durationMs: segment.durationMs,
    chapterId: segment.chapterId,
    paragraphIndex: segment.paragraphIndex,
  }))

  // Captions: the window's words, re-clocked. Snap built them inside their
  // paragraph's span, so filtering on startMs is exact, not approximate.
  const words: Caption[] = master.captions.words
    .filter((word) => word.startMs >= windowStart && word.startMs < windowEnd)
    .map((word) => ({
      ...word,
      startMs: word.startMs - windowStart,
      endMs: Math.min(word.endMs - windowStart, durationMs),
      timestampMs:
        word.timestampMs === null ? null : Math.min(word.timestampMs - windowStart, durationMs),
    }))

  // Slots: everything overlapping the window, clipped to it. A video clipped
  // at the front starts deeper into its source so the visible frames match
  // what played at that moment of the master.
  const slots: TimelineSlot[] = master.slots
    .filter((slot) => slot.startMs < windowEnd && slot.startMs + slot.durationMs > windowStart)
    .map((slot) => {
      const clipFront = Math.max(0, windowStart - slot.startMs)
      const startMs = Math.max(0, slot.startMs - windowStart)
      const endMs = Math.min(slot.startMs + slot.durationMs, windowEnd) - windowStart
      const payload =
        slot.payload.kind === 'video' && clipFront > 0
          ? { ...slot.payload, trimStartMs: (slot.payload.trimStartMs ?? 0) + clipFront }
          : slot.payload
      return { ...slot, startMs, durationMs: endMs - startMs, payload }
    })

  if (slots.length === 0) {
    throw new ValidationError(
      'no visual slot overlaps the segment window — the master timeline should cover its ' +
        'whole clock, so this points at a broken master, not a bad segment choice',
      { field: 'segmentRef' },
    )
  }

  // Chapter cards and lower thirds are 16:9 furniture; a Short is visuals
  // and captions. The only overlay is the CTA ending, when asked for.
  const overlays: Overlay[] =
    input.ending === 'cta'
      ? [
          {
            kind: 'endCta',
            startMs: Math.max(0, durationMs - END_CTA_MS),
            durationMs: Math.min(END_CTA_MS, durationMs),
            props: { text: input.ctaText ?? DEFAULT_CTA_TEXT },
          },
        ]
      : []

  // The bed is the caller's pick (shorts style, not the documentary bed);
  // the curve is rebuilt for the re-clocked narration with the same brand
  // gains the master used — one ducking behaviour across both formats.
  const music = input.music
    ? {
        r2Key: input.music.r2Key,
        gainDb: master.brand.music.bedGainDb,
        duckingCurve: buildDuckingCurve(narration, {
          bedGainDb: master.brand.music.bedGainDb,
          duckDepthDb: master.brand.music.duckDepthDb,
        }),
        cuePoints: [{ tMs: 0, style: 'start' }],
      }
    : null

  const timeline = TimelineSchema.parse({
    version: master.version,
    fps: master.fps,
    width: SHORT_WIDTH,
    height: SHORT_HEIGHT,
    brand: master.brand,
    narration,
    music,
    captions: { words, style: master.captions.style },
    slots,
    overlays,
  })

  const issues = canonicalTimelineIssues(timeline)
  if (issues.length > 0) {
    throw new ValidationError(
      `compiled Short timeline contains materialised URLs (${issues.join(', ')})`,
      { field: issues[0] ?? 'timeline' },
    )
  }

  return timeline
}
