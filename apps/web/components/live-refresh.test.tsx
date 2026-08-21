import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveRefresh } from './live-refresh'

/**
 * The pulse bargain: the 3-second loop fetches a few hundred bytes and
 * re-renders the page ONLY when the token moves — the full refresh reads
 * ~400 KB out of Postgres, which is exactly what this component must not
 * do on a timer. A failing pulse degrades to refresh-every-tick rather
 * than leaving the screen stale.
 */

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const pulseState = { value: '100', ok: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  pulseState.value = '100'
  pulseState.ok = true
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve({
        ok: pulseState.ok,
        json: () => Promise.resolve({ pulse: pulseState.value }),
      } as Response),
    ),
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LiveRefresh', () => {
  it('renders nothing and never polls while inactive', async () => {
    render(<LiveRefresh active={false} pulseUrl="/api/pulse" initialPulse="100" />)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.queryByText(/Updating automatically/)).not.toBeInTheDocument()
  })

  it('polls the pulse and does NOT refresh while it holds still', async () => {
    render(<LiveRefresh active pulseUrl="/api/pulse?project=x" initialPulse="100" />)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).toHaveBeenCalledWith('/api/pulse?project=x', { cache: 'no-store' })
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes exactly when the pulse moves', async () => {
    render(<LiveRefresh active pulseUrl="/api/pulse" initialPulse="100" />)
    await vi.advanceTimersByTimeAsync(3_100)
    expect(refresh).not.toHaveBeenCalled()

    pulseState.value = '101'
    await vi.advanceTimersByTimeAsync(3_100)
    expect(refresh).toHaveBeenCalledTimes(1)

    // The new value is the new baseline — no repeat refresh for old news.
    await vi.advanceTimersByTimeAsync(3_100)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('degrades to refresh-every-tick when the pulse endpoint fails', async () => {
    pulseState.ok = false
    render(<LiveRefresh active pulseUrl="/api/pulse" initialPulse="100" />)
    await vi.advanceTimersByTimeAsync(6_200)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('keeps the old refresh-every-tick behaviour without a pulse URL', async () => {
    render(<LiveRefresh active />)
    await vi.advanceTimersByTimeAsync(6_200)
    expect(fetch).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledTimes(2)
  })
})
