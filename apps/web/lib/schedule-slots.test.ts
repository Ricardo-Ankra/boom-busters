import type { ScheduleSlot } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  clashes,
  nextFreeSlot,
  offsetLabel,
  shortSlotsAfter,
  slotFromLocal,
  slotToLocal,
} from './schedule-slots'

const SAST = 120

describe('converting slots between UTC and the owner timezone', () => {
  it('shifts the wall time by the offset on the same day', () => {
    expect(slotToLocal({ kind: 'longform', weekday: 5, timeUtc: '15:00' }, SAST)).toEqual({
      weekday: 5,
      time: '17:00',
    })
  })

  it('rolls into the next day, and Saturday into Sunday', () => {
    expect(slotToLocal({ kind: 'short', weekday: 6, timeUtc: '23:30' }, SAST)).toEqual({
      weekday: 0,
      time: '01:30',
    })
  })

  it('rolls back a day, and Sunday into Saturday, west of UTC', () => {
    expect(slotToLocal({ kind: 'short', weekday: 0, timeUtc: '02:00' }, -300)).toEqual({
      weekday: 6,
      time: '21:00',
    })
  })

  it('stores a local pick as UTC, crossing midnight when it must', () => {
    expect(slotFromLocal('short', 1, '01:00', SAST)).toEqual({
      kind: 'short',
      weekday: 0,
      timeUtc: '23:00',
    })
  })

  it('round-trips every hour of the week in a half-hour timezone', () => {
    for (let weekday = 0; weekday < 7; weekday++) {
      for (let hour = 0; hour < 24; hour++) {
        const slot: ScheduleSlot = {
          kind: 'longform',
          weekday,
          timeUtc: `${String(hour).padStart(2, '0')}:00`,
        }
        const local = slotToLocal(slot, 330)
        expect(slotFromLocal('longform', local.weekday, local.time, 330)).toEqual(slot)
      }
    }
  })
})

describe('clashes', () => {
  const slots: ScheduleSlot[] = [
    { kind: 'longform', weekday: 5, timeUtc: '15:00' },
    { kind: 'short', weekday: 3, timeUtc: '16:00' },
  ]

  it('counts a slot of the other format at the same moment as a clash', () => {
    expect(clashes(slots, { kind: 'short', weekday: 5, timeUtc: '15:00' })).toBe(true)
  })

  it('ignores the slot being edited', () => {
    expect(clashes(slots, { kind: 'longform', weekday: 5, timeUtc: '15:00' }, 0)).toBe(false)
  })
})

describe('nextFreeSlot', () => {
  it('starts from the format usual time', () => {
    expect(nextFreeSlot('longform', [])).toEqual({
      kind: 'longform',
      weekday: 5,
      timeUtc: '15:00',
    })
  })

  it('moves to the next free day at the same time', () => {
    const taken: ScheduleSlot[] = [
      { kind: 'short', weekday: 3, timeUtc: '16:00' },
      { kind: 'short', weekday: 4, timeUtc: '16:00' },
    ]
    expect(nextFreeSlot('short', taken)).toEqual({ kind: 'short', weekday: 5, timeUtc: '16:00' })
  })

  it('moves an hour later once every day is taken at that time', () => {
    const taken: ScheduleSlot[] = Array.from({ length: 7 }, (_, weekday) => ({
      kind: 'short' as const,
      weekday,
      timeUtc: '16:00',
    }))
    expect(nextFreeSlot('short', taken)).toEqual({ kind: 'short', weekday: 3, timeUtc: '17:00' })
  })
})

describe('offsetLabel', () => {
  it('names whole, fractional, negative and zero offsets', () => {
    expect(offsetLabel(120)).toBe('UTC+2')
    expect(offsetLabel(330)).toBe('UTC+5:30')
    expect(offsetLabel(-210)).toBe('UTC-3:30')
    expect(offsetLabel(0)).toBe('UTC')
  })
})

describe('shortSlotsAfter', () => {
  const slots: ScheduleSlot[] = [
    { kind: 'longform', weekday: 5, timeUtc: '15:00' },
    { kind: 'short', weekday: 3, timeUtc: '16:00' },
    { kind: 'short', weekday: 6, timeUtc: '10:00' },
  ]
  // Friday 2026-11-06 15:00 UTC.
  const friday = new Date('2026-11-06T15:00:00Z')

  it('takes the next Short slots in order, skipping long-form slots', () => {
    expect(shortSlotsAfter(friday, slots, 3).map((at) => at.toISOString())).toEqual([
      '2026-11-07T10:00:00.000Z',
      '2026-11-11T16:00:00.000Z',
      '2026-11-14T10:00:00.000Z',
    ])
  })

  it('wraps the week when the long form falls after the last slot', () => {
    const sunday = new Date('2026-11-08T12:00:00Z')
    expect(shortSlotsAfter(sunday, slots, 3).map((at) => at.toISOString())).toEqual([
      '2026-11-11T16:00:00.000Z',
      '2026-11-14T10:00:00.000Z',
      '2026-11-18T16:00:00.000Z',
    ])
  })

  it('is strictly after: a slot at the long form instant is not after it', () => {
    const atSlot = new Date('2026-11-07T10:00:00Z')
    expect(shortSlotsAfter(atSlot, slots, 1)[0]?.toISOString()).toBe('2026-11-11T16:00:00.000Z')
    const justBefore = new Date('2026-11-07T09:59:59Z')
    expect(shortSlotsAfter(justBefore, slots, 1)[0]?.toISOString()).toBe('2026-11-07T10:00:00.000Z')
  })

  it('gives nothing when there is no Short slot, or nothing was asked for', () => {
    expect(shortSlotsAfter(friday, [slots[0]!], 2)).toEqual([])
    expect(shortSlotsAfter(friday, slots, 0)).toEqual([])
  })
})
