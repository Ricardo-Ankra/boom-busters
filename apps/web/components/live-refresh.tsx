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
 * So while a run is in flight the screen re-reads itself. Spec section 11.3
 * already accepts polling for the render progress view; this is the same
 * bargain at a slower cadence.
 *
 * It stops as soon as nothing is running, and pauses while the tab is hidden —
 * a console left open on a second monitor overnight must not spend the night
 * querying Postgres.
 */
export function LiveRefresh({
  active,
  intervalMs = 3000,
}: {
  active: boolean
  intervalMs?: number
}) {
  const router = useRouter()

  React.useEffect(() => {
    if (!active) return

    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const timer = window.setInterval(tick, intervalMs)

    // Catch up immediately on returning to the tab, rather than making the
    // user wait out the rest of an interval that ran while it was hidden.
    document.addEventListener('visibilitychange', tick)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [active, intervalMs, router])

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
