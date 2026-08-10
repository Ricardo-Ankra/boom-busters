'use client'

import { usePathname } from 'next/navigation'

const LABELS: Record<string, string> = {
  '': 'Dashboard',
  projects: 'Projects',
  cases: 'Case Library',
  calendar: 'Calendar',
  costs: 'Costs',
  settings: 'Settings',
}

export function Breadcrumb() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  const trail = segments.length === 0 ? [''] : segments

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-2 text-[14px]">
        {trail.map((segment, index) => (
          <li key={`${segment}-${index}`} className="flex items-center gap-2">
            {index > 0 ? (
              <span aria-hidden className="text-[var(--color-text-muted)]">
                /
              </span>
            ) : null}
            <span
              className={
                index === trail.length - 1
                  ? 'truncate font-medium text-[var(--color-text-primary)]'
                  : 'truncate text-[var(--color-text-secondary)]'
              }
            >
              {LABELS[segment] ?? segment}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  )
}
