import { z } from 'zod'
import { figureCitesClaim, figureDigitGroups } from './graphics'
import { UlidSchema } from './ids'

/**
 * The designer writes the graphic (decision 295).
 *
 * From decision 268 to 290 a graphic was a form the model filled in: a scene
 * of five element kinds on a 12 by 12 grid. The designer now writes the
 * animation itself, as one React component, and the app checks it instead of
 * constraining it: a compile, a static scan of the compiled code, a
 * frame-by-frame dry run and the facts check below, in that order
 * (`apps/web/lib/graphic-code`). What passes is stored on the brief as `code`,
 * not `motion`: every brief already carries the Ken Burns `motion` spec.
 *
 * The model answers in the wire shape (`PlannedGraphicCode`), citing claims by
 * NUMBER as every planning prompt does; the check maps the numbers to ids and
 * adds the compiled code, and only then does the stored shape exist.
 */

/** The sandbox contract the code was written against: its arguments and its banned list. */
export const GRAPHIC_CODE_VERSION = 1
/** One component and its helpers. A source longer than this is a program, not a graphic. */
export const GRAPHIC_SOURCE_MAX = 16_384
/** One line on the slot card. */
export const GRAPHIC_TITLE_MAX = 80
export const GRAPHIC_FACTS_MAX = 40

/** One narrated word, timed from the slot's start: what the code keys its motion to. */
export const GraphicCodeWordSchema = z.object({
  text: z.string().min(1),
  atMs: z.number().int().min(0),
})

/** A number or quoted phrase the graphic shows, and the claim it comes from. */
export const GraphicFactSchema = z.object({
  text: z.string().trim().min(1).max(120),
  claimId: UlidSchema,
})

export const GraphicCodeSchema = z.object({
  version: z.literal(GRAPHIC_CODE_VERSION),
  /** The designer's JSX, kept so a redesign can show the model what it replaces. */
  source: z.string().min(1).max(GRAPHIC_SOURCE_MAX),
  /** What the sandbox runs: the source compiled to plain JavaScript. */
  compiled: z.string().min(1),
  title: z.string().trim().min(1).max(GRAPHIC_TITLE_MAX),
  facts: z.array(GraphicFactSchema).max(GRAPHIC_FACTS_MAX),
  /** The narration the dry run checked the code against. */
  words: z.array(GraphicCodeWordSchema),
  /** The slot length the dry run checked the code at. */
  durationMs: z.number().int().positive(),
})
export type GraphicCode = z.infer<typeof GraphicCodeSchema>

/** The wire shape: claim NUMBERS, no compiled code yet. */
export const PlannedGraphicCodeSchema = z.object({
  source: z.string().min(1).max(GRAPHIC_SOURCE_MAX),
  title: z.string().trim().min(1).max(GRAPHIC_TITLE_MAX),
  facts: z
    .array(z.object({ text: z.string().trim().min(1).max(120), claim: z.number().int().min(1) }))
    .max(GRAPHIC_FACTS_MAX),
})
export type PlannedGraphicCode = z.infer<typeof PlannedGraphicCodeSchema>

/**
 * Digit groups that persisted for `minSamples` consecutive samples of visible text.
 *
 * The dry run reads the visible text every 250 ms. A figure counting up to
 * $4bn passes through 1, 2 and 3 on the way, each for a sample or two; only a
 * group that holds for `minSamples` samples in a row (four: one second) counts
 * as shown, so a count is judged by where it lands. Each group is reported
 * once, in the order it first held.
 */
export function shownDigitGroups(samples: readonly string[], minSamples: number): string[] {
  const shown: string[] = []
  // How many samples in a row each group has been on screen, up to this one.
  let runs = new Map<string, number>()
  for (const sample of samples) {
    const next = new Map<string, number>()
    for (const group of new Set(figureDigitGroups(sample))) {
      const run = (runs.get(group) ?? 0) + 1
      next.set(group, run)
      if (run >= minSamples && !shown.includes(group)) shown.push(group)
    }
    runs = next
  }
  return shown
}

const OUTER_QUOTE_MARKS = /^["'‘’“”]+|["'‘’“”]+$/g

/** A phrase as the comparison reads it: straight apostrophes, single spaces, lower case. */
function phraseKey(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Whether a fact is in its claim. A fact with digits is a figure and is
 * checked as one (`figureCitesClaim`: the digits are the fact, the multiplier
 * is a rendering choice). A fact without digits is a quoted phrase and must
 * appear in the claim's text, its own quote marks, case and spacing aside.
 */
function factInClaim(fact: string, claimText: string): boolean {
  if (figureDigitGroups(fact).length > 0) return figureCitesClaim(fact, claimText)
  const phrase = phraseKey(fact.trim().replace(OUTER_QUOTE_MARKS, ''))
  return phrase !== '' && phraseKey(claimText).includes(phrase)
}

/**
 * null when every shown group is in a cited claim (or in one of `extraTexts`)
 * and every fact is in its claim; else the refusal.
 *
 * The refusal is in the words the designer's retry reads (decision 292). The
 * manifest is checked first, in order: a claim number outside the list, then a
 * fact its claim does not hold. Then what the dry run saw: a shown number must
 * be in a claim the manifest CITES, because a claim the graphic does not name
 * cannot vouch for it. `facts[].claim` is 1-based into `claims`, as in every
 * planning prompt.
 *
 * `extraTexts` are texts a shown number may also come from without a claim
 * number: a chart's own series (decision 295), which were copied verbatim from
 * claims when the chart was planned. They are never citable: a fact's claim
 * number indexes `claims` only.
 */
export function graphicFactsIssue(input: {
  shown: readonly string[]
  facts: readonly { text: string; claim: number }[]
  claims: readonly { text: string }[]
  extraTexts?: readonly string[]
}): string | null {
  const cited: string[] = []
  for (const fact of input.facts) {
    const claim = input.claims[fact.claim - 1]
    if (claim === undefined) {
      return `fact "${fact.text}" cites claim ${fact.claim}, which does not exist`
    }
    if (!factInClaim(fact.text, claim.text)) {
      return `fact "${fact.text}" is not in claim ${fact.claim}`
    }
    cited.push(claim.text)
  }
  const sources = [...cited, ...(input.extraTexts ?? [])]
  for (const group of input.shown) {
    if (!sources.some((text) => figureCitesClaim(group, text))) {
      return `the graphic shows ${group}, which no cited claim contains`
    }
  }
  return null
}
