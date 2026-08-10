import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppRail } from './app-rail'

vi.mock('next/navigation', () => ({ usePathname: () => '/settings' }))

describe('AppRail', () => {
  it('links to every screen in the information architecture', () => {
    render(<AppRail />)

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
    render(<AppRail />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })

  it('keeps every label readable when collapsed — icons are never the only cue', async () => {
    render(<AppRail />)

    await userEvent.click(screen.getByRole('button', { name: 'Collapse rail' }))

    // Labels move to sr-only rather than disappearing, so the links keep names.
    for (const label of ['Dashboard', 'Projects', 'Settings']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('exposes the collapse state', async () => {
    render(<AppRail />)
    const toggle = screen.getByRole('button', { name: 'Collapse rail' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Expand rail' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
