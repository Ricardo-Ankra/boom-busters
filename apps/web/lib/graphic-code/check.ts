import { graphicBrand } from '@boom-busters/compositions/graphic-code-pure'
import { MOTION_PREAMBLE, MOTION_VERSION } from '@boom-busters/compositions/motion-tokens'
import {
  codeLogoLibrary,
  DEFAULT_SETTINGS,
  GRAPHIC_CODE_VERSION,
  graphicFactsIssue,
  resolveBrandKit,
  shownDigitGroups,
} from '@boom-busters/schemas'
import type {
  ChartBrief,
  DesignableBrief,
  GraphicCode,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import type { GraphicDesignContext } from '@/lib/graphic-design-core'
import { compileGraphicSource } from './compile'
import { dryRunGraphic, GRAPHIC_SAMPLE_MS } from './dry-run'
import { scanGraphicSource } from './scan'

/**
 * Whether a design can be kept (decision 295): the compile, the scan, the
 * dry run and the facts, in that order. The house motion preamble is
 * prepended between the scan and the dry run (decision 301), so the code the dry
 * run checks is the code that is stored. The scan reads the compiled code,
 * where JSX text is already a string, so it cannot be fooled by an apostrophe
 * in a caption; that is why the compile comes first. The facts come last
 * because they are read off the dry run's text, in each frame size apart: a
 * digit group counts as shown when it stays on screen for a second, so a
 * counter's passing values ("2.3bn" on the way to "4bn") are never checked
 * and the figure it lands on always is. Synchronous, so it runs inside
 * `callForAnswer`'s parse and a refusal is retried once with its reason.
 */

/** A digit group on screen for this many consecutive samples (one second) is shown. */
const SHOWN_MIN_SAMPLES = 1000 / GRAPHIC_SAMPLE_MS

/**
 * The compiled code a design is stored and run with (decision 301): the house
 * motion preamble, then the model's code. The scan has already read the
 * model's code on its own; the dry run, the board, the Player and Lambda all
 * run this text, so the tokens a design was checked against travel with it.
 */
function withMotionPreamble(compiled: string): string {
  return `${MOTION_PREAMBLE}\n${compiled}`
}

/**
 * The house brand (ruling 3). The dry run finds crashes, dead air, crops and
 * digits, none of which a colour changes; the real brand reaches the render
 * through the timeline, as it always has.
 */
const DRY_RUN_BRAND = graphicBrand(resolveBrandKit(DEFAULT_SETTINGS))

/**
 * Every mark the library holds, keyed by title (ruling 5), as the assembly and
 * the board hand them over: the code proved here can never meet a missing
 * mark later. The dry run never loads an image, so each `src` is a
 * placeholder, but the size is the mark's own, so code that sizes a logo by
 * its aspect ratio lays it out here as it will on the film. The same rule as
 * the assembly's `logoLibrary` and the board's `codeLogoMarks` (ruling 25): a
 * mark with no title cannot be named and one with no recorded size cannot be
 * placed, so both are left out, and the first mark stored under a title wins.
 * A runner's `setup` memoised before the deploy carries no sizes; a missing
 * size reads as none.
 */
function placeholderLogos(
  context: GraphicDesignContext,
): Record<string, { src: string; width: number; height: number }> {
  const logos: Record<string, { src: string; width: number; height: number }> = {}
  for (const [title, logo] of codeLogoLibrary(context.logos)) {
    logos[title] = { src: `mock://logo/${logo.id}`, width: logo.width, height: logo.height }
  }
  return logos
}

/**
 * A chart's series as one text the shown digits may come from (ruling 4):
 * each series' label and unit, and each point's `x` and `y` (as `String(y)`
 * writes it). The series were copied verbatim from claims when the chart was
 * planned, so a value the code reads off `props.data` needs no claim number.
 * It goes to `graphicFactsIssue` as an extra text, after the real claims and
 * never citable by number.
 */
function seriesText(brief: ChartBrief): string {
  return brief.series
    .map((series) =>
      [
        series.label,
        series.unit,
        ...series.points.flatMap((point) => [point.x, String(point.y)]),
      ].join(' '),
    )
    .join('\n')
}

export function graphicCodeIssue(
  answer: PlannedGraphicCode,
  context: GraphicDesignContext,
  slot: {
    brief: DesignableBrief
    durationMs: number
    words: readonly { text: string; atMs: number }[]
  },
): { code: GraphicCode } | { issue: string } {
  const compiled = compileGraphicSource(answer.source)
  if (!compiled.ok) return { issue: compiled.issue }
  const scanned = scanGraphicSource(answer.source, compiled.compiled)
  if (scanned !== null) return { issue: scanned }
  const stored = withMotionPreamble(compiled.compiled)

  const { brief } = slot
  const run = dryRunGraphic({
    compiled: stored,
    durationMs: slot.durationMs,
    props: {
      brand: DRY_RUN_BRAND,
      words: slot.words,
      durationMs: slot.durationMs,
      logos: placeholderLogos(context),
      ...(brief.type === 'chart'
        ? {
            data: {
              series: brief.series,
              takeaway: brief.takeaway,
              ...(brief.annotations ? { annotations: brief.annotations } : {}),
            },
          }
        : {}),
    },
  })
  if (run.issue !== null) return { issue: run.issue }

  // Per frame size, never across the two: a digit group counts as shown when
  // it stays a second in one frame, and the Short's 9:16 frame may show a
  // figure the film's 16:9 frame never does.
  for (const orientation of ['landscape', 'portrait'] as const) {
    const factsIssue = graphicFactsIssue({
      shown: shownDigitGroups(run.textSamples[orientation], SHOWN_MIN_SAMPLES),
      facts: answer.facts,
      claims: context.claims,
      // After the real claims, so the claim numbers still index them alone.
      ...(brief.type === 'chart' ? { extraTexts: [seriesText(brief)] } : {}),
    })
    if (factsIssue !== null) {
      return { issue: orientation === 'portrait' ? `${factsIssue}, in portrait` : factsIssue }
    }
  }

  const facts: GraphicCode['facts'] = []
  for (const fact of answer.facts) {
    const claim = context.claims[fact.claim - 1]
    if (!claim) return { issue: `the facts cite claim ${fact.claim}, which is not in the list` }
    facts.push({ text: fact.text, claimId: claim.id })
  }
  return {
    code: {
      version: GRAPHIC_CODE_VERSION,
      source: answer.source,
      compiled: stored,
      title: answer.title,
      facts,
      words: slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
      durationMs: slot.durationMs,
      motion: MOTION_VERSION,
    },
  }
}
