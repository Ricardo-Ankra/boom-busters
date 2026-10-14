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

/**
 * Steer phrases, in the order they are tried. Compound phrases only, so an
 * ordinary instruction ("make the logo bigger", "list fewer words") does not
 * pick a technique; "highlight" and "pie" are the two single words kept.
 */
const STEER: readonly [RegExp, Technique][] = [
  [/\blower[ -]thirds?\b/gi, 'lower-third'],
  [/\bprogress[ -]bars?\b/gi, 'progress-bars'],
  [/\bchapter[ -]titles?\b/gi, 'chapter-title'],
  [/\bword[ -]stacks?\b|\bkinetic\b/gi, 'kinetic-word-stack'],
  [/\btypewriter\b/gi, 'typewriter'],
  [/\bprogress[ -]steps?\b|\bstep[ -]by[ -]step\b/gi, 'progress-steps'],
  [/\bsplit[ -]screens?\b|\bside[ -]by[ -]side\b/gi, 'split-screen'],
  [/\bquote[ -]cards?\b|\bas an? quote\b|\bpull[ -]quotes?\b/gi, 'quote-card'],
  [/\bstat[ -]counters?\b|\bcount(?:ing)? up\b/gi, 'stat-counter'],
  [/\bracing[ -](?:charts?|bars?)\b|\bbar race\b/gi, 'racing-chart'],
  [/\bdonut\b|\bpie\b/gi, 'donut-chart'],
  [/\blogo[ -]reveal\b|\breveal the logo\b/gi, 'logo-reveal'],
  [/\bhighlight\b/gi, 'text-highlight'],
  [/\bbullet(?:ed)? list\b|\bas a list\b/gi, 'animated-list'],
]

/** A steer phrase one to three words after one of these is a refusal, not a request. */
const NEGATORS = new Set(['no', 'not', "don't", 'dont', 'without', 'never'])

function steerTechnique(guidance: string): Technique | undefined {
  const text = guidance.replace(/[‘’]/g, "'")
  for (const [pattern, technique] of STEER) {
    for (const match of text.matchAll(pattern)) {
      const before = text
        .slice(0, match.index)
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.replace(/[^a-z']/g, ''))
        .filter(Boolean)
        .slice(-3)
      if (!before.some((word) => NEGATORS.has(word))) return technique
    }
  }
  return undefined
}

/**
 * A quotation: a pair of marks inside one field (a pair never spans fields or
 * lines, so inch marks in two fields are not a quote), or a speech verb. "wrote
 * off", "wrote down", "wrote up" and "told no one" are not speech.
 */
const QUOTE =
  /["“”][^"“”\n]+["“”]|‘[^‘’\n]+’|\bsaid\b|\bwrote\b(?!\s+(?:off|down|up)\b)|\btold\b(?!\s+(?:no one|nobody|nothing)\b)/i
const PERCENT = /%|\bper ?cent\b|\bshare of\b/i
const VERSUS = /\bversus\b|\bvs\.?\b|\bcompared\b|\bside by side\b/i
/**
 * A figure with a unit or a currency: "1.2bn", "900m", "R40 billion" and
 * "$4bn" are figures; "12,000 staff" and "2019" are not. A rand sign counts
 * only with a unit after it.
 */
const UNIT = '(?:bn|m|k|tn|billion|million|thousand|trillion)'
const FIGURE = new RegExp(
  `[$€£]\\s?\\d[\\d,.]*(?:\\s?${UNIT})?\\b|\\bR\\s?\\d[\\d,.]*\\s?${UNIT}\\b|\\b\\d[\\d,.]*\\s?${UNIT}\\b`,
  'gi',
)
const YEAR = /^(?:19|20)\d{2}$/

/** The distinct figures across the fields: "$4bn" and "$ 4bn" are one. */
function distinctFigures(fields: readonly string[]): number {
  const seen = new Set<string>()
  for (const field of fields) {
    for (const match of field.matchAll(FIGURE)) {
      seen.add(
        match[0]
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/[.,]+$/, ''),
      )
    }
  }
  return seen.size
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A logo title as a whole word in the intent, so "ING" is not found in "running". */
function mentionsLogo(intent: string, logos: readonly string[]): boolean {
  return logos.some((logo) => {
    const title = logo.trim()
    if (title.length < 2) return false
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(title)}(?![\\p{L}\\p{N}])`, 'iu')
    return pattern.test(intent)
  })
}

export function techniqueFor(input: TechniqueInput): Technique {
  if (input.guidance) {
    const steered = steerTechnique(input.guidance)
    if (steered) return steered
  }
  if (input.type === 'chart') return chartTechnique(input)
  const fields = [input.intent, input.description, input.coversText]
  const text = fields.join('\n')
  if (fields.some((field) => QUOTE.test(field))) return 'quote-card'
  if (PERCENT.test(text)) return 'donut-chart'
  if (VERSUS.test(text)) return 'split-screen'
  if (mentionsLogo(input.intent, input.logos)) return 'logo-reveal'
  const figures = distinctFigures(fields)
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
