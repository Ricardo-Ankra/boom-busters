'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV, RailIcon } from '@/components/app-rail'
import { cn } from '@/lib/cn'

/**
 * The primary navigation below `md`, where the rail is hidden (decision 244).
 *
 * Until this existed a phone had no navigation at all: the rail was
 * `hidden md:flex` with nothing in its place, and the breadcrumb was plain
 * text. From a notification deep link the only way off a project was the
 * browser's back button, on the device spec section 11.4 calls first-class.
 *
 * A bottom bar rather than a hamburger, because the six destinations fit,
 * every one stays visible (section 11.1: no action lives only in a hidden
 * menu), and the thumb reaches them. Same `aria-label` as the rail: they are
 * the same landmark at two widths, and only one is ever rendered visible.
 */
export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="grid grid-cols-6">
        {NAV.map(({ href, label, icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <li key={href} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-1 text-[10px] leading-none',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)]',
                  active
                    ? 'text-[var(--color-text-primary)]'
                    : 'text-[var(--color-text-secondary)]',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-10 items-center justify-center rounded-full',
                    active && 'bg-[var(--color-surface-raised)]',
                  )}
                >
                  <RailIcon icon={icon} />
                </span>
                <span className="max-w-full truncate px-0.5">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
