import { shotBriefHash } from '@boom-busters/db'
import { RUNTIME_START_MAX } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { RESOLUTION_STEP_SLOTS } from './shot-list'
import { PER_SLOT_STEP_MAX_SLOTS, rowAnswers, stepSlots } from './slot-steps'

/**
 * Inngest runs one function for up to 1,000 steps (its documented limit; the
 * repo holds no copy of it, so the owner confirms the figure). The visuals
 * runner resolves every slot and assembly ingests every stock slot, so at 240
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

describe('the per-slot threshold', () => {
  it('is the most slots a 60-minute board can hold at the smallest minimum shot, hold 1', () => {
    // 3,600 s over the 3 s of the shortest minimum (stock, archival, still, graphic, hero).
    expect(RUNTIME_START_MAX).toBe(60)
    expect(PER_SLOT_STEP_MAX_SLOTS).toBe(1200)
  })
})

describe('a board a 60-minute project can hold', () => {
  it('(a) replays old per-slot results under resolve-<id> without re-running them', async () => {
    const slots = board(30)
    const memo = Object.fromEntries(
      slots.map((s) => [`resolve-${s.id}`, { ok: true, status: 'resolved' }]),
    )
    const h = harness(memo)
    let resolved = 0
    const out = await stepSlots(h.run, slots, 'resolve', {
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
    await stepSlots(h.run, board(PER_SLOT_STEP_MAX_SLOTS), 'ingest-stock', {
      run: async () => ({ ok: true }),
    })
    expect(h.ran).toHaveLength(PER_SLOT_STEP_MAX_SLOTS)
    expect(h.ran[0]).toBe('ingest-stock-slot-0')
    expect(h.memo['ingest-stock-slot-0']).toEqual({ ok: true })
  })
})

describe('a board only a longer project can hold', () => {
  const long = board(PER_SLOT_STEP_MAX_SLOTS + 1)

  it('(b) batches eight a step under resolve-batch-<n>, never resolve-<slotId>', async () => {
    const h = harness()
    await stepSlots(h.run, long, 'resolve', { run: async () => ({ ok: true }) })
    expect(h.ran).toHaveLength(Math.ceil(long.length / RESOLUTION_STEP_SLOTS))
    expect(h.ran[0]).toBe('resolve-batch-0')
    expect(h.ran.every((id) => /^resolve-batch-\d+$/.test(id))).toBe(true)
    expect(h.ran.some((id) => id.startsWith('resolve-slot-'))).toBe(false)
  })

  it('(b) the same for the assembly ingest', async () => {
    const h = harness()
    await stepSlots(h.run, long, 'ingest-stock', { run: async () => ({ ok: true }) })
    expect(h.ran.every((id) => /^ingest-stock-batch-\d+$/.test(id))).toBe(true)
    expect(h.ran.some((id) => id.startsWith('ingest-stock-slot-'))).toBe(false)
  })

  it('keeps every slot, in order', async () => {
    const h = harness()
    const out = await stepSlots(h.run, long, 'resolve', { run: async () => ({ ok: true }) })
    expect(out.map((o) => o.slot.id)).toEqual(long.map((s) => s.id))
  })

  it('(c) a retried batch does not run the slots already answered', async () => {
    const answered = new Set(['slot-0', 'slot-1', 'slot-2'])
    const generated: string[] = []
    const opts = {
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
      run: async (slot: Slot) => (slot.id === 'slot-2' ? { gate: true } : { ok: true }),
      stopAfter: (o) => 'gate' in (o as object),
    })
    expect(h.ran).toEqual(['resolve-batch-0'])
    expect(out.length).toBeLessThanOrEqual(RESOLUTION_STEP_SLOTS)
  })
})

describe('step counts', () => {
  // Slots at 240 minutes: 13,680 s of narration over 4 to 15 s slots at hold 1
  // and 7.5 to 15 s at hold 2.5; typical is the middle of the range.
  const cases = [
    { name: 'hold 1, shortest slots', slots: 3420 },
    { name: 'hold 1, typical slots', slots: 1440 },
    { name: 'hold 2.5, shortest slots', slots: 1824 },
    { name: 'hold 2.5, typical slots', slots: 1216 },
  ]
  it.each(cases)('$name: a 240-minute run stays under 1,000 steps', async ({ slots }) => {
    const h = harness()
    await stepSlots(h.run, board(slots), 'resolve', { run: async () => ({ ok: true }) })
    const OTHER_STEPS = 46 * 6 + 20 // shot list, graphics and the gate steps
    expect(h.ran.length + OTHER_STEPS).toBeLessThan(1000)
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
