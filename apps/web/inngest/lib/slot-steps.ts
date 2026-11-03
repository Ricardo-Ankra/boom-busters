import { slotNeedsResolution } from '@boom-busters/db'
import type { ShotSlotRow } from '@boom-busters/db'
import { MIN_SHOT_SECONDS, RUNTIME_START_MAX } from '@boom-busters/schemas'
import { chunk } from './narration'
import { RESOLUTION_CONCURRENCY, RESOLUTION_STEP_SLOTS } from './shot-list'

/**
 * The most slots a project of up to `RUNTIME_START_MAX` minutes can hold: the
 * whole runtime at the shortest minimum shot (3 s, the least of
 * `MIN_SHOT_SECONDS`) at hold 1, which is as short as a hold allows. 60
 * minutes is 3,600 s, so 1,200. A real board is far under it; it is a bound,
 * not a typical board (about 360 slots at 60 minutes).
 *
 * Up to it a run keeps one Inngest step per slot, under `<prefix>-<slotId>`
 * and returning one outcome, exactly as before. A run parked at a gate when a
 * deploy lands replays by step id, and Inngest answers a replayed id with the
 * result it memoised; a new shape or a reused id with a new shape crashes it.
 * Only a board no project could hold before is batched, under ids no old run
 * ever used.
 */
export const PER_SLOT_STEP_MAX_SLOTS = Math.ceil(
  (RUNTIME_START_MAX * 60) / Math.min(...Object.values(MIN_SHOT_SECONDS)),
)

type StepRun = (id: string, fn: () => Promise<unknown>) => Promise<unknown>

/**
 * Runs one outcome per slot in steps. The board is read once, inside a step
 * the run has memoised, so its length (and so the choice between per-slot and
 * batch steps) is the same on every replay.
 *
 * - Up to `PER_SLOT_STEP_MAX_SLOTS`: a step per slot, in waves of
 *   `RESOLUTION_CONCURRENCY`, as the runners always did.
 * - Above it: `RESOLUTION_STEP_SLOTS` slots a step, `<prefix>-batch-<n>`, in
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
    run: (slot: T) => Promise<O>
    skip?: (slot: T) => Promise<O | null>
    stopAfter?: (outcome: O) => boolean
  },
): Promise<{ slot: T; outcome: O }[]> {
  const settled: { slot: T; outcome: O }[] = []
  const stop = (outcomes: O[]) =>
    options.stopAfter !== undefined && outcomes.some(options.stopAfter)

  if (board.length <= PER_SLOT_STEP_MAX_SLOTS) {
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
