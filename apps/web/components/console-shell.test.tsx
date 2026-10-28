import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConsoleShell } from './console-shell'

vi.mock('next/navigation', () => ({
  usePathname: () => '/c/psychology/projects',
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/auth', () => ({ signOut: vi.fn() }))

const channel = { id: '01B', slug: 'psychology', name: 'Psychology', archivedAt: null }
const channels = [
  { id: '01A', slug: 'boom-busters', name: 'Boom-Busters', needsYou: 0 },
  { id: '01B', slug: 'psychology', name: 'Psychology', needsYou: 2 },
]

function renderShell() {
  return render(
    <ConsoleShell
      channel={channel}
      channels={channels}
      monthSpendUsd={12}
      ceilingUsd={100}
      activeRuns={[]}
      activity={[]}
    >
      <p>page body</p>
    </ConsoleShell>,
  )
}

describe('ConsoleShell', () => {
  it('names the channel in the rail and builds every rail link under /c/<slug>', () => {
    renderShell()

    const rails = screen.getAllByRole('navigation', { name: 'Primary' })
    const rail = rails[0]!
    expect(within(rail).getByText('Psychology')).toBeInTheDocument()
    expect(within(rail).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'href',
      '/c/psychology',
    )
    expect(within(rail).getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'href',
      '/c/psychology/projects',
    )
    expect(within(rail).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/c/psychology/settings',
    )
    expect(within(rail).getByRole('link', { name: 'Projects' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(rail).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('puts the Channel switcher in the top bar, labelled with the current channel', () => {
    renderShell()
    const switcher = screen.getByRole('button', { name: /Psychology/ })
    expect(switcher.className).toContain('h-10')
  })

  it('renders the page inside main', () => {
    renderShell()
    expect(within(screen.getByRole('main')).getByText('page body')).toBeInTheDocument()
  })
})
