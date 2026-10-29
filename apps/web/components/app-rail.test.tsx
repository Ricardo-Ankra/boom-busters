import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppRail, navFor } from './app-rail'
import type { SwitcherEntry } from './channel-switcher'

vi.mock('next/navigation', () => ({ usePathname: () => '/c/psychology/settings' }))

const channels: SwitcherEntry[] = [
  { id: '01A', slug: 'boom-busters', name: 'Boom & Busters', needsYou: 0 },
  { id: '01B', slug: 'psychology', name: 'Psychology', needsYou: 2 },
]

describe('AppRail channel switcher', () => {
  it('opens the channel list from the rail header and keeps the section you are on', async () => {
    render(<AppRail slug="psychology" channels={channels} />)

    const trigger = screen.getByRole('button', { name: /Psychology/ })
    expect(trigger.className).toContain('h-10')
    await userEvent.click(trigger)

    const list = screen.getByRole('list', { name: 'Channels' })
    expect(within(list).getByRole('link', { name: /Boom & Busters/ })).toHaveAttribute(
      'href',
      '/c/boom-busters/settings',
    )
  })

  it('shrinks to the channel initials when the rail is collapsed, still naming the channel', async () => {
    render(<AppRail slug="boom-busters" channels={channels} />)
    await userEvent.click(screen.getByRole('button', { name: 'Collapse rail' }))

    const trigger = screen.getByRole('button', { name: /Boom & Busters/ })
    expect(trigger.className).toContain('h-10')
    expect(trigger).toHaveTextContent('BB')

    await userEvent.click(trigger)
    expect(screen.getByRole('list', { name: 'Channels' })).toBeInTheDocument()
  })
})

describe('navFor', () => {
  it('marks Projects current on a project page, which lives outside /c/<slug>', () => {
    const items = navFor('psychology', '/projects/01HQ0000000000000000000PR1')
    expect(items.filter((item) => item.active).map((item) => item.label)).toEqual(['Projects'])
    expect(items.find((item) => item.label === 'Projects')?.href).toBe('/c/psychology/projects')
  })
})

describe('AppRail', () => {
  it('links to every screen in the information architecture', () => {
    render(<AppRail slug="psychology" channels={channels} />)

    for (const label of [
      'Dashboard',
      'Projects',
      'Case Library',
      'Calendar',
      'Costs',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('marks the current screen for assistive technology, not only by colour', () => {
    render(<AppRail slug="psychology" channels={channels} />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('keeps every label readable when collapsed — icons are never the only cue', async () => {
    render(<AppRail slug="psychology" channels={channels} />)

    await userEvent.click(screen.getByRole('button', { name: 'Collapse rail' }))

    // Labels move to sr-only rather than disappearing, so the links keep names.
    for (const label of ['Dashboard', 'Projects', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('links the workspace settings from under Settings, as a 40 px target', () => {
    render(<AppRail slug="psychology" channels={channels} />)
    const link = screen.getByRole('link', { name: 'Workspace' })
    expect(link).toHaveAttribute('href', '/settings')
    expect(link.className).toContain('h-10')
  })

  it('exposes the collapse state', async () => {
    render(<AppRail slug="psychology" channels={channels} />)
    const toggle = screen.getByRole('button', { name: 'Collapse rail' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Expand rail' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
