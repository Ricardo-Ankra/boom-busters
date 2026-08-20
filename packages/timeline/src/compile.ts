import {
  canonicalTimelineIssues,
  TIMELINE_VERSION,
  TimelineSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  Caption,
  ChartBrief,
  MapBrief,
  MotionSpec,
  NarrationSegment,
  Timeline,
  TimelineMotion,
  TimelineSlot,
  Transition,
} from '@boom-busters/schemas'
import { buildDuckingCurve } from './ducking'

/**
 * The timeline compiler (build spec section 14.6): a pure function from an
 * approved project's parts to the canonical timeline JSON. Golden-tested —
 * the same input must produce byte-identical output forever, because a
 * timeline plus the compositions bundle is the reproducible render
 * definition. Nothing here reads a database, the clock, or randomness.
 */

// ---------------------------------------------------------------------------
// Input — plain data the assembly-runner assembles from DB rows
// ---------------------------------------------------------------------------

export interface CompileParagraph {
  chapterId: string
  chapterIndex: number
  chapterTitle: string
  paragraphIndex: number
  /** The approved take's audio. */
  r2Key: string
  durationMs: number
}

/** What the board resolved a visual slot to, ready to render. */
export interface CompileSlot {
  type: 'stock' | 'archival' | 'still' | 'upload' | 'chart' | 'map'
  startMs: number
  durationMs: number
  transition: Transition
  motion: MotionSpec
  media?: {
    kind: 'image' | 'video'
    r2Key?: string
    externalUrl?: string
    /** The small preview proxy's storage key — browser player only. */
    previewR2Key?: string
    width?: number
    height?: number
  }
  chart?: Pick<
    ChartBrief,
    'chartKind' | 'series' | 'dataRefs' | 'takeaway' | 'annotations' | 'reveal'
  >
  map?: Pick<MapBrief, 'locations' | 'route'>
}

export interface CompileInput {
  brand: BrandKitTokens
  /** Script order; the compiler lays them end to end on the clock. */
  paragraphs: CompileParagraph[]
  slots: CompileSlot[]
  music: { r2Key: string } | null
  captions: { words: Caption[]; style: 'karaoke' | 'none' }
  fps?: number
  width?: number
  height?: number
}

// ---------------------------------------------------------------------------
// Motion resolution
// ---------------------------------------------------------------------------

/** Ken Burns scale change per board speed. */
export const KENBURNS_INTENSITY = { slow: 0.06, medium: 0.1, fast: 0.16 } as const

/**
 * Creative direction → renderer parameters. `pan` briefs describe a path in
 * words no renderer can execute; they become a medium push-in, which reads
 * as intended motion rather than a frozen frame (v1 decision — a real pan
 * needs per-image framing data the board does not collect yet).
 */
export function resolveMotion(motion: MotionSpec, slot: CompileSlot): TimelineMotion {
  if (slot.chart) return { kind: slot.chart.reveal === 'draw-on' ? 'draw-on' : 'static' }
  if (slot.map) return { kind: 'static' } // AnimatedMap animates internally.
  switch (motion.kind) {
    case 'static':
      return { kind: 'static' }
    case 'kenburns':
      return {
        kind: 'kenburns',
        direction: motion.direction,
        intensity: KENBURNS_INTENSITY[motion.speed],
      }
    case 'pan':
      return { kind: 'kenburns', direction: 'in', intensity: KENBURNS_INTENSITY.medium }
  }
}

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

export const MASTER_FPS = 30
export const MASTER_WIDTH = 1920
export const MASTER_HEIGHT = 1080

export function compileTimeline(input: CompileInput): Timeline {
  if (input.paragraphs.length === 0) {
    throw new ValidationError('a timeline needs narration — no approved takes were provided', {
      field: 'paragraphs',
    })
  }

  // Narration: measured take durations laid end to end in script order —
  // the same clock the visual board was planned on.
  const narration: NarrationSegment[] = []
  let clock = 0
  for (const paragraph of input.paragraphs) {
    narration.push({
      r2Key: paragraph.r2Key,
      startMs: clock,
      durationMs: paragraph.durationMs,
      chapterId: paragraph.chapterId,
      paragraphIndex: paragraph.paragraphIndex,
    })
    clock += paragraph.durationMs
  }

  const slots: TimelineSlot[] = input.slots.map((slot, index) => {
    const motion = resolveMotion(slot.motion, slot)
    const base = {
      type: slot.type,
      startMs: slot.startMs,
      durationMs: slot.durationMs,
      transition: slot.transition,
      motion,
    }
    if (slot.chart) {
      return { ...base, payload: { kind: 'chart' as const, ...slot.chart } }
    }
    if (slot.map) {
      return { ...base, payload: { kind: 'map' as const, ...slot.map } }
    }
    if (!slot.media) {
      throw new ValidationError(
        `slot ${index} (${slot.type}) has no media and no chart/map data — placeholders must ` +
          'be excluded before compiling',
        { field: `slots.${index}` },
      )
    }
    const src = {
      ...(slot.media.r2Key !== undefined ? { r2Key: slot.media.r2Key } : {}),
      ...(slot.media.externalUrl !== undefined ? { externalUrl: slot.media.externalUrl } : {}),
      ...(slot.media.previewR2Key !== undefined ? { previewR2Key: slot.media.previewR2Key } : {}),
    }
    if (slot.media.kind === 'video') {
      return { ...base, payload: { kind: 'video' as const, src, muted: true as const } }
    }
    return {
      ...base,
      payload: {
        kind: 'image' as const,
        src,
        ...(slot.media.width !== undefined ? { width: slot.media.width } : {}),
        ...(slot.media.height !== undefined ? { height: slot.media.height } : {}),
      },
    }
  })

  // Chapter cards at each chapter's first paragraph; the lower third and
  // watermark are M6.5 composition concerns fed by later compiler passes.
  const chapterStarts = new Map<string, { startMs: number; index: number; title: string }>()
  for (const paragraph of input.paragraphs) {
    if (!chapterStarts.has(paragraph.chapterId)) {
      const start = narration.find(
        (candidate) =>
          candidate.chapterId === paragraph.chapterId &&
          candidate.paragraphIndex === paragraph.paragraphIndex,
      )
      chapterStarts.set(paragraph.chapterId, {
        startMs: start?.startMs ?? 0,
        index: paragraph.chapterIndex + 1,
        title: paragraph.chapterTitle,
      })
    }
  }
  const overlays = [...chapterStarts.values()].map((chapter) => ({
    kind: 'chapterCard' as const,
    startMs: chapter.startMs,
    durationMs: 2600,
    props: { index: chapter.index, title: chapter.title },
  }))

  const music = input.music
    ? {
        r2Key: input.music.r2Key,
        gainDb: input.brand.music.bedGainDb,
        duckingCurve: buildDuckingCurve(narration, {
          bedGainDb: input.brand.music.bedGainDb,
          duckDepthDb: input.brand.music.duckDepthDb,
        }),
        cuePoints: [...chapterStarts.values()].map((chapter) => ({
          tMs: chapter.startMs,
          style: 'chapter',
        })),
      }
    : null

  const timeline = TimelineSchema.parse({
    version: TIMELINE_VERSION,
    fps: input.fps ?? MASTER_FPS,
    width: input.width ?? MASTER_WIDTH,
    height: input.height ?? MASTER_HEIGHT,
    brand: input.brand,
    narration,
    music,
    captions: input.captions,
    slots,
    overlays,
  })

  const issues = canonicalTimelineIssues(timeline)
  if (issues.length > 0) {
    throw new ValidationError(
      `compiled timeline contains materialised URLs (${issues.join(', ')}) — the canonical ` +
        'form stores keys only',
      { field: issues[0] ?? 'timeline' },
    )
  }

  return timeline
}
