'use client'

import { useRouter } from 'next/navigation'
import * as React from 'react'

/**
 * Keep a server-rendered pipeline screen in step with a run that is still
 * moving.
 *
 * Approving a gate does not change anything the page can see. The action sends
 * an event and returns; Inngest then delivers it, the parked run resumes,
 * closes the gate, does its work and opens the next one — seconds later, in
 * another process. A `router.refresh()` at the moment the button returns
 * therefore re-renders exactly the state that was already on screen, and the
 * screen sits there looking broken until you navigate away and back.
 *
 * So while a run is in flight the screen polls — but it polls the PULSE, an
 * opaque change token a few hundred bytes long, and re-renders only when the
 * token moves. The refresh itself re-reads ~400 KB out of Postgres per tick
 * (timeline JSON, takes, slot candidates), and a 3-second loop of that was
 * most of a month's Neon transfer allowance (measured 2026-08-21). A pulse
 * fetch that fails degrades to the old refresh-every-tick bargain rather
 * than leaving the screen stale.
 *
 * It stops as soon as nothing is running, and pauses while the tab is hidden —
 * a console left open on a second monitor overnight must not spend the night
 * querying Postgres.
 */
export function LiveRefresh({
  active,
  pulseUrl,
  initialPulse,
  intervalMs = 3000,
}: {
  active: boolean
  /** Where the change token lives, e.g. `/api/pulse?project=<id>`. */
  pulseUrl?: string
  /** The token at server-render time, so the first tick has a baseline. */
  initialPulse?: string
  intervalMs?: number
}) {
  const router = useRouter()
  const last = React.useRef(initialPulse)
  // A refresh re-renders the server page, which hands back a fresh baseline.
  React.useEffect(() => {
    if (initialPulse !== undefined) last.current = initialPulse
  }, [initialPulse])

  React.useEffect(() => {
    if (!active) return

    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      if (!pulseUrl) {
        router.refresh()
        return
      }
      try {
        const response = await fetch(pulseUrl, { cache: 'no-store' })
        if (!response.ok) {
          router.refresh()
          return
        }
        const { pulse } = (await response.json()) as { pulse: string }
        const changed = last.current !== undefined && pulse !== last.current
        last.current = pulse
        if (changed) router.refresh()
      } catch {
        router.refresh()
      }
    }
    const timer = window.setInterval(() => void tick(), intervalMs)

    // Catch up immediately on returning to the tab, rather than making the
    // user wait out the rest of an interval that ran while it was hidden.
    const onVisible = () => void tick()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [active, intervalMs, pulseUrl, router])

  if (!active) return null

  return (
    <span
      className="flex items-center gap-1.5 text-[12px] text-[var(--color-text-muted)]"
      aria-live="polite"
    >
      <span
        aria-hidden
        className="size-1.5 animate-pulse rounded-full bg-[var(--color-accent)] motion-reduce:animate-none"
      />
      Updating automatically
    </span>
  )
}
