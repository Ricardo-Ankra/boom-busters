import { ActivityDrawer } from '@/components/activity-drawer'
import { Breadcrumb } from '@/components/breadcrumb'
import { ThemeToggle } from '@/components/theme-provider'
import { SignOutButton } from '@/components/sign-out-button'

/**
 * Top bar (build spec section 11.2): breadcrumb, active-runs indicator with a
 * live step name and pulsing dot, cost-month meter, and the Activity button.
 *
 * The two live readouts are wired in M2 (Inngest run mirror) and M2's cost
 * ledger. Until then they render an explicit em dash rather than a plausible
 * zero — a fake "$0.00 spent" would be a lie the moment spending starts.
 */
export function TopBar({ monthSpendUsd }: { monthSpendUsd: number | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <Breadcrumb />

      <div className="ml-auto flex items-center gap-4">
        <ActiveRunsIndicator running={0} />
        <CostMeter monthSpendUsd={monthSpendUsd} />
        <ActivityDrawer />
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  )
}

function ActiveRunsIndicator({ running }: { running: number }) {
  if (running === 0) {
    return (
      <span className="hidden text-[13px] text-[var(--color-text-muted)] sm:inline">
        No active runs
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
      <span aria-hidden className="size-2 animate-pulse rounded-full bg-[var(--color-accent)]" />
      {running} running
    </span>
  )
}

function CostMeter({ monthSpendUsd }: { monthSpendUsd: number | null }) {
  return (
    <span className="hidden items-center gap-1.5 text-[13px] sm:flex">
      <span className="text-[var(--color-text-muted)]">This month</span>
      <span className="font-mono text-[var(--color-text-secondary)] tabular-nums">
        {monthSpendUsd === null ? '—' : `$${monthSpendUsd.toFixed(2)}`}
      </span>
    </span>
  )
}
