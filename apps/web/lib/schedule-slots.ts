import type { ScheduleSlot } from '@boom-busters/schemas'

/**
 * The maths behind editing the default schedule slots in the owner's own
 * timezone. Slots stay stored as a UTC weekday plus a UTC wall time (the
 * publish screen and the Calendar materialise them that way), so the editor
 * converts in both directions through minutes-of-the-week. Pure: the offset
 * comes in as an argument, so tests never depend on the machine's timezone.
 *
 * The offset is the one in force today. A timezone with daylight saving moves
 * its slots by an hour across the change, the same as any UTC-stored time.
 */

const MINUTES_PER_DAY = 24 * 60
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY

/** Minutes east of UTC right now: +120 in Johannesburg. */
export function currentOffsetMinutes(now: Date = new Date()): number {
  // getTimezoneOffset is minutes WEST of UTC; the sign flip reads naturally.
  return -now.getTimezoneOffset()
}

function toMinutes(weekday: number, time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return weekday * MINUTES_PER_DAY + (hours ?? 0) * 60 + (minutes ?? 0)
}

function fromMinutes(total: number): { weekday: number; time: string } {
  const wrapped = ((total % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK
  const weekday = Math.floor(wrapped / MINUTES_PER_DAY)
  const ofDay = wrapped % MINUTES_PER_DAY
  const hours = String(Math.floor(ofDay / 60)).padStart(2, '0')
  const minutes = String(ofDay % 60).padStart(2, '0')
  return { weekday, time: `${hours}:${minutes}` }
}

/** A stored slot as the owner sees it: weekday and HH:MM in their timezone. */
export function slotToLocal(
  slot: ScheduleSlot,
  offsetMinutes: number,
): { weekday: number; time: string } {
  return fromMinutes(toMinutes(slot.weekday, slot.timeUtc) + offsetMinutes)
}

/** The stored form of a weekday and HH:MM the owner picked in their timezone. */
export function slotFromLocal(
  kind: ScheduleSlot['kind'],
  weekday: number,
  time: string,
  offsetMinutes: number,
): ScheduleSlot {
  const utc = fromMinutes(toMinutes(weekday, time) - offsetMinutes)
  return { kind, weekday: utc.weekday, timeUtc: utc.time }
}

/**
 * Whether another slot already sits at the same UTC moment of the week. The
 * publish screen keys its slot buttons by instant, so two slots at one time,
 * even of different formats, would collide there.
 */
export function clashes(slots: readonly ScheduleSlot[], candidate: ScheduleSlot, ignoreIndex = -1) {
  return slots.some(
    (slot, index) =>
      index !== ignoreIndex &&
      slot.weekday === candidate.weekday &&
      slot.timeUtc === candidate.timeUtc,
  )
}

/** The channel's starting times for a new slot of each format (UTC). */
const STARTING_POINT: Record<ScheduleSlot['kind'], { weekday: number; timeUtc: string }> = {
  longform: { weekday: 5, timeUtc: '15:00' },
  short: { weekday: 3, timeUtc: '16:00' },
}

/**
 * Where a newly added slot lands: the format's usual time, on the first day
 * from its usual day onwards that is free at that time, then an hour later
 * if the whole week is taken. Null only when every hour of the week is full,
 * which the 21-slot cap rules out long before.
 */
export function nextFreeSlot(
  kind: ScheduleSlot['kind'],
  slots: readonly ScheduleSlot[],
): ScheduleSlot | null {
  const start = STARTING_POINT[kind]
  const base = toMinutes(start.weekday, start.timeUtc)
  for (let hour = 0; hour < 24; hour++) {
    for (let day = 0; day < 7; day++) {
      const at = fromMinutes(base + day * MINUTES_PER_DAY + hour * 60)
      const candidate = { kind, weekday: at.weekday, timeUtc: at.time }
      if (!clashes(slots, candidate)) return candidate
    }
  }
  return null
}

/** "UTC+2", "UTC-3:30", "UTC" — the label beside the editor's times. */
export function offsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'UTC'
  const sign = offsetMinutes > 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const hours = Math.floor(absolute / 60)
  const minutes = absolute % 60
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`
}
