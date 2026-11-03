import { describe, expect, it } from 'vitest'
import { RESOLUTION_STEP_SLOTS, resolutionBatches } from './shot-list'

/**
 * Inngest runs one function for up to 1,000 steps (its documented limit; the
 * repo holds no copy of it, so the owner confirms the figure). The visuals
 * runner plans a chapter (one step, plus one per graphic) and then resolves
 * every slot, so at 240 minutes the slots decide whether the run fits.
 *
 * Slots at 240 minutes: 13,680 s of narration (228 minutes, 95% of the
 * target) over the slot length the planner may choose, 4 to 15 s at shot hold
 * 1 and 7.5 to 15 s at hold 2.5. Typical is the middle of that range.
 */
const NARRATION_SECONDS = 13_680
const STEP_LIMIT = 1000
const CHAPTERS = 46 // 240 minutes at 200 wpm in chapters of a thousand words, the most
const OTHER_STEPS = CHAPTERS * 6 + 20 // shot list, graphics and the gate steps

const cases = [
  { name: 'tension, hold 1, shortest slots', slotSeconds: 4 },
  { name: 'tension, hold 1, typical slots', slotSeconds: 9.5 },
  { name: 'calm, hold 2.5, shortest slots', slotSeconds: 7.5 },
  { name: 'calm, hold 2.5, typical slots', slotSeconds: 11.25 },
]

describe('slot resolution steps at 240 minutes', () => {
  it.each(cases)('$name: the run stays under the step limit', ({ slotSeconds }) => {
    const board = Array.from({ length: Math.ceil(NARRATION_SECONDS / slotSeconds) }, (_, i) => ({
      id: `slot-${i}`,
    }))
    const batches = resolutionBatches(board)
    expect(batches.length + OTHER_STEPS).toBeLessThan(STEP_LIMIT)
  })

  it('keeps every slot, in order, in steps of a fixed width', () => {
    const board = Array.from({ length: RESOLUTION_STEP_SLOTS + 2 }, (_, i) => ({ id: `slot-${i}` }))
    const batches = resolutionBatches(board)
    expect(batches.flatMap((b) => b.slots.map((s) => s.id))).toEqual(board.map((s) => s.id))
    expect(Math.max(...batches.map((b) => b.slots.length))).toBe(RESOLUTION_STEP_SLOTS)
  })

  it('names a batch by its first slot, so a replay finds its own step', () => {
    const ids = Array.from({ length: RESOLUTION_STEP_SLOTS + 1 }, (_, i) => ({ id: `s${i}` }))
    const batches = resolutionBatches(ids)
    expect(batches.map((b) => b.stepId)).toEqual([
      'resolve-s0',
      `resolve-s${RESOLUTION_STEP_SLOTS}`,
    ])
  })
})

/**
 * Assembly opens a step per stock slot to copy its bytes into R2 (live runs
 * only), so the same arithmetic applies to it. Stock and archival slots are
 * most of a board's slots, so the whole slot count is the safe figure.
 */
describe('stock ingest steps at 240 minutes', () => {
  it.each(cases)('$name: the run stays under the step limit', ({ slotSeconds }) => {
    const board = Array.from({ length: Math.ceil(NARRATION_SECONDS / slotSeconds) }, (_, i) => ({
      id: `slot-${i}`,
    }))
    // The load, the compile, the store and the gate are a dozen steps; paragraphs
    // carry stored timings from the voice, so no whisper step is opened for them.
    expect(resolutionBatches(board, 'ingest-stock').length + 20).toBeLessThan(STEP_LIMIT)
  })

  it('names an ingest step by its first slot', () => {
    const batches = resolutionBatches([{ id: 'a' }], 'ingest-stock')
    expect(batches.map((b) => b.stepId)).toEqual(['ingest-stock-a'])
  })
})
