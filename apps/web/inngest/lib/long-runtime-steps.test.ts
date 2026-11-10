import { shotBriefHash } from '@boom-busters/db'
import { describe, expect, it } from 'vitest'
import { RESOLUTION_STEP_SLOTS } from './shot-list'
import {
  assemblyOtherSteps,
  batchParagraphs,
  perSlotStepsFit,
  rowAnswers,
  stepSlots,
  transcribePerParagraphFits,
  visualsOtherSteps,
} from './slot-steps'

/**
 * Inngest runs one function for up to 1,000 steps (its documented limit; the
 * repo holds no copy of it, so the owner confirms the figure). The visuals
 * runner resolves every slot and assembly ingests every stock slot, so at 180
 * minutes the slot count decides whether a run fits.
 *
 * Ids matter as much as counts: a run parked at a gate when a deploy lands
 * replays, and Inngest hands back the memoised result for an id. A project of
 * up to 60 minutes keeps its per-slot ids and shapes so that replay is exact;
 * only a longer board batches, under ids no old run ever used.
 */

type Slot = { id: string }
const board = (n: number): Slot[] => Array.from({ length: n }, (_, i) => ({ id: `slot-${i}` }))

/** A step harness that memoises by id, as Inngest does, and counts what really ran. */
function harness(memo: Record<string, unknown> = {}) {
  const ran: string[] = []
  const run = async (id: string, fn: () => Promise<unknown>): Promise<unknown> => {
    if (id in memo) return memo[id]
    ran.push(id)
    const value = await fn()
    memo[id] = JSON.parse(JSON.stringify(value))
    return memo[id]
  }
  return { run, ran, memo }
}

describe('perSlotStepsFit', () => {
  it('fits at exactly 980 combined and batches at 981 (the 20-step margin under 1,000)', () => {
    expect(perSlotStepsFit(900, 80)).toBe(true)
    expect(perSlotStepsFit(901, 80)).toBe(false)
  })
})

describe('the counting helpers', () => {
  it('visuals: its fixed steps, a step per chapter, the terminals and two per designed slot', () => {
    expect(visualsOtherSteps({ chapters: 0, designedSlots: 0 })).toBe(21)
    expect(visualsOtherSteps({ chapters: 15, designedSlots: 40 })).toBe(21 + 15 + 2 * 40)
  })
  it('assembly: its fixed steps and two a paragraph without stored timings', () => {
    expect(assemblyOtherSteps({ untimedParagraphs: 0 })).toBe(9)
    expect(assemblyOtherSteps({ untimedParagraphs: 5 })).toBe(19)
  })
  it('a typical 60-minute board (360 slots, 15 chapters, timed takes) stays per-slot in both', () => {
    expect(perSlotStepsFit(360, visualsOtherSteps({ chapters: 15, designedSlots: 80 }))).toBe(true)
    expect(perSlotStepsFit(360, assemblyOtherSteps({ untimedParagraphs: 0 }))).toBe(true)
  })
  it('a shortest-slot 60-minute board (855 slots) batches visuals, which the review step pushes past the limit', () => {
    expect(perSlotStepsFit(855, visualsOtherSteps({ chapters: 15, designedSlots: 80 }))).toBe(false)
    expect(perSlotStepsFit(855, assemblyOtherSteps({ untimedParagraphs: 0 }))).toBe(true)
  })
  it('a 120-minute board of 1,710 slots batches in both', () => {
    expect(perSlotStepsFit(1710, visualsOtherSteps({ chapters: 30, designedSlots: 100 }))).toBe(
      false,
    )
    expect(perSlotStepsFit(1710, assemblyOtherSteps({ untimedParagraphs: 0 }))).toBe(false)
  })
  it('untimed paragraphs push assembly to batches sooner', () => {
    expect(perSlotStepsFit(700, assemblyOtherSteps({ untimedParagraphs: 400 }))).toBe(false)
  })
})

describe('a board whose per-slot steps fit', () => {
  it('(a) replays old per-slot results under resolve-<id> without re-running them', async () => {
    const slots = board(30)
    const memo = Object.fromEntries(
      slots.map((s) => [`resolve-${s.id}`, { ok: true, status: 'resolved' }]),
    )
    const h = harness(memo)
    let resolved = 0
    const out = await stepSlots(h.run, slots, 'resolve', {
      perSlot: true,
      run: async () => {
        resolved += 1
        return { ok: true, status: 'resolved' }
      },
    })
    expect(resolved).toBe(0)
    expect(h.ran).toEqual([])
    expect(out.map((o) => o.slot.id)).toEqual(slots.map((s) => s.id))
    expect(out.every((o) => (o.outcome as { ok: boolean }).ok)).toBe(true)
  })

  it('keeps the exact per-slot id and a single outcome as the step result', async () => {
    const h = harness()
    await stepSlots(h.run, board(900), 'ingest-stock', {
      perSlot: true,
      run: async () => ({ ok: true }),
    })
    expect(h.ran).toHaveLength(900)
    expect(h.ran[0]).toBe('ingest-stock-slot-0')
    expect(h.memo['ingest-stock-slot-0']).toEqual({ ok: true })
  })
})

describe('a board whose per-slot steps do not fit', () => {
  const long = board(981)

  it('(b) batches eight a step under resolve-batch-<n>, never resolve-<slotId>', async () => {
    const h = harness()
    await stepSlots(h.run, long, 'resolve', { perSlot: false, run: async () => ({ ok: true }) })
    expect(h.ran).toHaveLength(Math.ceil(long.length / RESOLUTION_STEP_SLOTS))
    expect(h.ran[0]).toBe('resolve-batch-0')
    expect(h.ran.every((id) => /^resolve-batch-\d+$/.test(id))).toBe(true)
    expect(h.ran.some((id) => id.startsWith('resolve-slot-'))).toBe(false)
  })

  it('(b) the same for the assembly ingest', async () => {
    const h = harness()
    await stepSlots(h.run, long, 'ingest-stock', {
      perSlot: false,
      run: async () => ({ ok: true }),
    })
    expect(h.ran.every((id) => /^ingest-stock-batch-\d+$/.test(id))).toBe(true)
    expect(h.ran.some((id) => id.startsWith('ingest-stock-slot-'))).toBe(false)
  })

  it('keeps every slot, in order', async () => {
    const h = harness()
    const out = await stepSlots(h.run, long, 'resolve', {
      perSlot: false,
      run: async () => ({ ok: true }),
    })
    expect(out.map((o) => o.slot.id)).toEqual(long.map((s) => s.id))
  })

  it('(c) a retried batch does not run the slots already answered', async () => {
    const answered = new Set(['slot-0', 'slot-1', 'slot-2'])
    const generated: string[] = []
    const opts = {
      perSlot: false,
      run: async (slot: Slot) => {
        generated.push(slot.id)
        answered.add(slot.id)
        return { ok: true, status: 'resolved' }
      },
      skip: async (slot: Slot) => (answered.has(slot.id) ? { ok: true, status: 'resolved' } : null),
    }
    // A first attempt bought slots 3 and 4, then the step died before it returned.
    for (const id of ['slot-3', 'slot-4']) answered.add(id)
    await stepSlots(harness().run, long, 'resolve', opts)
    expect(generated).not.toContain('slot-0')
    expect(generated).not.toContain('slot-3')
    expect(generated).not.toContain('slot-4')
    expect(generated).toContain('slot-5')
  })

  it('stops after a step whose result carries a stop signal', async () => {
    const h = harness()
    const out = await stepSlots(h.run, long, 'resolve', {
      perSlot: false,
      run: async (slot: Slot) => (slot.id === 'slot-2' ? { gate: true } : { ok: true }),
      stopAfter: (o) => 'gate' in (o as object),
    })
    expect(h.ran).toEqual(['resolve-batch-0'])
    expect(out.length).toBeLessThanOrEqual(RESOLUTION_STEP_SLOTS)
  })
})

describe('step counts', () => {
  // Slots at 180 minutes: 10,260 s of narration over 4 to 15 s slots at hold 1
  // and 7.5 to 15 s at hold 2.5; typical is the middle of the range.
  const cases = [
    { name: 'hold 1, shortest slots', slots: 2565 },
    { name: 'hold 1, typical slots', slots: 1080 },
    { name: 'hold 2.5, shortest slots', slots: 1368 },
    { name: 'hold 2.5, typical slots', slots: 912 },
  ]
  it.each(cases)('$name: a 180-minute visuals run stays under 1,000 steps', async ({ slots }) => {
    const other = visualsOtherSteps({ chapters: 35, designedSlots: Math.round(slots / 10) })
    const h = harness()
    await stepSlots(h.run, board(slots), 'resolve', {
      perSlot: perSlotStepsFit(slots, other),
      run: async () => ({ ok: true }),
    })
    expect(h.ran.length + other).toBeLessThan(1000)
  })
})

describe('rowAnswers', () => {
  const slot = { brief: { type: 'still', prompt: 'a room' }, route: null }
  const stamped = (brief: unknown, route: unknown = null) => ({
    status: 'resolved' as const,
    resolvedBriefHash: shotBriefHash(brief, route),
    reuseOfSlotId: null,
  })

  it('(c) is true for a slot stamped for this brief and route, so a retry skips the generator', () => {
    expect(rowAnswers(stamped(slot.brief), slot)).toBe(true)
  })
  it('is false for a slot stamped for an older brief, an unresolved one, or a missing row', () => {
    expect(rowAnswers(stamped({ type: 'still', prompt: 'another' }), slot)).toBe(false)
    expect(rowAnswers({ ...stamped(slot.brief), status: 'unresolved' }, slot)).toBe(false)
    expect(rowAnswers(undefined, slot)).toBe(false)
  })
})

describe('transcription steps', () => {
  it('fits one job a paragraph until the step limit, then batches', () => {
    expect(transcribePerParagraphFits(200, 100)).toBe(true)
    // 880 + 9 + 100 + 20 = 1009
    expect(transcribePerParagraphFits(440, 100)).toBe(false)
  })

  it('batches eight at a time, the last short', () => {
    const batches = batchParagraphs(
      Array.from({ length: 17 }, (_, i) => i),
      8,
    )
    expect(batches.map((batch) => batch.length)).toEqual([8, 8, 1])
  })
})
