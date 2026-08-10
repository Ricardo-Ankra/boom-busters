import type { ActiveRun, ActivityEntry } from '@boom-busters/db'
import { ActivityDrawer } from '@/components/activity-drawer'
import { Breadcrumb } from '@/components/breadcrumb'
import { ThemeToggle } from '@/components/theme-provider'
import { SignOutButton } from '@/components/sign-out-button'

/**
 * Top bar (build spec section 11.2): breadcrumb, active-runs indicator with a
 * live step name and pulsing dot, cost-month meter, and the Activity button.
 *
 * Both readouts are now fed by the run mirror and the cost ledger. When there
 * is genuinely nothing to show they say so in words rather than showing a zero
 * that could be mistaken for a reading.
 */
export function TopBar({
  monthSpendUsd,
  activeRuns,
  activity,
}: {
  monthSpendUsd: number
  activeRuns: ActiveRun[]
  activity: ActivityEntry[]
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <Breadcrumb />

      <div className="ml-auto flex items-center gap-4">
        <ActiveRunsIndicator runs={activeRuns} />
        <CostMeter monthSpendUsd={monthSpendUsd} />
        <ActivityDrawer entries={activity} />
        <ThemeToggle />
        <SignOutButton />
      </div>
    </header>
  )
}

function ActiveRunsIndicator({ runs }: { runs: ActiveRun[] }) {
  if (runs.length === 0) {
    return (
      <span className="hidden text-[13px] text-[var(--color-text-muted)] sm:inline">
        No active runs
      </span>
    )
  }

  const [first] = runs
  const label =
    runs.length === 1 && first?.currentStep
      ? first.currentStep
      : `${runs.length} run${runs.length === 1 ? '' : 's'}`

  return (
    <span className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]">
      <span
        aria-hidden
        className="size-2 animate-pulse rounded-full bg-[var(--color-accent)] motion-reduce:animate-none"
      />
      <span className="max-w-[22ch] truncate font-mono">{label}</span>
      <span className="sr-only">
        {runs.length} run{runs.length === 1 ? '' : 's'} in progress
      </span>
    </span>
  )
}

function CostMeter({ monthSpendUsd }: { monthSpendUsd: number }) {
  return (
    <span className="hidden items-center gap-1.5 text-[13px] sm:flex">
      <span className="text-[var(--color-text-muted)]">This month</span>
      <span className="font-mono text-[var(--color-text-secondary)] tabular-nums">
        ${monthSpendUsd.toFixed(2)}
      </span>
    </span>
  )
}
