'use client'

import {
  Calendar,
  DollarSign,
  LayoutDashboard,
  Library,
  Loader2,
  Settings,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import Link, { useLinkStatus } from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { channelHref } from '@/lib/channel-href'
import type { ChannelSection } from '@/lib/channel-href'
import { cn } from '@/lib/cn'

/**
 * Left rail (build spec section 11.2): icons + labels, expandable. Labels are
 * always present in the accessibility tree even when the rail is collapsed —
 * "no action may exist only as an icon" (section 11.1).
 */

/**
 * The clicked item's icon becomes a spinner while its navigation is pending
 * (decision 241). Screens query everything server-side before they paint, so
 * a click on the rail used to give no feedback for exactly the seconds the
 * app was busiest. Scoped to the link rather than a route `loading.tsx`
 * because a Suspense boundary makes every route stream in two chunks, and
 * the transient hidden copy of the page turned strict text locators across
 * the whole E2E suite into a race (found by that suite, twice).
 */
export function RailIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { pending } = useLinkStatus()
  return pending ? (
    <Loader2
      className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
      aria-hidden
      data-testid="rail-pending"
    />
  ) : (
    <Icon className="size-4 shrink-0" aria-hidden />
  )
}

/** The information architecture (section 11.2); shared with the mobile bar. */
const NAV_ITEMS: readonly { section: ChannelSection; label: string; icon: LucideIcon }[] = [
  { section: '', label: 'Dashboard', icon: LayoutDashboard },
  { section: '/projects', label: 'Projects', icon: Video },
  { section: '/cases', label: 'Case Library', icon: Library },
  { section: '/calendar', label: 'Calendar', icon: Calendar },
  { section: '/costs', label: 'Costs', icon: DollarSign },
  { section: '/settings', label: 'Settings', icon: Settings },
]

/** The navigation items as hrefs into one channel, with the current one marked. */
export function navFor(slug: string, pathname: string) {
  return NAV_ITEMS.map(({ section, label, icon }) => {
    const href = channelHref(slug, section)
    // A project page lives at /projects/<id>, outside the channel path; it
    // belongs to the Projects section.
    const active =
      section === ''
        ? pathname === href
        : pathname.startsWith(href) ||
          (section === '/projects' && pathname.startsWith('/projects/'))
    return { href, label, icon, active }
  })
}

export function AppRail({ slug, name }: { slug: string; name: string }) {
  const pathname = usePathname()
  const [expanded, setExpanded] = React.useState(true)

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-2',
        expanded ? 'w-56' : 'w-16',
      )}
    >
      <div className="mb-2 flex h-10 items-center px-2">
        {expanded ? (
          <span className="truncate text-[14px] font-semibold tracking-tight">{name}</span>
        ) : null}
      </div>

      {navFor(slug, pathname).map(({ href, label, icon: Icon, active }) => {
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 items-center gap-3 rounded-[8px] px-3 text-[14px]',
              'transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
              active
                ? 'bg-[var(--color-surface-raised)] font-medium text-[var(--color-text-primary)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
            )}
          >
            <RailIcon icon={Icon} />
            <span className={cn(expanded ? '' : 'sr-only')}>{label}</span>
          </Link>
        )
      })}

      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className={cn(
          'mt-auto flex h-10 items-center gap-3 rounded-[8px] px-3 text-[13px]',
          'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
        )}
      >
        {expanded ? 'Collapse rail' : <span className="sr-only">Expand rail</span>}
        {expanded ? null : <span aria-hidden>»</span>}
      </button>
    </nav>
  )
}
