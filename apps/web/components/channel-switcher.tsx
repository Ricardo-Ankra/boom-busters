'use client'

import { Check, ChevronsUpDown } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { channelHref, slugFromPath } from '@/lib/channel-href'
import type { ChannelSection } from '@/lib/channel-href'
import { cn } from '@/lib/cn'

export interface SwitcherEntry {
  id: string
  slug: string
  name: string
  /** Items waiting on the owner in that channel. */
  needsYou: number
}

const SECTIONS: readonly ChannelSection[] = [
  '/projects',
  '/cases',
  '/calendar',
  '/costs',
  '/settings',
]

/** The section of a console path: `/c/psychology/costs` is `/costs`; a project page is the dashboard. */
export function sectionFromPath(pathname: string): ChannelSection {
  const slug = slugFromPath(pathname)
  if (!slug) return ''
  const rest = pathname.slice(`/c/${slug}`.length)
  return SECTIONS.find((section) => rest === section || rest.startsWith(`${section}/`)) ?? ''
}

const itemClass = cn(
  'flex h-10 items-center justify-between gap-3 rounded-[8px] px-3 text-[14px]',
  'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-raised)] hover:text-[var(--color-text-primary)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
)

/** "Boom & Busters" reads BB, "Psychology" reads P: the first letter of the first two words. */
export function channelInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

/**
 * Where the switcher sits. `rail`: the full-width rail header on a desktop.
 * `compact`: the collapsed rail, the channel's initials with its name kept
 * for assistive technology. `bar`: the top bar on a phone, where the rail is
 * hidden.
 */
export type SwitcherVariant = 'rail' | 'compact' | 'bar'

/**
 * The Channel switcher: a 40 px button labelled with the current channel that
 * opens a list of every channel, each with what is waiting on the owner there.
 * Switching keeps the section you are on; the foot starts a new channel.
 */
export function ChannelSwitcher({
  current,
  channels,
  section,
  variant = 'bar',
}: {
  current: string
  channels: SwitcherEntry[]
  section: ChannelSection
  variant?: SwitcherVariant
}) {
  const [open, setOpen] = React.useState(false)
  const currentName = channels.find((entry) => entry.slug === current)?.name ?? current

  return (
    <div className={cn('relative', variant === 'rail' && 'w-full')}>
      <Button
        type="button"
        variant="outline"
        size={variant === 'compact' ? 'icon' : 'default'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          variant === 'rail' && 'w-full justify-between text-[14px] font-semibold',
          variant === 'compact' && 'w-10 justify-center font-semibold',
        )}
      >
        {variant === 'compact' ? (
          <>
            <span aria-hidden>{channelInitials(currentName)}</span>
            <span className="sr-only">{currentName}</span>
          </>
        ) : (
          <>
            <span
              className={cn(
                'truncate',
                variant === 'rail' ? 'min-w-0 flex-1 text-left' : 'max-w-[16ch]',
              )}
            >
              {currentName}
            </span>
            <ChevronsUpDown aria-hidden />
          </>
        )}
      </Button>

      {open ? (
        <ul
          aria-label="Channels"
          className={cn(
            'absolute z-40 flex min-w-56 flex-col gap-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg',
            variant === 'compact' ? 'top-0 left-full ml-2' : 'top-full left-0 mt-1',
          )}
        >
          {channels.map((entry) => {
            const isCurrent = entry.slug === current
            return (
              <li key={entry.id}>
                <Link
                  href={channelHref(entry.slug, section)}
                  aria-current={isCurrent ? 'true' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(itemClass, isCurrent && 'bg-[var(--color-surface-raised)]')}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {isCurrent ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="font-mono text-[12px] text-[var(--color-text-muted)]">
                    {entry.needsYou}
                  </span>
                </Link>
              </li>
            )
          })}
          <li className="border-t border-[var(--color-border)] pt-1">
            <Link
              href={channelHref(current, '/settings', { tab: 'channel', new: '1' })}
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              New channel
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  )
}

/** The switcher as the rail and the top bar use it: the section comes from the URL. */
export function RouteChannelSwitcher(props: {
  current: string
  channels: SwitcherEntry[]
  variant?: SwitcherVariant
}) {
  return <ChannelSwitcher {...props} section={sectionFromPath(usePathname())} />
}
