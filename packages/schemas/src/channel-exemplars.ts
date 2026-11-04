import { z } from 'zod'
import {
  GRAPHIC_CONCEPT_MAX,
  GRAPHIC_STORYBOARD_LINE_MAX,
  GRAPHIC_STORYBOARD_MAX,
} from './graphic-code'
import { UlidSchema } from './ids'
import { MECHANISMS_PER_DESIGN_MAX, MechanismSchema } from './mechanisms'
import { TECHNIQUES } from './techniques'
import { ChartSeriesSchema } from './visuals'

/**
 * A channel's own exemplars (spec 2026-11-04, sections 5, 9 and 11): the
 * plan the storyboard call writes for one technique, the frames a version's
 * build was photographed into, the progress a derivation reports per
 * technique, the verdict kinds the preference ledger records, and the
 * bounds the Derive dialogue and the Refine steer hold to.
 */

export const EXEMPLAR_STATUSES = ['draft', 'approved', 'retired'] as const
export type ExemplarStatus = (typeof EXEMPLAR_STATUSES)[number]

export const DERIVE_ROUNDS_MIN = 1
export const DERIVE_ROUNDS_MAX = 5
export const DERIVE_ROUNDS_DEFAULT = 2
/** Above this the cap field says so in red and still allows it (spec 9.1). */
export const DERIVE_CAP_WARN_USD = 20
export const EXEMPLAR_STEER_MAX = 500
export const PLAN_LEANS_ON_MAX = 3
export const PLAN_WORDS_MAX = 80
export const PLAN_WHY_MAX = 200
export const PLAN_INTENT_MAX = 300

/** A chart slot's data, as the designer's `props.data` carries it. */
const PlanChartDataSchema = z.object({
  series: z.array(ChartSeriesSchema).min(1),
  takeaway: z.string().trim().min(1),
  annotations: z.array(z.object({ atX: z.string(), text: z.string() })).optional(),
})

export const ExemplarPlanSchema = z.object({
  /** The catalogue's synthetic slot rewritten into the channel's register. */
  slot: z.object({
    intent: z.string().trim().min(1).max(PLAN_INTENT_MAX),
    words: z
      .array(z.object({ text: z.string().trim().min(1), atMs: z.number().int().min(0) }))
      .min(1)
      .max(PLAN_WORDS_MAX),
    data: PlanChartDataSchema.optional(),
  }),
  concept: z.string().trim().min(1).max(GRAPHIC_CONCEPT_MAX),
  storyboard: z
    .array(z.string().trim().min(1).max(GRAPHIC_STORYBOARD_LINE_MAX))
    .min(1)
    .max(GRAPHIC_STORYBOARD_MAX),
  mechanisms: z.array(MechanismSchema).max(MECHANISMS_PER_DESIGN_MAX),
  /** The references the plan leans on, by title, and why. */
  leansOn: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        why: z.string().trim().min(1).max(PLAN_WHY_MAX),
      }),
    )
    .max(PLAN_LEANS_ON_MAX),
})
export type ExemplarPlan = z.infer<typeof ExemplarPlanSchema>

/** What a version's build was photographed into, by key in storage. */
export const ExemplarFramesSchema = z.object({
  shots: z
    .array(
      z.object({
        orientation: z.enum(['landscape', 'portrait']),
        atMs: z.number().int().min(0),
        r2Key: z.string().min(1),
      }),
    )
    .max(16),
  sheets: z.object({
    landscape: z.string().min(1).optional(),
    portrait: z.string().min(1).optional(),
  }),
  round: z.number().int().min(1),
})
export type ExemplarFrames = z.infer<typeof ExemplarFramesSchema>

export const DERIVATION_STATES = ['running', 'done', 'stopped', 'failed'] as const
export type DerivationState = (typeof DERIVATION_STATES)[number]

export const TECHNIQUE_PROGRESS_STATES = [
  'pending',
  'running',
  'ready',
  'wants-pass',
  'no-frames',
  'refused',
  'stopped-at-cap',
  'failed',
] as const
export type TechniqueProgressState = (typeof TECHNIQUE_PROGRESS_STATES)[number]

export const TechniqueProgressSchema = z.object({
  technique: z.enum(TECHNIQUES),
  state: z.enum(TECHNIQUE_PROGRESS_STATES),
  versionId: UlidSchema.nullable(),
  reason: z.string().max(500).nullable(),
  costUsd: z.number().min(0),
})
export type TechniqueProgress = z.infer<typeof TechniqueProgressSchema>
export type DerivationProgress = TechniqueProgress[]

export const VERDICT_KINDS = [
  'approve',
  'keep-approved',
  'prefer',
  'revise',
  'steer',
  'redesign',
] as const
export type VerdictKind = (typeof VERDICT_KINDS)[number]

export const DeriveRequestSchema = z.object({
  techniques: z.array(z.enum(TECHNIQUES)).min(1),
  rounds: z.number().int().min(DERIVE_ROUNDS_MIN).max(DERIVE_ROUNDS_MAX),
  capUsd: z.number().positive().max(10_000),
})
export type DeriveRequest = z.infer<typeof DeriveRequestSchema>

export const ExemplarSteerSchema = z.string().trim().min(1).max(EXEMPLAR_STEER_MAX)

/**
 * The slot rewrite's bounds: the plan keeps the catalogue slot's clock, its
 * word count within a third, and for a chart its series and point counts.
 * The first failing rule as one sentence, else null.
 */
export function planIssue(
  plan: ExemplarPlan,
  bounds: { durationMs: number; wordCount: number; chart?: { series: number; points: number } },
): string | null {
  const { words, data } = plan.slot
  if (words.some((word) => word.atMs >= bounds.durationMs)) {
    return "a word sits past the slot's end"
  }
  if (words.some((word, index) => index > 0 && word.atMs < words[index - 1]!.atMs)) {
    return 'the words are not in order on the clock'
  }
  const slack = Math.ceil(bounds.wordCount / 3)
  if (Math.abs(words.length - bounds.wordCount) > slack) {
    return `the plan has ${words.length} words; the slot speaks ${bounds.wordCount}, keep within a third of that`
  }
  if (bounds.chart) {
    const { series, points } = bounds.chart
    const fits =
      data !== undefined &&
      data.series.length === series &&
      data.series.every((entry) => entry.points.length === points)
    if (!fits) return `a chart plan needs ${series} series of ${points} points`
  } else if (data !== undefined) {
    return 'a graphic plan carries no chart data'
  }
  return null
}
