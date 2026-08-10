'use client'

import { Calendar, DollarSign, LayoutDashboard, Library, Settings, Video } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { cn } from '@/lib/cn'

/**
 * Left rail (build spec section 11.2): icons + labels, expandable. Labels are
 * always present in the accessibility tree even when the rail is collapsed —
 * "no action may exist only as an icon" (section 11.1).
 */

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: Video },
  { href: '/cases', label: 'Case Library', icon: Library },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/costs', label: 'Costs', icon: DollarSign },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const

export function AppRail() {
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
          <span className="text-[14px] font-semibold tracking-tight">Boom-Busters</span>
        ) : null}
      </div>

      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
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
            <Icon className="size-4 shrink-0" aria-hidden />
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
