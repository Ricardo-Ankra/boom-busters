import { TimelineSchema, ValidationError } from '@boom-busters/schemas'
import type { Timeline, TimelineSlot, WordTiming } from '@boom-busters/schemas'
import { offsetCaptions, snapToScript } from './snap'

/**
 * The teaser's mini master (decision 225).
 *
 * A teaser is NOT a slice of the project master: its narration is written and
 * synthesised for the funnel (cold open, escalation, cliffhanger). What it
 * borrows from the master is the visuals: every teaser paragraph names the
 * chapter it draws from, and the compile lifts one already-resolved slot from
 * that chapter's stretch of the master. Nothing is re-fetched and nothing is
 * re-generated; the board paid for those pixels once.
 *
 * The output is a small but complete `Timeline` on its own clock, stored on
 * the shorts row. The render then windows it with `compileShortTimeline`,
 * exactly as an excerpt windows the project master, which is what buys the
 * vertical canvas, the end CTA and the ducked shorts bed without a second
 * render path.
 */

/**
 * The pseudo chapter a teaser's narration lives in; its segmentRef target.
 * A fixed, well-formed ULID because the timeline schema requires one; it
 * spells its purpose in Crockford base32 and can never collide with a real
 * chapter id, which is generated randomly.
 */
export const TEASER_CHAPTER_ID = '0TEASERTEASERTEASERTEASERT'

/** Teasers breathe faster than the film: a beat, not a pause. */
export const TEASER_GAP_MS = 400

export interface TeaserParagraphAudio {
  text: string
  chapterIndex: number
  r2Key: string
  durationMs: number
  /** From the synthesis alignment; null falls back to even spacing. */
  wordTimings: WordTiming[] | null
}

/** The master's chapters in narration order; index IS the script's index. */
export function masterChapterIds(master: Timeline): string[] {
  const seen: string[] = []
  for (const segment of [...master.narration].sort((a, b) => a.startMs - b.startMs)) {
    if (!seen.includes(segment.chapterId)) seen.push(segment.chapterId)
  }
  return seen
}

/**
 * One resolved slot from a chapter's stretch of the master.
 *
 * Preference order is what hooks on a phone: real motion first, then a
 * still, then whatever the chapter has (a chart mid-teaser reads as
 * homework). A chapter with no overlapping slot falls back to any slot at
 * all rather than failing the teaser over one beat's backdrop.
 */
export function pickTeaserSlot(master: Timeline, chapterId: string): TimelineSlot | undefined {
  const segments = master.narration.filter((segment) => segment.chapterId === chapterId)
  if (segments.length === 0) return master.slots[0]

  const windowStart = Math.min(...segments.map((segment) => segment.startMs))
  const windowEnd = Math.max(...segments.map((segment) => segment.startMs + segment.durationMs))
  const overlapping = master.slots.filter(
    (slot) => slot.startMs < windowEnd && slot.startMs + slot.durationMs > windowStart,
  )
  const pool = overlapping.length > 0 ? overlapping : master.slots

  const byKind = (kind: string) => pool.find((slot) => slot.payload.kind === kind)
  return byKind('video') ?? byKind('image') ?? pool[0]
}

/** Even word spacing for audio that arrived without an alignment. */
function evenTimings(text: string, durationMs: number): WordTiming[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0) return []
  const per = Math.max(1, Math.floor(durationMs / words.length))
  return words.map((word, index) => ({
    text: word,
    startMs: index * per,
    endMs: Math.min(durationMs, index * per + Math.max(1, per - 50)),
  }))
}

export function compileTeaserMaster(input: {
  master: Timeline
  paragraphs: readonly TeaserParagraphAudio[]
}): Timeline {
  if (input.paragraphs.length === 0) {
    throw new ValidationError('a teaser needs narration — no synthesised paragraphs were given', {
      field: 'paragraphs',
    })
  }

  const chapterIds = masterChapterIds(input.master)

  let clock = 0
  const narration: Timeline['narration'] = []
  const slots: TimelineSlot[] = []
  const words: Timeline['captions']['words'] = []

  for (const [index, paragraph] of input.paragraphs.entries()) {
    const startMs = clock
    narration.push({
      r2Key: paragraph.r2Key,
      startMs,
      durationMs: paragraph.durationMs,
      chapterId: TEASER_CHAPTER_ID,
      paragraphIndex: index,
    })

    // The chapter the beat draws from; an out-of-range index (the model
    // miscounted) falls back to the final chapter rather than failing the
    // teaser — late chapters carry the story's strongest visuals anyway.
    const chapterId =
      chapterIds[Math.min(Math.max(paragraph.chapterIndex, 0), chapterIds.length - 1)]
    const picked = chapterId ? pickTeaserSlot(input.master, chapterId) : undefined
    if (!picked) {
      throw new ValidationError('the master timeline has no slots to lift teaser visuals from', {
        field: `paragraphs.${index}`,
      })
    }

    const last = index === input.paragraphs.length - 1
    const slotEnd = last
      ? startMs + paragraph.durationMs
      : startMs + paragraph.durationMs + TEASER_GAP_MS
    slots.push({
      ...picked,
      startMs,
      durationMs: slotEnd - startMs,
      transition: 'cut',
    })

    // Captions ride the alignment when the vendor gave one; the snap step
    // guarantees the words are the script's, never a mistranscription.
    const heard = paragraph.wordTimings ?? evenTimings(paragraph.text, paragraph.durationMs)
    words.push(...offsetCaptions(snapToScript(paragraph.text, heard).captions, startMs))

    clock = startMs + paragraph.durationMs + (last ? 0 : TEASER_GAP_MS)
  }

  return TimelineSchema.parse({
    version: input.master.version,
    fps: input.master.fps,
    width: input.master.width,
    height: input.master.height,
    brand: input.master.brand,
    narration,
    music: null,
    captions: { style: input.master.captions.style, words },
    slots,
    overlays: [],
  })
}
