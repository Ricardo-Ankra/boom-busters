import type { ChartKind } from '@boom-busters/schemas'
import type { Technique } from './manifest'

/**
 * Which exemplar a slot gets (decision 305): a pure function of the brief's
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
 * pick a technique. The single words kept are "kinetic", "typewriter", "donut",
 * "pie" and "highlight". When two phrases are named, the first in this order wins.
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

/**
 * A steer phrase after one of these, in the same clause, is a refusal, not a
 * request: "less kinetic" and "remove the highlight" leave the slot to the rules.
 */
const NEGATORS = new Set([
  'no',
  'not',
  "don't",
  'dont',
  'without',
  'never',
  'less',
  'remove',
  'drop',
  'lose',
])

function steerTechnique(guidance: string): Technique | undefined {
  // Negation is clause-scoped: a clause ends at , ; : . ! ? or the word "but".
  const clauses = guidance.replace(/[‘’]/g, "'").split(/[,;:.!?]|\bbut\b/i)
  for (const [pattern, technique] of STEER) {
    for (const clause of clauses) {
      for (const match of clause.matchAll(pattern)) {
        const before = clause
          .slice(0, match.index)
          .toLowerCase()
          .split(/\s+/)
          .map((word) => word.replace(/[^a-z']/g, ''))
        if (!before.some((word) => NEGATORS.has(word))) return technique
      }
    }
  }
  return undefined
}

/**
 * A quotation: a pair of marks inside one field (a pair never spans fields or
 * lines, so inch marks in two fields are not a quote). A single curly pair
 * opens at the field start or after whitespace or a bracket and is not
 * followed by a letter, so an apostrophe ("the ‘90s", "the bank’s") is not one.
 */
const QUOTE_MARKS = /["“”][^"“”\n]+["“”]|(?<![^\s([{])‘[^‘’\n]+’(?!\p{L})/u
/**
 * A speech verb, read on the intent only: narration reports what people said
 * about a figure ("EY said €1.9bn could not be found") without the slot being
 * a quotation. "wrote off", "wrote down", "wrote up" and "told no one" are not
 * speech.
 */
const SPEECH =
  /\bsaid\b|\bwrote\b(?!\s+(?:off|down|up)\b)|\btold\b(?!\s+(?:no[ -]one|nobody|nothing)\b)/i
/** A percentage, or a share; "per cent of" is caught by "per cent". */
const PERCENT = /%|\bper ?cent\b|\bshare of\b/i
/** A movement word: a percentage that moves is a counter, not a share of a whole. */
const MOVEMENT =
  /\b(?:fell|fall|falls|lost|lose|loses|rose|rise|rises|up|down|dropped|drop|jumped|plunged|slumped|surged|crashed|soared)\b/i
/** A comparison, read on the intent and the description only, not the narration. */
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

const MULTIPLIER: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  million: 1e6,
  bn: 1e9,
  billion: 1e9,
  tn: 1e12,
  trillion: 1e12,
}

/**
 * The distinct figures across the fields, keyed on (currency or none, value):
 * "$4bn", "$ 4bn", "4 billion" and "4.0bn" are one figure. A figure with no
 * currency merges into a currency figure of the same value; "$4bn" and "€4bn"
 * stay two.
 */
function distinctFigures(fields: readonly string[]): number {
  const keyed = new Map<string, { currency: string; value: number }>()
  for (const field of fields) {
    for (const match of field.matchAll(FIGURE)) {
      const text = match[0].trim().replace(/[.,\s]+$/, '')
      const currency = /^[$€£R]/i.test(text) ? text.charAt(0).toUpperCase() : ''
      const number = text.match(/\d[\d,]*(?:\.\d+)?/)?.[0].replace(/,/g, '') ?? '0'
      const unit = text.match(/(bn|billion|tn|trillion|million|thousand|m|k)$/i)?.[0].toLowerCase()
      const value = Math.round(Number(number) * (unit ? (MULTIPLIER[unit] ?? 1) : 1))
      keyed.set(`${currency}|${value}`, { currency, value })
    }
  }
  const figures = [...keyed.values()]
  const priced = new Set(figures.filter((f) => f.currency).map((f) => f.value))
  return figures.filter((f) => f.currency || !priced.has(f.value)).length
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A logo title as a whole word in the intent, so "ING" is not found in
 * "running". A match written all in lower case does not count when the title
 * has a capital ("a shell company" is not the Shell logo; "ACME" is Acme).
 */
function mentionsLogo(intent: string, logos: readonly string[]): boolean {
  return logos.some((logo) => {
    const title = logo.trim()
    if (title.length < 2) return false
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(title)}(?![\\p{L}\\p{N}])`, 'giu')
    const hasCapital = title !== title.toLowerCase()
    return [...intent.matchAll(pattern)].some(
      (match) => !(hasCapital && match[0] === match[0].toLowerCase()),
    )
  })
}

export function techniqueFor(input: TechniqueInput): Technique {
  if (input.guidance) {
    const steered = steerTechnique(input.guidance)
    if (steered) return steered
  }
  if (input.type === 'chart') return chartTechnique(input)
  const fields = [input.intent, input.description, input.coversText]
  if (fields.some((field) => QUOTE_MARKS.test(field)) || SPEECH.test(input.intent)) {
    return 'quote-card'
  }
  // A percentage that moves in its own field ("shares lost 70%") is a counter;
  // any other percentage or share ("40% of the money") is a share of a whole.
  if (fields.some((field) => PERCENT.test(field) && MOVEMENT.test(field))) return 'stat-counter'
  if (fields.some((field) => PERCENT.test(field))) return 'donut-chart'
  if (VERSUS.test(input.intent) || VERSUS.test(input.description)) return 'split-screen'
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
      // A race needs several series to reorder over a years axis; one series
      // is a plain bar chart however long it runs.
      if (series >= 3 && labels.length >= 5 && labels.every((label) => YEAR.test(label))) {
        return 'racing-chart'
      }
      if (series >= 2) return 'comparison-chart'
      return 'bar-chart'
    case 'stacked':
    default:
      return 'bar-chart'
  }
}
