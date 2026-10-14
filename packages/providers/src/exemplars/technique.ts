import type { ChartKind } from '@boom-busters/schemas'
import type { Technique } from './manifest'

/**
 * Which exemplar a slot gets (decision 304): a pure function of the brief's
 * fields, the film's logo titles and the producer's steer. No model call,
 * deterministic, first match wins. The steer beats every rule, and five
 * techniques are reached by the steer only (the designer does not know a
 * slot's place in its chapter, and the other four are the producer's
 * stylistic choices): chapter-title, typewriter, animated-list, lower-third
 * and progress-bars.
 */
export interface TechniqueInput {
  type: 'graphic' | 'chart'
  chartKind?: ChartKind
  seriesCount?: number
  /** The first series' x labels, for the years test. */
  xLabels?: readonly string[]
  intent: string
  description: string
  coversText: string
  /** The titles the logo library holds. */
  logos: readonly string[]
  /** The producer's steer on a redesign. */
  guidance?: string
}

/** Steer words, in the order they are tried: the more specific phrase first. */
const STEER: readonly [RegExp, Technique][] = [
  [/\blower[ -]third\b/i, 'lower-third'],
  [/\bprogress[ -]bars?\b/i, 'progress-bars'],
  [/\bchapter[ -]title\b/i, 'chapter-title'],
  [/\bword[ -]stack\b|\bkinetic\b/i, 'kinetic-word-stack'],
  [/\btypewriter\b/i, 'typewriter'],
  [/\bsteps?\b/i, 'progress-steps'],
  [/\bquote\b/i, 'quote-card'],
  [/\bcounter\b/i, 'stat-counter'],
  [/\bracing\b/i, 'racing-chart'],
  [/\bdonut\b|\bpie\b/i, 'donut-chart'],
  [/\bsplit\b/i, 'split-screen'],
  [/\blogo\b/i, 'logo-reveal'],
  [/\bhighlight\b/i, 'text-highlight'],
  [/\blist\b/i, 'animated-list'],
]

const QUOTE = /["“”][^"“”]+["“”]|\b(?:said|wrote|told)\b/i
const PERCENT = /%|\bper ?cent\b|\bshare of\b/i
const VERSUS = /\bversus\b|\bvs\.?\b|\bcompared\b|\bagainst\b|\bside by side\b/i
/** A figure with a unit or a currency: "1.2bn", "900m", "12,000 staff" is not one, "$4bn" is. */
const FIGURE =
  /[$€£]\s?\d[\d,.]*(?:\s?(?:bn|m|k|billion|million|thousand))?\b|\b\d[\d,.]*\s?(?:bn|m|k|billion|million|thousand)\b/gi
const YEAR = /^\d{4}$/

export function techniqueFor(input: TechniqueInput): Technique {
  if (input.guidance) {
    for (const [pattern, technique] of STEER) {
      if (pattern.test(input.guidance)) return technique
    }
  }
  if (input.type === 'chart') return chartTechnique(input)
  const text = [input.intent, input.description, input.coversText].join('\n')
  if (QUOTE.test(text)) return 'quote-card'
  if (PERCENT.test(text)) return 'donut-chart'
  if (VERSUS.test(text)) return 'split-screen'
  const intent = input.intent.toLowerCase()
  if (
    input.logos.some(
      (title) => title.trim().length > 1 && intent.includes(title.trim().toLowerCase()),
    )
  ) {
    return 'logo-reveal'
  }
  const figures = text.match(FIGURE)?.length ?? 0
  if (figures >= 2) return 'kpi-counter'
  if (figures === 1) return 'stat-counter'
  if (input.intent.trim().split(/\s+/).filter(Boolean).length <= 8) return 'text-highlight'
  return 'kinetic-word-stack'
}

function chartTechnique(input: TechniqueInput): Technique {
  const series = input.seriesCount ?? 0
  const labels = input.xLabels ?? []
  switch (input.chartKind) {
    case 'line':
    case 'area':
      return 'line-chart'
    case 'waterfall':
      return 'comparison-chart'
    case 'bar':
      if (series >= 2) return 'comparison-chart'
      if (series === 1 && labels.length >= 5 && labels.every((label) => YEAR.test(label))) {
        return 'racing-chart'
      }
      return 'bar-chart'
    case 'stacked':
    default:
      return 'bar-chart'
  }
}
