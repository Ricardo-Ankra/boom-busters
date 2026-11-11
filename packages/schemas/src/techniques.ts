import { z } from 'zod'

/**
 * The graphic technique catalogue (decision 305): one key per technique the
 * exemplar corpus holds. It lives here, below the providers package, so a
 * channel's settings can name the techniques it uses (spec 2026-11-04,
 * section 8.1) without the schemas depending on the corpus.
 */
export const TECHNIQUES = [
  'stat-counter',
  'kpi-counter',
  'bar-chart',
  'line-chart',
  'racing-chart',
  'comparison-chart',
  'donut-chart',
  'progress-bars',
  'progress-steps',
  'kinetic-word-stack',
  'typewriter',
  'text-highlight',
  'quote-card',
  'animated-list',
  'lower-third',
  'chapter-title',
  'film-title',
  'logo-reveal',
  'split-screen',
] as const
export type Technique = (typeof TECHNIQUES)[number]

/**
 * Techniques reserved for one card of the film: the designer never picks them
 * for an ordinary slot and a channel never ticks them in or out. The film
 * title is drawn only for the title card (spec 2026-11-11).
 */
export const RESERVED_TECHNIQUES = ['film-title'] as const

export function isReservedTechnique(key: string): boolean {
  return (RESERVED_TECHNIQUES as readonly string[]).includes(key)
}

/** The house techniques a channel chooses among: the catalogue less the reserved ones. */
export const CHOOSABLE_TECHNIQUES: readonly Technique[] = TECHNIQUES.filter(
  (key) => !isReservedTechnique(key),
)

/**
 * The two techniques every channel keeps: the rules' last resort for a
 * graphic and for a chart, so a slot always has an exemplar (spec 8.3).
 */
export const LAST_RESORT_TECHNIQUES = ['kinetic-word-stack', 'bar-chart'] as const

/**
 * A technique key as a channel's settings and exemplar rows carry it (spec
 * 8.5, plan 5): a house key or the channel's own, kebab case, 3 to 40
 * characters. Here, below `channel-exemplars.ts` and `channel-techniques.ts`,
 * so both can read it without a cycle.
 */
export const TECHNIQUE_KEY_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
export const TECHNIQUE_KEY_MIN = 3
export const TECHNIQUE_KEY_MAX = 40
export const TechniqueKeySchema = z
  .string()
  .min(TECHNIQUE_KEY_MIN)
  .max(TECHNIQUE_KEY_MAX)
  .regex(TECHNIQUE_KEY_PATTERN, 'a technique key is lower-case words joined by hyphens')
export type TechniqueKey = string

export function isHouseTechnique(key: string): key is Technique {
  return (TECHNIQUES as readonly string[]).includes(key)
}

/** A key that is not in the catalogue. */
export const ChannelTechniqueKeySchema = TechniqueKeySchema.refine(
  (key) => !isHouseTechnique(key),
  'a house technique',
)
