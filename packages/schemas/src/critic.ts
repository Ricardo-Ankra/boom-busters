import { z } from 'zod'
import { MECHANISMS_PER_DESIGN_MAX, MechanismSchema } from './mechanisms'

/**
 * The critic's report (spec 2026-11-04, section 10.4): a fresh judge, never
 * the designer, scores a rendered design on five axes (HeyGen's), names its
 * defects by time and frame, the three fixes worth making, whether each
 * named mechanism is on the frames, and whether to keep it. The per-shot
 * review stores it on the design as `critique`; plan 4's derivation stores
 * it on an exemplar version.
 */

export const CRITIC_AXES = ['engagement', 'intent', 'composition', 'temporal', 'craft'] as const
export type CriticAxis = (typeof CRITIC_AXES)[number]

/** A score at or above this on every axis passes (spec 13). */
export const CRITIC_BAR = 8
export const CRITIC_LINE_MAX = 200
export const CRITIC_FIXES_MAX = 3
export const CRITIC_FIX_MAX = 300
export const CRITIC_DEFECTS_MAX = 8

export const CriticScoreSchema = z.object({
  score: z.number().int().min(1).max(10),
  line: z.string().trim().min(1).max(CRITIC_LINE_MAX),
})
export type CriticScore = z.infer<typeof CriticScoreSchema>

export const CriticReportSchema = z.object({
  scores: z.object({
    engagement: CriticScoreSchema,
    intent: CriticScoreSchema,
    composition: CriticScoreSchema,
    temporal: CriticScoreSchema,
    craft: CriticScoreSchema,
  }),
  defects: z
    .array(
      z.object({
        atMs: z.number().int().min(0),
        orientation: z.enum(['landscape', 'portrait']),
        text: z.string().trim().min(1).max(CRITIC_LINE_MAX),
      }),
    )
    .max(CRITIC_DEFECTS_MAX),
  fixes: z.array(z.string().trim().min(1).max(CRITIC_FIX_MAX)).max(CRITIC_FIXES_MAX),
  mechanisms: z
    .array(z.object({ key: MechanismSchema, present: z.boolean() }))
    .max(MECHANISMS_PER_DESIGN_MAX),
  keep: z.boolean(),
})
export type CriticReport = z.infer<typeof CriticReportSchema>

/** Every axis at or above the bar. */
export function criticPasses(report: CriticReport): boolean {
  return CRITIC_AXES.every((axis) => report.scores[axis].score >= CRITIC_BAR)
}

/**
 * Measured motion (spec 10.1): what the browser's dense shots show when
 * compared neighbour to neighbour, handed to the critic as numbers.
 */
export const MotionMetricsSchema = z.object({
  /** Time in which nothing changed, summed over every frozen pair. */
  frozenMs: z.number().int().min(0),
  /** The longest run in which nothing changed. */
  longestFrozenMs: z.number().int().min(0),
  /** The longest run is past the channel's still limit. */
  frozenCritical: z.boolean(),
  /** The share of all change inside the single busiest 250 ms. */
  simultaneity: z.number().min(0).max(1),
  /** From the last change to the end of the slot. */
  holdAfterLastMs: z.number().int().min(0),
  /** The change at each shot against the one before it. */
  speedProfile: z
    .array(z.object({ atMs: z.number().int().min(0), change: z.number().min(0) }))
    .max(64),
})
export type MotionMetrics = z.infer<typeof MotionMetricsSchema>
