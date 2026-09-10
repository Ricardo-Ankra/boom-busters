'use client'

import { CalendarClock, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { CalendarDay } from '@/lib/calendar-view'
import {
  PUBLISH_STATUS_LABELS,
  PUBLISH_STATUS_TONES,
  publishStatusInFlight,
} from '@/lib/publish-status'

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

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function KindBadge({ kind }: { kind: 'longform' | 'short' }) {
  return <Badge shape="tag">{kind === 'longform' ? 'long-form' : 'short'}</Badge>
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
                <span className="text-[11px] font-normal text-[var(--color-accent-text)]">
                  Today
                </span>
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
                    <Badge tone={PUBLISH_STATUS_TONES[item.status]}>
                      {publishStatusInFlight(item.status) ? (
                        <Loader2 aria-hidden className="animate-spin" />
                      ) : null}
                      {PUBLISH_STATUS_LABELS[item.status]}
                    </Badge>
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
