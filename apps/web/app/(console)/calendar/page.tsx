import { getSettings, scheduledPublishItems } from '@boom-busters/db'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { db } from '@/lib/db'
import {
  buildWeek,
  nextPublish,
  parseWeekParam,
  weekStartUtc,
  type CalendarItemView,
} from '@/lib/calendar-view'
import { CalendarWeek } from './calendar-week'

export const metadata = { title: 'Calendar · Boom-Busters' }

/**
 * The Calendar rail page (build spec section 11.2): one week of everything
 * slotted across every project — masters and Shorts at their publish times,
 * status chips through draft→uploading→scheduled→live — plus the still-open
 * default slots from Settings → Publishing. Scheduling itself happens on each
 * project's Publish screen, where the drafts live; every item deep-links
 * there.
 */

function weekParamOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function shiftDays(date: Date, days: number): Date {
  const shifted = new Date(date)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const [{ week }, records, settings] = await Promise.all([
    searchParams,
    scheduledPublishItems(db),
    getSettings(db),
  ])

  const now = new Date()
  const weekStart = parseWeekParam(week, now)
  const thisWeek = weekStartUtc(now)

  const items: CalendarItemView[] = records.map((record) => ({
    id: record.id,
    targetType: record.targetType,
    projectId: record.projectId,
    projectTitle: record.projectTitle,
    label: record.label,
    status: record.status,
    publishAtIso: record.publishAt.toISOString(),
    youtubeVideoId: record.youtubeVideoId,
  }))

  const days = buildWeek({
    weekStart,
    items,
    slots: settings.publish.defaultScheduleSlots,
    now,
  })
  const upNext = nextPublish(items, now)

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const weekEnd = shiftDays(weekStart, 6)

  const navLink =
    'inline-flex min-h-[40px] items-center gap-1 rounded-[8px] border border-[var(--color-border-strong)] ' +
    'px-3 text-[13px] text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'

  return (
    <div className="prose-measure mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold">Calendar</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {upNext
            ? `Next publish: ${upNext.label} · ${new Date(upNext.publishAtIso).toUTCString()}`
            : 'Nothing is scheduled yet — slot an item from a project’s Publish screen.'}
        </p>
      </header>

      <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
        <Link href={`/calendar?week=${weekParamOf(shiftDays(weekStart, -7))}`} className={navLink}>
          <ChevronLeft aria-hidden className="h-4 w-4" />
          Previous week
        </Link>
        <Link href={`/calendar?week=${weekParamOf(thisWeek)}`} className={navLink}>
          This week
        </Link>
        <Link href={`/calendar?week=${weekParamOf(shiftDays(weekStart, 7))}`} className={navLink}>
          Next week
          <ChevronRight aria-hidden className="h-4 w-4" />
        </Link>
        <span className="font-mono text-[12px] text-[var(--color-text-muted)]">
          {weekParamOf(weekStart)} to {weekParamOf(weekEnd)} · slots stored UTC, times shown local
        </span>
      </nav>

      <CalendarWeek days={days} todayIso={today.toISOString()} />
    </div>
  )
}
