import { SHORT_RULES, TimelineSchema, ValidationError } from '@boom-busters/schemas'
import type {
  CropFocus,
  PointShotMotion,
  ShortPhase,
  Timeline,
  TimelineMotion,
  TimelineSlot,
  WordTiming,
} from '@boom-busters/schemas'
import { offsetCaptions, snapToScript } from './snap'
import { evenTimings } from './teaser'

/**
 * A point Short's mini master (playbook Shorts spec section 7.2).
 *
 * Like the teaser's, it is a small complete `Timeline` on its own clock:
 * purpose-written narration, captions snapped to the script, and the board's
 * shots. Unlike the teaser's, shots are not one-per-paragraph and carry their
 * own motion and crop; each starts on a spoken word, so a cut lands on the
 * beat the narration names. The render windows it with `compileShortTimeline`
 * exactly as a teaser's.
 */

/**
 * The pseudo chapter a point Short's narration lives in. A fixed, well-formed
 * ULID (Crockford base32 spelling its purpose) that no random chapter id can
 * collide with, as `TEASER_CHAPTER_ID` is for teasers.
 */
export const POINT_CHAPTER_ID = '0P01NTP01NTP01NTP01NTP01NT'

export interface PointParagraphAudio {
  text: string
  phase: ShortPhase
  r2Key: string
  durationMs: number
  /** From the synthesis alignment; null falls back to even spacing. */
  wordTimings: WordTiming[] | null
}

export interface ResolvedPointShot {
  /** Index into the Short's caption words; the shot begins when that word does. */
  startWord: number
  slot: TimelineSlot
  crop: CropFocus
  motion: PointShotMotion
}

/** The motion a shot plays: the plan's choice on pictures, the slot's own elsewhere. */
function shotMotion(slot: TimelineSlot, motion: PointShotMotion): TimelineMotion {
  if (motion === 'punch') {
    return { kind: 'punch', scale: SHORT_RULES.punchScale, durationMs: SHORT_RULES.punchMs }
  }
  if (slot.payload.kind !== 'image' && slot.payload.kind !== 'video') return slot.motion
  if (motion === 'static') return { kind: 'static' }
  return {
    kind: 'kenburns',
    direction: motion === 'kenburns-in' ? 'in' : 'out',
    intensity: SHORT_RULES.kenburnsIntensity,
  }
}

export function compileShortMaster(input: {
  master: Timeline
  paragraphs: readonly PointParagraphAudio[]
  shots: readonly ResolvedPointShot[]
  bridge: { label: string; channelName: string; handle: string }
}): Timeline {
  if (input.paragraphs.length === 0) {
    throw new ValidationError(
      'a point Short needs narration: no synthesised paragraphs were given',
      { field: 'paragraphs' },
    )
  }
  if (input.shots.length === 0) {
    throw new ValidationError('a point Short needs at least one shot', { field: 'shots' })
  }

  let clock = 0
  let bridgeStartMs: number | null = null
  const narration: Timeline['narration'] = []
  const words: Timeline['captions']['words'] = []

  for (const [index, paragraph] of input.paragraphs.entries()) {
    const startMs = clock
    narration.push({
      r2Key: paragraph.r2Key,
      startMs,
      durationMs: paragraph.durationMs,
      chapterId: POINT_CHAPTER_ID,
      paragraphIndex: index,
    })
    if (paragraph.phase === 'bridge' && bridgeStartMs === null) bridgeStartMs = startMs

    const heard = paragraph.wordTimings ?? evenTimings(paragraph.text, paragraph.durationMs)
    words.push(...offsetCaptions(snapToScript(paragraph.text, heard).captions, startMs))

    const last = index === input.paragraphs.length - 1
    clock = startMs + paragraph.durationMs + (last ? 0 : SHORT_RULES.paragraphGapMs)
  }
  const narrationEndMs = clock

  if (bridgeStartMs === null) {
    throw new ValidationError('a point Short needs a bridge paragraph', { field: 'paragraphs' })
  }

  const starts = input.shots.map((shot, index) => {
    const word = words[shot.startWord]
    if (!word) {
      throw new ValidationError(
        `shot ${index} starts at word ${shot.startWord}, but the narration has ${words.length}`,
        { field: `shots.${index}.startWord` },
      )
    }
    return index === 0 ? 0 : word.startMs
  })

  const slots = input.shots.map((shot, index): TimelineSlot => {
    const startMs = starts[index]!
    const endMs = index === input.shots.length - 1 ? narrationEndMs : starts[index + 1]!
    if (endMs <= startMs) {
      throw new ValidationError(
        `shot ${index} would last no time: shots must start on later words`,
        { field: `shots.${index}.startWord` },
      )
    }
    return {
      ...shot.slot,
      startMs,
      durationMs: endMs - startMs,
      transition: 'cut',
      motion: shotMotion(shot.slot, shot.motion),
      crop: shot.crop,
    }
  })

  const bridgeSpan = { startMs: bridgeStartMs, durationMs: narrationEndMs - bridgeStartMs }

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
    overlays: [
      { kind: 'relatedArrow', ...bridgeSpan, props: { label: input.bridge.label } },
      {
        kind: 'subscribeBadge',
        ...bridgeSpan,
        props: { channelName: input.bridge.channelName, handle: input.bridge.handle },
      },
    ],
  })
}
