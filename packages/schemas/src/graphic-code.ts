import { z } from 'zod'
import { CriticReportSchema } from './critic'
import { figureCitesClaim, figureDigitGroups } from './graphics'
import { UlidSchema } from './ids'
import { MECHANISMS_PER_DESIGN_MAX, MechanismSchema } from './mechanisms'

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
/** The designer's one-line concept, written before the code (decision 388). */
export const GRAPHIC_CONCEPT_MAX = 200
/** The storyboard: one line per change on the slot's clock (decision 388). */
export const GRAPHIC_STORYBOARD_MAX = 16
export const GRAPHIC_STORYBOARD_LINE_MAX = 200

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
  /**
   * The version of the house motion preamble the compiled code carries
   * (decision 301); absent on a design stored before the tokens. Nothing
   * reads it yet: it is here so a later token change can tell old designs
   * from new.
   */
  motion: z.number().int().positive().optional(),
  /**
   * The concept and the storyboard the designer wrote before the code
   * (decision 388); absent on a design stored before them. Kept so the board
   * can show what the graphic set out to do.
   */
  concept: z.string().trim().min(1).max(GRAPHIC_CONCEPT_MAX).optional(),
  storyboard: z
    .array(z.string().trim().min(1).max(GRAPHIC_STORYBOARD_LINE_MAX))
    .max(GRAPHIC_STORYBOARD_MAX)
    .optional(),
  /**
   * What the review made of the design (decision 389): `kept` when the
   * designer, shown its rendered frames, kept it (or its revision could not be
   * kept), `revised` when the revision passed every check and replaced it.
   * Absent when no review ran: switched off, out of time, or no browser.
   */
  review: z.enum(['kept', 'revised']).optional(),
  /** The moves the designer said the design is built on (spec 2026-11-04, section 8.5). */
  mechanisms: z.array(MechanismSchema).max(MECHANISMS_PER_DESIGN_MAX).optional(),
  /**
   * The critic's report on the design (spec 2026-11-04, section 10.4): the
   * five scores, the defects, the fixes it asked for and whether it kept the
   * design. Beside `review`, which says whether a fix replaced the design.
   * Absent on a design reviewed before the critic, or not reviewed.
   */
  critique: CriticReportSchema.optional(),
})
export type GraphicCode = z.infer<typeof GraphicCodeSchema>

/** The wire shape: claim NUMBERS, no compiled code yet. */
export const PlannedGraphicCodeSchema = z.object({
  concept: z.string().trim().min(1).max(GRAPHIC_CONCEPT_MAX).optional(),
  storyboard: z
    .array(z.string().trim().min(1).max(GRAPHIC_STORYBOARD_LINE_MAX))
    .max(GRAPHIC_STORYBOARD_MAX)
    .optional(),
  source: z.string().min(1).max(GRAPHIC_SOURCE_MAX),
  title: z.string().trim().min(1).max(GRAPHIC_TITLE_MAX),
  facts: z
    .array(z.object({ text: z.string().trim().min(1).max(120), claim: z.number().int().min(1) }))
    .max(GRAPHIC_FACTS_MAX),
  /** The moves the design is built on, from the global list; optional, at most six. */
  mechanisms: z.array(MechanismSchema).max(MECHANISMS_PER_DESIGN_MAX).optional(),
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

/**
 * Where a tag stood between two pieces of visible text (`figureText` in the
 * dry run). Text nodes in separate elements are separate pieces; a figure
 * drawn a digit to a column (a drum) is several pieces that read as one.
 */
export const PIECE_BREAK = '\u2063'

/** Number pieces with only tags between them: "3", ".", "4" in three spans. */
const NUMBER_PIECES = /[\d.,]+(?:\u2063+[\d.,]+)+/g

/**
 * One sample as the facts check reads it (decision 449). Number pieces with
 * only tags between them are read as the one figure they make when a cited
 * text holds that figure, so a drum's "3", "." and "4" are the 3.4bn the
 * claim gives; otherwise each piece is its own, as two labels side by side
 * are. Every other tag is a space.
 */
export function figureReading(sample: string, cites: (figure: string) => boolean): string {
  return sample
    .replace(NUMBER_PIECES, (run) => {
      const joined = run.split(PIECE_BREAK).join('')
      return cites(joined) ? joined : run
    })
    .split(PIECE_BREAK)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Digit groups a count passes on its way to a cited figure (decision 449).
 *
 * A drum strikes each figure in turn, beat by beat, and a beat can last a
 * second: "1", "2", "3", then "3.4" is a count to 3.4bn, not four figures.
 * Where two samples in a row show as many groups, the groups at one place
 * that differ are the same figure changing. A group counts as passed when,
 * from it, the figure keeps rising (or keeps falling) to a group a cited
 * text holds. A group nothing replaces, or one a count leaves for a figure
 * no claim holds, is still checked.
 */
export function passedOnTheWay(
  readings: readonly string[],
  cites: (figure: string) => boolean,
): Set<string> {
  const next = new Map<string, Set<string>>()
  for (let i = 1; i < readings.length; i++) {
    const before = figureDigitGroups(readings[i - 1] ?? '')
    const after = figureDigitGroups(readings[i] ?? '')
    if (before.length !== after.length) continue
    before.forEach((group, at) => {
      const then = after[at]
      if (then === undefined || then === group) return
      const known = next.get(group) ?? new Set<string>()
      known.add(then)
      next.set(group, known)
    })
  }
  // From `group`, moving one way only, is a cited group reached?
  const reaches = (group: string, way: number, seen: Set<string>): boolean => {
    for (const then of next.get(group) ?? []) {
      const step = Math.sign(Number(then) - Number(group))
      if (step === 0 || Number.isNaN(step) || (way !== 0 && step !== way)) continue
      if (cites(then)) return true
      if (seen.has(then)) continue
      seen.add(then)
      if (reaches(then, step, seen)) return true
    }
    return false
  }
  const passed = new Set<string>()
  for (const group of next.keys()) {
    if (reaches(group, 0, new Set([group]))) passed.add(group)
  }
  return passed
}

/**
 * The digit groups the facts check holds a design to (decision 449): those
 * that stay a second (`shownDigitGroups`) in the samples as `figureReading`
 * reads them, less the ones a count passes on its way (`passedOnTheWay`).
 * `cited` are the texts a shown figure may come from: the cited claims and,
 * for a chart, its series.
 */
export function shownFigures(
  samples: readonly string[],
  minSamples: number,
  cited: readonly string[],
): string[] {
  const cites = (figure: string) => cited.some((text) => figureCitesClaim(figure, text))
  const readings = samples.map((sample) => figureReading(sample, cites))
  const passed = passedOnTheWay(readings, cites)
  return shownDigitGroups(readings, minSamples).filter((group) => !passed.has(group))
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
