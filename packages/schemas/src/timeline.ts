import { z } from 'zod'
import { UlidSchema } from './ids'
import { BrandKitTokensSchema } from './settings'
import { ChartKindSchema, ChartSeriesSchema, MapLocationSchema, TransitionSchema } from './visuals'

/**
 * The timeline contract (build spec section 8.2) — the single JSON document
 * that turns an approved project into a render. A timeline uploaded to
 * storage plus the compositions bundle is a complete, reproducible render
 * definition: the compositions package consumes this schema and nothing else
 * (spec section 3: "a render must never touch the DB").
 *
 * Two rules with teeth, both enforced here rather than by convention:
 *
 * 1. **Storage keys, never URLs.** Presigned URLs expire, which would
 *    silently break the "any timeline is re-renderable forever" guarantee.
 *    The canonical stored timeline carries `r2Key`/`externalUrl` references
 *    only; the broker *materialises* a copy at invoke time — resolving every
 *    key to a fresh presigned URL in the `url` field — and passes THAT to
 *    the renderer. `canonicalTimelineIssues` is the guard the compiler and
 *    the broker both run.
 *
 * 2. **The brand is a snapshot, not a reference.** `brand` embeds the
 *    resolved Brand Kit tokens at compile time, so old projects re-render
 *    identically after a rebrand.
 */

export const TIMELINE_VERSION = 1

// ---------------------------------------------------------------------------
// Media references
// ---------------------------------------------------------------------------

/**
 * Where a piece of media lives. `r2Key` is the durable form — bytes in our
 * storage. `externalUrl` exists for chosen stock/archival media whose bytes
 * have not been ingested: a STABLE provider CDN URL (a Pexels file URL, a
 * Commons original), never a presigned or otherwise expiring one.
 *
 * `url` is the materialised form and is only ever present in the copy the
 * broker writes for one render; the canonical stored timeline must not
 * contain it (`canonicalTimelineIssues` enforces this).
 */
export const MediaRefSchema = z
  .object({
    r2Key: z.string().min(1).optional(),
    externalUrl: z.url().optional(),
    url: z.url().optional(),
  })
  .refine((ref) => ref.r2Key !== undefined || ref.externalUrl !== undefined, {
    message: 'a media reference needs an r2Key or a stable externalUrl',
  })
export type MediaRef = z.infer<typeof MediaRefSchema>

// ---------------------------------------------------------------------------
// Narration, music, captions
// ---------------------------------------------------------------------------

export const NarrationSegmentSchema = z.object({
  r2Key: z.string().min(1),
  /** Materialised copies only — same contract as MediaRef.url. */
  url: z.url().optional(),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().positive(),
  chapterId: UlidSchema,
  paragraphIndex: z.number().int().min(0),
})
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>

/** One point on the music bed's gain envelope, in dB relative to full scale. */
export const DuckingPointSchema = z.object({
  tMs: z.number().int().min(0),
  gainDb: z.number().max(0),
})
export type DuckingPoint = z.infer<typeof DuckingPointSchema>

export const MusicCuePointSchema = z.object({
  tMs: z.number().int().min(0),
  /** What the moment is for — 'chapter', 'hit', 'outro'. Compositions may style it. */
  style: z.string().min(1),
})

export const MusicTrackSchema = z.object({
  r2Key: z.string().min(1),
  /** Materialised copies only — same contract as MediaRef.url. */
  url: z.url().optional(),
  /** Base bed gain, dB. Ducking points are absolute gains, not offsets. */
  gainDb: z.number().max(0),
  /** Piecewise-linear gain envelope, strictly ordered by tMs (compiler-enforced). */
  duckingCurve: z.array(DuckingPointSchema),
  cuePoints: z.array(MusicCuePointSchema),
})
export type MusicTrack = z.infer<typeof MusicTrackSchema>

/**
 * One word, in the `@remotion/captions` shape. Text is script ground truth;
 * timings come from alignment — the snap step guarantees a caption can never
 * contain a mistranscription (spec section 6).
 */
export const CaptionSchema = z.object({
  text: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  timestampMs: z.number().int().min(0).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
})
export type Caption = z.infer<typeof CaptionSchema>

export const CaptionsSchema = z.object({
  words: z.array(CaptionSchema),
  style: z.enum(['karaoke', 'none']),
})
export type Captions = z.infer<typeof CaptionsSchema>

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * Renderer-facing motion. The board's `MotionSpec` is creative direction in
 * words; by compile time it has been resolved to parameters a composition
 * can execute deterministically.
 */
export const TimelineMotionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static') }),
  z.object({
    kind: z.literal('kenburns'),
    direction: z.enum(['in', 'out']),
    /** Total scale change across the slot, e.g. 0.08 = 8%. */
    intensity: z.number().positive().max(0.5),
  }),
  z.object({ kind: z.literal('draw-on') }),
  z.object({
    kind: z.literal('camera-path'),
    /** Waypoints the map camera visits, in order. */
    path: z
      .array(z.object({ lat: z.number(), lon: z.number(), zoom: z.number().positive() }))
      .min(2),
  }),
])
export type TimelineMotion = z.infer<typeof TimelineMotionSchema>

export const ImagePayloadSchema = z.object({
  kind: z.literal('image'),
  src: MediaRefSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const VideoPayloadSchema = z.object({
  kind: z.literal('video'),
  src: MediaRefSchema,
  /** Offset into the source clip where playback starts. */
  trimStartMs: z.number().int().min(0).optional(),
  /** Clip audio is never used — narration and music own the mix. */
  muted: z.literal(true),
})

/** Chart data is embedded, with the claims it came from — auditable forever. */
export const ChartPayloadSchema = z.object({
  kind: z.literal('chart'),
  chartKind: ChartKindSchema,
  series: z.array(ChartSeriesSchema).min(1),
  dataRefs: z.array(UlidSchema).min(1),
  takeaway: z.string().min(1),
  annotations: z.array(z.object({ atX: z.string().min(1), text: z.string().min(1) })).optional(),
  reveal: z.enum(['draw-on', 'none']),
})

export const MapPayloadSchema = z.object({
  kind: z.literal('map'),
  locations: z.array(MapLocationSchema).min(1).max(8),
  route: z.boolean(),
})

export const SlotPayloadSchema = z.discriminatedUnion('kind', [
  ImagePayloadSchema,
  VideoPayloadSchema,
  ChartPayloadSchema,
  MapPayloadSchema,
])
export type SlotPayload = z.infer<typeof SlotPayloadSchema>

export const TIMELINE_SLOT_TYPES = ['stock', 'archival', 'still', 'upload', 'chart', 'map'] as const
export type TimelineSlotType = (typeof TIMELINE_SLOT_TYPES)[number]

/** Which payload kinds each slot type may carry. */
export const SLOT_PAYLOAD_KINDS: Record<TimelineSlotType, readonly SlotPayload['kind'][]> = {
  stock: ['image', 'video'],
  archival: ['image'],
  still: ['image'],
  upload: ['image'],
  chart: ['chart'],
  map: ['map'],
}

export const TimelineSlotSchema = z
  .object({
    /** The board slot type this came from — the audit trail back to a brief. */
    type: z.enum(TIMELINE_SLOT_TYPES),
    startMs: z.number().int().min(0),
    durationMs: z.number().int().positive(),
    transition: TransitionSchema,
    motion: TimelineMotionSchema,
    payload: SlotPayloadSchema,
  })
  .superRefine((slot, ctx) => {
    if (!SLOT_PAYLOAD_KINDS[slot.type].includes(slot.payload.kind)) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload', 'kind'],
        message: `a ${slot.type} slot cannot carry a ${slot.payload.kind} payload`,
      })
    }
  })
export type TimelineSlot = z.infer<typeof TimelineSlotSchema>

// ---------------------------------------------------------------------------
// Overlays
// ---------------------------------------------------------------------------

export const OverlaySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('lowerThird'),
    startMs: z.number().int().min(0),
    durationMs: z.number().int().positive(),
    props: z.object({ title: z.string().min(1), subtitle: z.string().optional() }),
  }),
  z.object({
    kind: z.literal('chapterCard'),
    startMs: z.number().int().min(0),
    durationMs: z.number().int().positive(),
    props: z.object({ index: z.number().int().min(1), title: z.string().min(1) }),
  }),
  z.object({
    kind: z.literal('watermark'),
    startMs: z.number().int().min(0),
    durationMs: z.number().int().positive(),
    props: z.object({}),
  }),
])
export type Overlay = z.infer<typeof OverlaySchema>

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

export const TimelineSchema = z.object({
  version: z.literal(TIMELINE_VERSION),
  fps: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Resolved snapshot, not a reference (spec section 8.2). */
  brand: BrandKitTokensSchema,
  narration: z.array(NarrationSegmentSchema).min(1),
  music: MusicTrackSchema.nullable(),
  captions: CaptionsSchema,
  slots: z.array(TimelineSlotSchema).min(1),
  overlays: z.array(OverlaySchema),
})
export type Timeline = z.infer<typeof TimelineSchema>

/** Total runtime: the end of the last narration segment or slot. */
export function timelineDurationMs(timeline: Timeline): number {
  const ends = [
    ...timeline.narration.map((segment) => segment.startMs + segment.durationMs),
    ...timeline.slots.map((slot) => slot.startMs + slot.durationMs),
  ]
  return Math.max(...ends)
}

/**
 * The bed's gain at time t, in dB — piecewise-linear over the ducking curve,
 * clamped to the first/last point outside it. This lives in the CONTRACT, not
 * in a package, because two independent consumers must agree on it exactly:
 * the preview screen's gain visualisation (via `packages/timeline`) and the
 * `MusicBed` composition (which may import only from schemas). One
 * interpolation, two importers, zero drift.
 */
export function gainAt(curve: readonly DuckingPoint[], tMs: number): number {
  if (curve.length === 0) return 0
  if (tMs <= curve[0]!.tMs) return curve[0]!.gainDb
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1]!
    const current = curve[index]!
    if (tMs <= current.tMs) {
      const progress = (tMs - previous.tMs) / (current.tMs - previous.tMs)
      return previous.gainDb + (current.gainDb - previous.gainDb) * progress
    }
  }
  return curve[curve.length - 1]!.gainDb
}

/**
 * The canonical-form guard: a stored timeline must reference media by key,
 * never by materialised URL. Returns the offending paths (empty = clean),
 * so the compiler can assert and the broker can refuse before spending.
 */
export function canonicalTimelineIssues(timeline: Timeline): string[] {
  const issues: string[] = []
  timeline.narration.forEach((segment, index) => {
    if (segment.url !== undefined) issues.push(`narration.${index}.url`)
  })
  if (timeline.music?.url !== undefined) issues.push('music.url')
  timeline.slots.forEach((slot, index) => {
    if (slot.payload.kind === 'image' || slot.payload.kind === 'video') {
      if (slot.payload.src.url !== undefined) {
        issues.push(`slots.${index}.payload.src.url`)
      }
    }
  })
  return issues
}
