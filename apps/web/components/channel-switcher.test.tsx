import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ChannelSwitcher, channelInitials } from './channel-switcher'
import type { SwitcherEntry } from './channel-switcher'

const channels: SwitcherEntry[] = [
  { id: '01A', slug: 'boom-busters', name: 'Boom-Busters', needsYou: 0 },
  { id: '01B', slug: 'psychology', name: 'Psychology', needsYou: 3 },
]

describe('ChannelSwitcher compact variant', () => {
  it('shows the initials and keeps the full channel name for assistive technology', () => {
    render(
      <ChannelSwitcher
        current="boom-busters"
        channels={[{ id: '01A', slug: 'boom-busters', name: 'Boom & Busters', needsYou: 0 }]}
        section=""
        variant="compact"
      />,
    )
    const trigger = screen.getByRole('button', { name: /Boom & Busters/ })
    expect(trigger).toHaveTextContent('BB')
    expect(trigger.className).toContain('h-10')
  })
})

describe('channelInitials', () => {
  it('takes the first letter of the first two words, skipping symbols', () => {
    expect(channelInitials('Boom & Busters')).toBe('BB')
    expect(channelInitials('Psychology')).toBe('P')
    expect(channelInitials('the mind lab')).toBe('TM')
  })
})

describe('ChannelSwitcher', () => {
  it('is a labelled button with the 40px hit target, closed until pressed', () => {
    render(<ChannelSwitcher current="psychology" channels={channels} section="/projects" />)

    const trigger = screen.getByRole('button', { name: /Psychology/ })
    expect(trigger.className).toContain('h-10')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: /Boom-Busters/ })).not.toBeInTheDocument()
  })

  it('lists every channel with its needs-you count, marks the current one and ends on New channel', async () => {
    render(<ChannelSwitcher current="psychology" channels={channels} section="/projects" />)
    await userEvent.click(screen.getByRole('button', { name: /Psychology/ }))

    const list = screen.getByRole('list')
    const links = within(list).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual([
      'Boom-Busters0',
      'Psychology3',
      'New channel',
    ])

    expect(links[0]).toHaveAttribute('href', '/c/boom-busters/projects')
    expect(links[1]).toHaveAttribute('href', '/c/psychology/projects')
    expect(links[1]).toHaveAttribute('aria-current', 'true')
    expect(links[0]).not.toHaveAttribute('aria-current')
    expect(links[2]).toHaveAttribute('href', '/c/psychology/settings?tab=channel&new=1')
    for (const link of links) expect(link.className).toContain('h-10')
  })

  it('keeps the section when switching, and lands on the dashboard from a project page', async () => {
    render(<ChannelSwitcher current="psychology" channels={channels} section="" />)
    await userEvent.click(screen.getByRole('button', { name: /Psychology/ }))
    expect(screen.getByRole('link', { name: /Boom-Busters/ })).toHaveAttribute(
      'href',
      '/c/boom-busters',
    )
  })
})
