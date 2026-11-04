import { z } from 'zod'
import { MotionIdentitySchema } from './motion-identity'

/**
 * Motion references (spec 2026-11-04, sections 5.1 to 5.3, 6 and 7): a
 * still or a clip the owner uploads and marks, the frames the browser takes
 * from it, the model's reading of them, and the identity draft those
 * readings feed. The limits here are the guideline's (`docs/motion-references.md`).
 */

export const REFERENCE_PURPOSES = ['mechanism', 'look', 'pacing'] as const
export const ReferencePurposeSchema = z.enum(REFERENCE_PURPOSES)
export type ReferencePurpose = z.infer<typeof ReferencePurposeSchema>

export const REFERENCE_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const REFERENCE_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const
export const ReferenceMimeSchema = z.enum([...REFERENCE_IMAGE_MIMES, ...REFERENCE_VIDEO_MIMES])
export type ReferenceMime = z.infer<typeof ReferenceMimeSchema>

export function referenceKind(mime: ReferenceMime): 'image' | 'video' {
  return (REFERENCE_IMAGE_MIMES as readonly string[]).includes(mime) ? 'image' : 'video'
}

export function referenceExtension(
  mime: ReferenceMime,
): 'png' | 'jpg' | 'webp' | 'mp4' | 'webm' | 'mov' {
  switch (mime) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'video/mp4':
      return 'mp4'
    case 'video/webm':
      return 'webm'
    case 'video/quicktime':
      return 'mov'
  }
}

export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024
export const REFERENCE_VIDEO_MAX_BYTES = 100 * 1024 * 1024
export const REFERENCE_CLIP_MAX_MS = 90_000
export const REFERENCE_WINDOW_MIN_MS = 1000
export const REFERENCE_WINDOW_MAX_MS = 4000
export const REFERENCE_PACK_MAX = 12
export const DENSE_FRAMES_PER_SECOND = 12
export const DENSE_FRAMES_MAX = 48
export const DENSE_FRAME_WIDTH = 640
export const OVERVIEW_STEP_MS = 500
export const OVERVIEW_FRAMES_MAX = 180
export const OVERVIEW_FRAME_WIDTH = 320
export const REFERENCE_LINE_MAX = 300

/**
 * The dense set's moments: a twelfth of a second apart from the window's
 * start, while inside it, at most 48. The browser takes these frames and the
 * finalise recomputes them, so a frame list is verified against the window.
 */
export function denseFrameTimes(windowStartMs: number, windowEndMs: number): number[] {
  const step = 1000 / DENSE_FRAMES_PER_SECOND
  const times: number[] = []
  for (let i = 0; i < DENSE_FRAMES_MAX; i += 1) {
    const at = windowStartMs + i * step
    if (at >= windowEndMs) break
    times.push(Math.round(at))
  }
  return times
}

/** The overview's moments: every half second across the whole clip, at most 180. */
export function overviewFrameTimes(durationMs: number): number[] {
  const times: number[] = []
  for (let i = 0; i < OVERVIEW_FRAMES_MAX; i += 1) {
    const at = i * OVERVIEW_STEP_MS
    if (at >= durationMs) break
    times.push(at)
  }
  return times
}

export const ReferenceFrameSchema = z.object({
  atMs: z.number().int().min(0),
  r2Key: z.string().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})
export type ReferenceFrame = z.infer<typeof ReferenceFrameSchema>

export const ReferenceFramesSchema = z.object({
  dense: z.array(ReferenceFrameSchema).max(DENSE_FRAMES_MAX),
  overview: z.array(ReferenceFrameSchema).max(OVERVIEW_FRAMES_MAX),
})
export type ReferenceFrames = z.infer<typeof ReferenceFramesSchema>

const ReadingLine = z.string().trim().max(400)

/** The fields the owner edits on the card: the reading without its provenance. */
export const ReferenceReadingEditSchema = z.object({
  medium: ReadingLine,
  palette: z.array(z.string().trim().max(40)).max(6),
  type: ReadingLine,
  enters: ReadingLine,
  exits: ReadingLine,
  motion: ReadingLine,
  absent: ReadingLine,
  notes: z.string().trim().max(800),
})
export type ReferenceReadingEdit = z.infer<typeof ReferenceReadingEditSchema>

export const ReferenceReadingSchema = ReferenceReadingEditSchema.extend({
  readAt: z.string().datetime(),
  model: z.string().max(80),
  editedAt: z.string().datetime().optional(),
})
export type ReferenceReading = z.infer<typeof ReferenceReadingSchema>

const Line = z.string().trim().max(REFERENCE_LINE_MAX)

/** The text fields the owner writes, editable later on the card. */
export const MotionReferenceEditSchema = z.object({
  title: z.string().trim().min(1).max(120),
  /** Provenance only: never fetched. */
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .default('')
    .transform((url) => (url === '' ? null : url)),
  rights: z.string().trim().max(200).default('Reference only'),
  purpose: ReferencePurposeSchema,
  negative: z.boolean().default(false),
  carryOver: Line,
  avoid: Line.default(''),
})
export type MotionReferenceEdit = z.infer<typeof MotionReferenceEditSchema>

export const MotionReferenceInputSchema = MotionReferenceEditSchema.extend({
  kind: z.enum(['image', 'video']),
  windowStartMs: z.number().int().min(0).nullable().default(null),
  windowEndMs: z.number().int().min(0).nullable().default(null),
}).superRefine((input, ctx) => {
  if (input.kind === 'image') {
    if (input.windowStartMs !== null || input.windowEndMs !== null) {
      ctx.addIssue({ code: 'custom', message: 'A still has no window', path: ['windowStartMs'] })
    }
    return
  }
  const length =
    input.windowStartMs === null || input.windowEndMs === null
      ? null
      : input.windowEndMs - input.windowStartMs
  if (length === null || length < REFERENCE_WINDOW_MIN_MS || length > REFERENCE_WINDOW_MAX_MS) {
    ctx.addIssue({
      code: 'custom',
      message: 'The window is one to four seconds',
      path: ['windowEndMs'],
    })
  }
})
export type MotionReferenceInput = z.infer<typeof MotionReferenceInputSchema>

/** The model's proposal for the channel's identity, read through the identity schema. */
export const MotionIdentityDraftSchema = z.object({
  identity: MotionIdentitySchema,
  why: z.string().trim().max(1200),
})
export type MotionIdentityDraft = z.infer<typeof MotionIdentityDraftSchema>
