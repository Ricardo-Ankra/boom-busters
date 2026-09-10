'use client'

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LABELS: Record<string, string> = {
  '': 'Dashboard',
  projects: 'Projects',
  cases: 'Case Library',
  calendar: 'Calendar',
  costs: 'Costs',
  settings: 'Settings',
}

/** A project id in the URL. The h1 below carries the title; the crumb need not. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * Where you are, and a way back up (decision 244). Every ancestor is a link:
 * a breadcrumb landmark that contained nothing but spans had no destinations,
 * and on a phone, where the rail is hidden, it was the only wayfinding on
 * screen.
 */
export function Breadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const trail = segments.length === 0 ? [''] : segments

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-[14px]">
        {trail.map((segment, index) => {
          const last = index === trail.length - 1
          const label = LABELS[segment] ?? (ULID.test(segment) ? 'Project' : segment)
          const href = `/${trail.slice(0, index + 1).join('/')}` as Route
          return (
            <li key={`${segment}-${index}`} className="flex min-w-0 items-center gap-2">
              {index > 0 ? (
                <span aria-hidden className="text-[var(--color-text-muted)]">
                  /
                </span>
              ) : null}
              {last ? (
                <span
                  aria-current="page"
                  className="truncate font-medium text-[var(--color-text-primary)]"
                >
                  {label}
                </span>
              ) : (
                <Link
                  href={href}
                  className="inline-flex min-h-10 items-center truncate text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                >
                  {label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
