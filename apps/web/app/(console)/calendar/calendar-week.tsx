'use client'

import { CalendarClock, Loader2 } from 'lucide-react'
import Link from 'next/link'
import type { CalendarDay, CalendarItemView } from '@/lib/calendar-view'

/**
 * One week of the global calendar (build spec section 11.2): every slotted
 * publish across every project, plus the open default slots from Settings.
 *
 * Scheduling itself stays on each project's Publish screen — that is where
 * the drafts, thumbnails and description live — so every item here deep-links
 * straight to it. Times are stored UTC and RENDERED local, which is why this
 * is a client component; the `suppressHydrationWarning`s cover the server
 * rendering the same instants in UTC.
 */

const STATUS_STYLE: Record<CalendarItemView['status'], string> = {
  draft: 'border-[var(--color-border)] text-[var(--color-text-secondary)]',
  uploading: 'border-[var(--color-warning)] text-[var(--color-warning)]',
  uploaded: 'border-[var(--color-warning)] text-[var(--color-warning)]',
  scheduled: 'border-[var(--color-success)] text-[var(--color-success)]',
  live: 'border-[var(--color-success)] text-[var(--color-success)]',
  failed: 'border-[var(--color-danger)] text-[var(--color-danger)]',
}

const STATUS_LABEL: Record<CalendarItemView['status'], string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  uploaded: 'Uploaded — finishing',
  scheduled: 'Scheduled',
  live: 'Live',
  failed: 'Failed',
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function KindBadge({ kind }: { kind: 'longform' | 'short' }) {
  return (
    <span className="rounded-[4px] bg-[var(--color-background)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)] uppercase">
      {kind === 'longform' ? 'long-form' : 'short'}
    </span>
  )
}

export function CalendarWeek({ days, todayIso }: { days: CalendarDay[]; todayIso: string }) {
  return (
    <div className="flex flex-col gap-3">
      {days.map((day) => {
        const isToday = day.dayIso === todayIso
        const empty = day.items.length === 0 && day.openSlots.length === 0
        return (
          <section
            key={day.dayIso}
            aria-label={new Date(day.dayIso).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
            className={`rounded-[8px] border p-3 ${
              isToday ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)]'
            }`}
          >
            <h2
              className="mb-2 flex items-baseline gap-2 text-[14px] font-semibold"
              suppressHydrationWarning
            >
              {new Date(day.dayIso).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'short',
              })}
              {isToday ? (
                <span className="text-[11px] font-normal text-[var(--color-accent)]">Today</span>
              ) : null}
            </h2>

            {empty ? (
              <p className="text-[13px] text-[var(--color-text-muted)]">Nothing this day.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {day.items.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span
                      className="font-mono text-[12px] text-[var(--color-text-secondary)] tabular-nums"
                      suppressHydrationWarning
                    >
                      {localTime(item.publishAtIso)}
                    </span>
                    <KindBadge kind={item.targetType === 'master' ? 'longform' : 'short'} />
                    <span className="min-w-0 text-[var(--color-text-primary)]">{item.label}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLE[item.status]}`}
                    >
                      {item.status === 'uploading' || item.status === 'uploaded' ? (
                        <Loader2 aria-hidden className="mr-1 inline h-3 w-3 animate-spin" />
                      ) : null}
                      {STATUS_LABEL[item.status]}
                    </span>
                    {/* Padded to the 40px hit target the sweep enforces. */}
                    <Link
                      href={`/projects/${item.projectId}?stage=publish`}
                      className="inline-flex min-h-[40px] items-center px-1 text-[13px] underline hover:text-[var(--color-text-secondary)]"
                    >
                      {item.projectTitle} →
                    </Link>
                  </li>
                ))}

                {day.openSlots.map((slot) => (
                  <li
                    key={slot.iso}
                    className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--color-text-muted)]"
                  >
                    <span className="font-mono text-[12px] tabular-nums" suppressHydrationWarning>
                      {localTime(slot.iso)}
                    </span>
                    <KindBadge kind={slot.kind} />
                    <CalendarClock aria-hidden className="h-3.5 w-3.5" />
                    <span>Open slot — schedule from a project&apos;s Publish screen</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
