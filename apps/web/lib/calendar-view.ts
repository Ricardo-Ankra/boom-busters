import type { ScheduleSlot } from '@boom-busters/schemas'

/**
 * The Calendar rail page's view maths (build spec section 11.2): one week of
 * UTC days carrying everything slotted across EVERY project, plus the still
 * open default slots from Settings → Publishing. Pure and shared with tests;
 * the page reads the database, this file only arranges.
 *
 * Days are UTC days, deliberately — the same convention the per-project
 * publish calendar established (slots are stored in UTC; only labels are
 * local), so the two calendars can never disagree about which day a slot
 * belongs to.
 */

export interface CalendarItemView {
  id: string
  targetType: 'master' | 'short'
  projectId: string
  projectTitle: string
  label: string
  status: 'draft' | 'uploading' | 'uploaded' | 'scheduled' | 'live' | 'failed'
  publishAtIso: string
  youtubeVideoId: string | null
}

export interface CalendarDay {
  /** UTC midnight of the day, ISO. */
  dayIso: string
  items: CalendarItemView[]
  /** Default slots on this day that are still in the future and unclaimed. */
  openSlots: { iso: string; kind: 'longform' | 'short' }[]
}

/** Monday 00:00 UTC of the week the anchor falls in. */
export function weekStartUtc(anchor: Date): Date {
  const day = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()))
  const sinceMonday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - sinceMonday)
  return day
}

/** The `?week=` anchor, `YYYY-MM-DD`; anything else means "this week". */
export function parseWeekParam(value: string | undefined, now: Date): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    if (!Number.isNaN(parsed.getTime())) return weekStartUtc(parsed)
  }
  return weekStartUtc(now)
}

export function buildWeek(input: {
  weekStart: Date
  items: CalendarItemView[]
  slots: ScheduleSlot[]
  now: Date
}): CalendarDay[] {
  const taken = new Set(input.items.map((item) => item.publishAtIso))
  const days: CalendarDay[] = []

  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(input.weekStart)
    day.setUTCDate(day.getUTCDate() + offset)
    const dayIso = day.toISOString()
    const next = new Date(day)
    next.setUTCDate(next.getUTCDate() + 1)

    const items = input.items
      .filter((item) => item.publishAtIso >= dayIso && item.publishAtIso < next.toISOString())
      .sort((a, b) => a.publishAtIso.localeCompare(b.publishAtIso))

    const openSlots: CalendarDay['openSlots'] = []
    for (const slot of input.slots) {
      if (slot.weekday !== day.getUTCDay()) continue
      const [hours, minutes] = slot.timeUtc.split(':').map(Number)
      const at = new Date(day)
      at.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0)
      const iso = at.toISOString()
      // A slot in the past is gone, and a slot something sits on is not open.
      if (at.getTime() <= input.now.getTime() || taken.has(iso)) continue
      openSlots.push({ iso, kind: slot.kind })
    }
    openSlots.sort((a, b) => a.iso.localeCompare(b.iso))

    days.push({ dayIso, items, openSlots })
  }
  return days
}

/** The first slotted item still ahead of now — the header's one-liner. */
export function nextPublish(items: CalendarItemView[], now: Date): CalendarItemView | undefined {
  return items
    .filter((item) => item.publishAtIso > now.toISOString() && item.status !== 'failed')
    .sort((a, b) => a.publishAtIso.localeCompare(b.publishAtIso))[0]
}
