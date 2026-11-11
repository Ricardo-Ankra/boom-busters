import { MANIFEST } from '@boom-busters/providers'
import type { TechniqueEntry } from '@boom-busters/providers'
import { ExemplarPlanSchema, PlannedGraphicCodeSchema, planIssue } from '@boom-busters/schemas'
import type {
  ExemplarPlan,
  GraphicCode,
  MotionIdentity,
  MotionMetrics,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import type { GraphicProps } from '@boom-busters/compositions/graphic-code-pure'
import { derivedContext, derivedSlot, planBounds, storyboardMoments } from '@/lib/exemplar-derive'
import { dryRunProps, graphicCodeIssue } from '@/lib/graphic-code/check'
import { denseMoments, FramesUnavailable } from '@/lib/graphic-code/frames'
import type { FrameShot, GraphicFrames } from '@/lib/graphic-code/frames'
import {
  GRAPHIC_DESIGN_DEADLINE_MS,
  photographForCritic,
  slotWords,
} from '@/lib/graphic-design-core'

/**
 * A channel exemplar written by hand in a session rather than by the paid
 * derivation (decision 462): the plan and the design go through the very
 * checks a derived version does (the plan's bounds, `graphicCodeIssue` under
 * the channel's motion identity, the designer's layout check in the browser
 * with the channel's brand), and are photographed as the deriver
 * photographs them, plus an even sheet across the whole slot for the
 * reviewer. No model call, no spend.
 */

/** The catalogue entry a hand-made version is planned against; house techniques only. */
export function handEntry(technique: string): TechniqueEntry {
  const entry = MANIFEST.find((candidate) => candidate.technique === technique)
  if (!entry) throw new Error(`"${technique}" is not a house technique`)
  return entry
}

/** The design's files as written: the plan, the planned code (claim numbers), read and validated. */
export function parseHandFiles(input: {
  plan: unknown
  source: string
  title: string
  facts?: unknown
}): { plan: ExemplarPlan; answer: PlannedGraphicCode } {
  const plan = ExemplarPlanSchema.parse(input.plan)
  const answer = PlannedGraphicCodeSchema.parse({
    title: input.title,
    source: input.source,
    facts: input.facts ?? [],
    concept: plan.concept,
    storyboard: plan.storyboard,
    ...(plan.mechanisms.length > 0 ? { mechanisms: plan.mechanisms } : {}),
  })
  return { plan, answer }
}

export interface HandChecked {
  code: GraphicCode
  /** The words the code reads, as the checks and the player time them: the plan's text spread across the slot. */
  words: { text: string; atMs: number }[]
  shots: FrameShot[]
  /** Contact sheets, base64 JPEG: the storyboard moments the deriver photographs, and an even set across the slot. */
  sheets: {
    storyboard: Partial<Record<'landscape' | 'portrait', string>>
    even: Partial<Record<'landscape' | 'portrait', string>>
  }
  findings: string[]
  metrics: MotionMetrics | null
}

/**
 * Every check a derived version passes, in the deriver's order, then the
 * photographs. The first refusal as one sentence; no browser is a refusal
 * too, since a hand-made version is only kept once it has been looked at.
 */
export async function checkHandDesign(input: {
  entry: TechniqueEntry
  plan: ExemplarPlan
  answer: PlannedGraphicCode
  motion: MotionIdentity
  brand: GraphicProps['brand']
  frames: GraphicFrames
}): Promise<{ issue: string } | HandChecked> {
  const { entry, plan, answer, motion, brand, frames } = input
  const planned = planIssue(plan, planBounds(entry))
  if (planned !== null) return { issue: `plan: ${planned}` }
  const context = derivedContext(entry, plan)
  const slot = derivedSlot(entry, plan, context)
  const words = slotWords(context, slot)
  const checkSlot = { brief: slot.brief, durationMs: slot.durationMs, words }
  const checked = graphicCodeIssue(answer, context, checkSlot, { motion })
  if ('issue' in checked) return { issue: checked.issue }
  const { code } = checked
  try {
    const layout = await frames.inspect({
      compiled: code.compiled,
      props: dryRunProps(context, checkSlot, brand),
      durationMs: slot.durationMs,
      shots: false,
      measure: true,
    })
    if (layout.layoutIssue !== null) return { issue: `layout: ${layout.layoutIssue}` }
  } catch (error) {
    if (!(error instanceof FramesUnavailable)) throw error
    return { issue: `no browser: ${error.message}` }
  }
  const photograph = (dense: readonly number[]) =>
    photographForCritic(context, slot, code, {
      frames,
      brand,
      motion,
      dense,
      deadline: Date.now() + GRAPHIC_DESIGN_DEADLINE_MS,
    })
  const board = await photograph(storyboardMoments(plan.storyboard, slot.durationMs))
  if ('none' in board) return { issue: `no frames: ${board.none}` }
  const even = await photograph(denseMoments(slot.durationMs))
  return {
    code,
    words,
    shots: board.photographed.shots,
    sheets: {
      storyboard: board.photographed.sheets,
      even: 'none' in even ? {} : even.photographed.sheets,
    },
    findings: board.photographed.findings,
    metrics: board.metrics,
  }
}
