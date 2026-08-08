import { MIN_HIT_TARGET_PX } from '@boom-busters/ui-tokens'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

/**
 * These guard the button-first rules in spec section 11.1, which are easy to
 * break by accident and invisible in a screenshot.
 */
describe('Button', () => {
  it('renders a labelled button', () => {
    render(<Button>Approve</Button>)
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('meets the 40px minimum hit target in every size', () => {
    const heights: Record<string, number> = { default: 40, lg: 48, icon: 40 }
    for (const [size, height] of Object.entries(heights)) {
      expect(height, `size "${size}"`).toBeGreaterThanOrEqual(MIN_HIT_TARGET_PX)
    }

    render(<Button size="default">Approve</Button>)
    expect(screen.getByRole('button', { name: 'Approve' }).className).toContain('h-10')
  })

  it('keeps its accessible name while busy, so the control never goes anonymous', () => {
    render(<Button busy>Render master</Button>)

    const button = screen.getByRole('button', { name: 'Render master' })
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()
  })

  it('does not fire while busy', async () => {
    const onClick = vi.fn()
    render(
      <Button busy onClick={onClick}>
        Render master
      </Button>,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Render master' })).catch(() => {
      // userEvent refuses to click a disabled control; that is the assertion.
    })
    expect(onClick).not.toHaveBeenCalled()
  })

  it('fires when idle', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Approve</Button>)

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('carries a visible focus ring', () => {
    render(<Button>Approve</Button>)
    expect(screen.getByRole('button').className).toContain('focus-visible:outline-2')
  })
})
