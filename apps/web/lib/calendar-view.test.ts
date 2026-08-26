import { describe, expect, it } from 'vitest'
import type { ScheduleSlot } from '@boom-busters/schemas'
import {
  buildWeek,
  nextPublish,
  parseWeekParam,
  weekStartUtc,
  type CalendarItemView,
} from './calendar-view'

/**
 * The Calendar page's arithmetic. Weeks are Monday-anchored UTC; open slots
 * are the settings defaults minus the past and minus anything already sitting
 * on them.
 */

const item = (overrides: Partial<CalendarItemView>): CalendarItemView => ({
  id: 'rec-1',
  targetType: 'master',
  projectId: '01HQ00000000000000000000P1',
  projectTitle: 'Wirecard',
  label: 'Wirecard',
  status: 'scheduled',
  publishAtIso: '2026-08-28T15:00:00.000Z',
  youtubeVideoId: null,
  ...overrides,
})

// Friday 15:00 long-form, Saturday 09:00 Short — the spec's own example.
const SLOTS: ScheduleSlot[] = [
  { kind: 'longform', weekday: 5, timeUtc: '15:00' },
  { kind: 'short', weekday: 6, timeUtc: '09:00' },
]

describe('weekStartUtc', () => {
  it('anchors any day of the week to its Monday, including Sunday', () => {
    // 2026-08-26 is a Wednesday; 2026-08-30 a Sunday. Same week, same Monday.
    expect(weekStartUtc(new Date('2026-08-26T13:45:00Z')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    )
    expect(weekStartUtc(new Date('2026-08-30T23:59:59Z')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    )
    expect(weekStartUtc(new Date('2026-08-24T00:00:00Z')).toISOString()).toBe(
      '2026-08-24T00:00:00.000Z',
    )
  })
})

describe('parseWeekParam', () => {
  it('accepts a YYYY-MM-DD anchor and falls back to this week on junk', () => {
    const now = new Date('2026-08-26T10:00:00Z')
    expect(parseWeekParam('2026-09-03', now).toISOString()).toBe('2026-08-31T00:00:00.000Z')
    for (const junk of [undefined, 'next', '2026-13-99', '<script>']) {
      expect(parseWeekParam(junk, now).toISOString()).toBe('2026-08-24T00:00:00.000Z')
    }
  })
})

describe('buildWeek', () => {
  const now = new Date('2026-08-26T10:00:00Z')
  const weekStart = weekStartUtc(now)

  it('always yields seven days, items on their UTC day, in time order', () => {
    const days = buildWeek({
      weekStart,
      items: [
        item({ id: 'b', publishAtIso: '2026-08-28T15:00:00.000Z' }),
        item({ id: 'a', publishAtIso: '2026-08-28T09:00:00.000Z', targetType: 'short' }),
        // Outside the shown week: present in the data, absent from the view.
        item({ id: 'c', publishAtIso: '2026-09-04T15:00:00.000Z' }),
      ],
      slots: [],
      now,
    })

    expect(days).toHaveLength(7)
    const friday = days[4]!
    expect(friday.items.map((entry) => entry.id)).toEqual(['a', 'b'])
    expect(days.flatMap((day) => day.items)).toHaveLength(2)
  })

  it('offers open slots only in the future, and never under a slotted item', () => {
    const days = buildWeek({
      weekStart,
      items: [item({ publishAtIso: '2026-08-28T15:00:00.000Z' })],
      slots: SLOTS,
      now,
    })

    // Friday's 15:00 long-form slot is taken by the scheduled master…
    expect(days[4]!.openSlots).toEqual([])
    // …Saturday's Short slot is still open.
    expect(days[5]!.openSlots).toEqual([{ iso: '2026-08-29T09:00:00.000Z', kind: 'short' }])
  })

  it('a slot earlier in the current week is gone, not open', () => {
    // `now` is Wednesday; a Monday slot this week must not be offered.
    const days = buildWeek({
      weekStart,
      items: [],
      slots: [{ kind: 'short', weekday: 1, timeUtc: '09:00' }],
      now,
    })
    expect(days[0]!.openSlots).toEqual([])
  })
})

describe('nextPublish', () => {
  it('names the soonest future item, skipping failures and the past', () => {
    const now = new Date('2026-08-26T10:00:00Z')
    const next = nextPublish(
      [
        item({ id: 'past', publishAtIso: '2026-08-20T15:00:00.000Z', status: 'live' }),
        item({ id: 'failed', publishAtIso: '2026-08-27T15:00:00.000Z', status: 'failed' }),
        item({ id: 'soonest', publishAtIso: '2026-08-28T15:00:00.000Z' }),
        item({ id: 'later', publishAtIso: '2026-09-04T15:00:00.000Z' }),
      ],
      now,
    )
    expect(next?.id).toBe('soonest')
  })
})
