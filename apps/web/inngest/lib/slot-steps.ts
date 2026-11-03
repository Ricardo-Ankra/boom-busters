import { slotNeedsResolution } from '@boom-busters/db'
import type { ShotSlotRow } from '@boom-busters/db'
import { chunk } from './narration'
import { RESOLUTION_CONCURRENCY, RESOLUTION_STEP_SLOTS } from './shot-list'

/** Inngest's cap on steps in one function run (vendor documentation; the repo holds no copy). */
export const STEP_LIMIT = 1000
/** Room under the cap for a step this count missed. */
export const STEP_MARGIN = 20

/**
 * Whether a run may keep one step per slot: its slots, its own other steps and
 * the margin stay at or under `STEP_LIMIT`. A run that does not fit fails on
 * the limit today, so no working run can sit above this line, and batching
 * there changes no live run's ids. A run that fits keeps its exact old step
 * ids and result shapes, which matters because a run parked at a gate when a
 * deploy lands replays by id and is handed the result it memoised.
 *
 * Real boards stay per-slot: a 60-minute board is 360 to 855 slots (3,420 s of
 * narration over 9.5 s typical and 4 s shortest slots at hold 1), with about
 * 120 other steps in visuals and 9 in assembly.
 *
 * Every input is read from the run's own memoised plan or load step, so the
 * answer is the same on replay.
 */
export function perSlotStepsFit(slots: number, otherSteps: number): boolean {
  return slots + otherSteps + STEP_MARGIN <= STEP_LIMIT
}

/**
 * The steps the visuals runner (`visuals-runner.ts`) takes besides one per
 * slot, worst case. A step added to the runner must change this count.
 *
 * Fixed, 19: load-narration :124, directors-book :179, direction-over-budget
 * :190, load-cast-and-sets :198, empty-plan :292, save-shot-list :311,
 * open-plan-park :317, await-plan-approval :368, plan-timed-out :375,
 * load-plan :386, resolution-over-budget :506, resolution-failed :514,
 * copy-reused-shots :529, enter-board-phase :535, finish-board :537,
 * open-gate :542, await-visuals-gate :555, gate-timed-out :562,
 * close-gate :568.
 * Terminal, 2 (each ends the run, counted anyway): shot-list-<n>-over-budget
 * :258 and graphic-<n>-over-budget :282.
 * Per chapter, 1: shot-list-<n> :229.
 * Per designed graphic or chart slot, 1: graphic-<n>-<m> through
 * `designPlannedGraphics` :269 (`lib/graphic-steps.ts:66`).
 */
export const VISUALS_FIXED_STEPS = 19 + 2

export function visualsOtherSteps(input: { chapters: number; designedSlots: number }): number {
  return VISUALS_FIXED_STEPS + input.chapters + input.designedSlots
}

/**
 * The steps the assembly runner (`assembly-runner.ts`) takes besides one per
 * stock slot, worst case. A step added to the runner must change this count.
 *
 * Fixed, 9: load-assembly :104, missing-narration :138, compile-timeline
 * :285, compile-failed :403, store-timeline :411, open-gate :437,
 * await-preview-gate :450, gate-timed-out :457, close-gate :463.
 * Per paragraph whose take has no stored word timings, 2: transcribe-submit
 * :237 and transcribe-wait :252 (mock mode's one mock-align :228 is fewer;
 * transcribe-failed :262 ends the run).
 */
export const ASSEMBLY_FIXED_STEPS = 9

export function assemblyOtherSteps(input: { untimedParagraphs: number }): number {
  return ASSEMBLY_FIXED_STEPS + 2 * input.untimedParagraphs
}

type StepRun = (id: string, fn: () => Promise<unknown>) => Promise<unknown>

/**
 * Runs one outcome per slot in steps. The caller decides `perSlot` with
 * `perSlotStepsFit` from the run's memoised data.
 *
 * - `perSlot`: a step per slot, in waves of
 *   `RESOLUTION_CONCURRENCY`, as the runners always did.
 * - Otherwise: `RESOLUTION_STEP_SLOTS` slots a step, `<prefix>-batch-<n>`, in
 *   waves inside the step. `skip` is asked first for each slot and a non-null
 *   answer stands in for running it, so a retried batch does not re-buy what
 *   its first attempt finished.
 *
 * `stopAfter` ends the loop after the step that returns a matching outcome
 * (a spend cap: every later slot would meet it too).
 */
export async function stepSlots<T extends { id: string }, O>(
  run: StepRun,
  board: readonly T[],
  prefix: string,
  options: {
    perSlot: boolean
    run: (slot: T) => Promise<O>
    skip?: (slot: T) => Promise<O | null>
    stopAfter?: (outcome: O) => boolean
  },
): Promise<{ slot: T; outcome: O }[]> {
  const settled: { slot: T; outcome: O }[] = []
  const stop = (outcomes: O[]) =>
    options.stopAfter !== undefined && outcomes.some(options.stopAfter)

  if (options.perSlot) {
    for (const wave of chunk(board, RESOLUTION_CONCURRENCY)) {
      const outcomes = (await Promise.all(
        wave.map((slot) => run(`${prefix}-${slot.id}`, () => options.run(slot))),
      )) as O[]
      wave.forEach((slot, at) => settled.push({ slot, outcome: outcomes[at]! }))
      if (stop(outcomes)) break
    }
    return settled
  }

  for (const [n, slots] of chunk(board, RESOLUTION_STEP_SLOTS).entries()) {
    const outcomes = (await run(`${prefix}-batch-${n}`, async () => {
      const inStep: O[] = []
      for (const wave of chunk(slots, RESOLUTION_CONCURRENCY)) {
        const done = await Promise.all(
          wave.map(async (slot) => (await options.skip?.(slot)) ?? (await options.run(slot))),
        )
        inStep.push(...done)
        if (stop(done)) break
      }
      return inStep
    })) as O[]
    outcomes.forEach((outcome, at) => settled.push({ slot: slots[at]!, outcome }))
    if (stop(outcomes)) break
  }
  return settled
}

/**
 * Whether the stored row already answers the brief and route a step was given:
 * resolved, and stamped for exactly that brief and route (`setSlotResolution`
 * writes the stamp). A retried batch asks this first so a slot its dead
 * attempt finished is not generated, and paid for, again.
 */
export function rowAnswers(
  row: Pick<ShotSlotRow, 'status' | 'resolvedBriefHash' | 'reuseOfSlotId'> | undefined,
  slot: { brief: unknown; route: unknown },
): boolean {
  return row !== undefined && !slotNeedsResolution({ ...row, brief: slot.brief, route: slot.route })
}
