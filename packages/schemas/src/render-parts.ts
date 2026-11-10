import { z } from 'zod'
import { QcReportSchema, type LoudnormMeasurement, type QcReport } from './broker'
import { UlidSchema } from './ids'
import { timelineDurationMs, type Timeline } from './timeline'

/** A master up to this long renders as one piece; longer renders in parts. */
export const RENDER_SINGLE_MAX_SEC = 1800
/** The length each part aims for. The part count is derived from it. */
export const RENDER_PART_TARGET_SEC = 900
/**
 * How far the film's integrated loudness may sit from the target before QC
 * warns. Infra (`commands.ts`) holds the same value; the contract package
 * cannot import infra, so it is defined again here on purpose.
 */
export const QC_LOUDNESS_TOLERANCE_LU = 1.5

/** True when the master is strictly longer than the single-render limit. */
export function rendersInParts(durationSec: number): boolean {
  return durationSec > RENDER_SINGLE_MAX_SEC
}

export interface RenderPartPlan {
  index: number
  /** Inclusive frame range, as Remotion takes it. */
  frameRange: [number, number]
  startMs: number
  durationMs: number
}

/** Frames as the composition counts them: rounded, never ceiled. */
function timelineFrames(timeline: Timeline): number {
  return Math.round((timelineDurationMs(timeline) * timeline.fps) / 1000)
}

/**
 * Equal parts from the count, the last taking the remainder. The count is the
 * duration over the target, rounded up, so no part runs past the target.
 */
export function planRenderParts(timeline: Timeline): RenderPartPlan[] {
  const fps = timeline.fps
  const totalFrames = timelineFrames(timeline)
  const count = Math.max(1, Math.ceil(totalFrames / fps / RENDER_PART_TARGET_SEC))
  const base = Math.floor(totalFrames / count)
  const plans: RenderPartPlan[] = []
  for (let index = 0; index < count; index += 1) {
    const first = index * base
    const last = index === count - 1 ? totalFrames - 1 : first + base - 1
    plans.push({
      index,
      frameRange: [first, last],
      startMs: Math.round((first * 1000) / fps),
      durationMs: Math.round(((last - first + 1) * 1000) / fps),
    })
  }
  return plans
}

export const RenderPartStatusSchema = z.enum(['queued', 'rendering', 'completed', 'failed'])

export const RenderPartSchema = z.object({
  index: z.number().int().min(0),
  renderId: UlidSchema,
  frameRange: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  startMs: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  status: RenderPartStatusSchema,
  attempt: z.number().int().min(1).max(2),
  /** Renders of earlier attempts of this part; each was paid for. */
  priorRenderIds: z.array(UlidSchema).default([]),
  remotionRenderId: z.string().optional(),
  outputS3Key: z.string().optional(),
  costUsd: z.number().min(0).optional(),
  message: z.string().optional(),
  qc: QcReportSchema.optional(),
})
export type RenderPart = z.infer<typeof RenderPartSchema>
export const RenderPartsSchema = z.array(RenderPartSchema)

function twoDecimals(value: number): string {
  return value.toFixed(2)
}

/**
 * One film-wide loudness from per-part measurements: integrated loudness is
 * the duration-weighted power mean, peak and range are the maxima. A silent
 * part at -70 adds next to no power, so it weighs its duration and no more.
 */
export function combineLoudness(
  parts: { measurement: LoudnormMeasurement; durationMs: number }[],
): LoudnormMeasurement {
  const totalMs = parts.reduce((sum, part) => sum + part.durationMs, 0)
  const power = parts.reduce(
    (sum, part) => sum + part.durationMs * 10 ** ((Number(part.measurement.input_i) + 0.691) / 10),
    0,
  )
  const integrated = -0.691 + 10 * Math.log10(power / totalMs)
  const tp = Math.max(...parts.map((part) => Number(part.measurement.input_tp)))
  const lra = Math.max(...parts.map((part) => Number(part.measurement.input_lra)))
  return {
    input_i: twoDecimals(integrated),
    input_tp: twoDecimals(tp),
    input_lra: twoDecimals(lra),
    input_thresh: twoDecimals(integrated - 10),
    target_offset: '0.00',
  }
}

/**
 * The film's QC report from its parts' reports. Part issues are already on
 * the film clock; per-part loudness issues are dropped because loudness is
 * judged once, from the joined file.
 */
export function mergeQcReports(
  parts: { qc: QcReport }[],
  join: { integratedLufs: number | null },
  targetLufs: number,
): QcReport {
  const issues = parts
    .flatMap((part) => part.qc.issues)
    .filter((issue) => issue.kind !== 'loudness')
    .sort((a, b) => a.atMs - b.atMs)
  if (join.integratedLufs === null) {
    issues.push({ kind: 'loudness', atMs: 0, detail: 'integrated loudness could not be measured' })
  } else if (Math.abs(join.integratedLufs - targetLufs) > QC_LOUDNESS_TOLERANCE_LU) {
    issues.push({
      kind: 'loudness',
      atMs: 0,
      detail: `integrated loudness ${join.integratedLufs.toFixed(1)} LUFS, target ${targetLufs} LUFS`,
    })
  }
  return {
    passed: issues.length === 0,
    integratedLufs: join.integratedLufs ?? 0,
    issues,
  }
}

function partFrames(part: RenderPart): number {
  return part.frameRange[1] - part.frameRange[0] + 1
}

/** Film progress, weighting each part by its frames; a completed part counts whole. */
export function partsProgressPct(parts: RenderPart[], live: Record<string, number>): number {
  const total = parts.reduce((sum, part) => sum + partFrames(part), 0)
  if (total === 0) return 0
  const done = parts.reduce(
    (sum, part) =>
      sum + partFrames(part) * (part.status === 'completed' ? 1 : (live[part.renderId] ?? 0)),
    0,
  )
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)))
}

/** A part's share of the film's estimate, by frames. */
export function partEstimateUsd(
  estimateUsd: number,
  part: RenderPart,
  totalFrames: number,
): number {
  return Math.round(((estimateUsd * partFrames(part)) / totalFrames) * 10000) / 10000
}

/**
 * What the film cost: completed parts at their recorded cost (or their share
 * of the estimate), plus a share for every earlier attempt and every failed part.
 */
export function settleRenderParts(
  parts: RenderPart[],
  estimateUsd: number,
  totalFrames: number,
): number {
  let total = 0
  for (const part of parts) {
    const share = partEstimateUsd(estimateUsd, part, totalFrames)
    if (part.status === 'completed') total += part.costUsd ?? share
    else if (part.status === 'failed') total += share
    total += part.priorRenderIds.length * share
  }
  return Math.round(total * 10000) / 10000
}

/** Splits items into consecutive waves of at most `size`. */
export function partWaves<T>(items: T[], size: number): T[][] {
  const waves: T[][] = []
  for (let i = 0; i < items.length; i += size) waves.push(items.slice(i, i + size))
  return waves
}
