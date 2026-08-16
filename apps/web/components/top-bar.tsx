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
  ceilingUsd,
  activeRuns,
  activity,
}: {
  monthSpendUsd: number
  /** `effectiveCeilingUsd` — the configured ceiling plus this month's overage. */
  ceilingUsd: number
  activeRuns: ActiveRun[]
  activity: ActivityEntry[]
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4">
      <Breadcrumb />

      <div className="ml-auto flex items-center gap-4">
        <ActiveRunsIndicator runs={activeRuns} />
        <CostMeter monthSpendUsd={monthSpendUsd} ceilingUsd={ceilingUsd} />
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

/**
 * Money actually spent this month, not money expected to be spent.
 *
 * The ledger sums `coalesce(actual_usd, estimated_usd)`: a finished call
 * contributes the cost settled from the tokens the provider reported, and the
 * estimate stands in only for a reservation still in flight — which the budget
 * guard requires, or two concurrent calls could each pass a cap they jointly
 * break. In practice that is a few seconds per call.
 *
 * Said out loud on the control, because "is this actual or estimated" is a
 * reasonable question to have about a number with a dollar sign on it, and a
 * figure you cannot interpret is a figure you cannot act on.
 */
function CostMeter({ monthSpendUsd, ceilingUsd }: { monthSpendUsd: number; ceilingUsd: number }) {
  // The denominator is the point. "Spent $41.20" cannot tell 41% from 98%,
  // and the first sign of a nearly-spent month must not be a parked run.
  const ratio = ceilingUsd > 0 ? monthSpendUsd / ceilingUsd : 1
  const tone =
    ratio >= 1
      ? 'text-[var(--color-danger)]'
      : ratio > 0.8
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-text-secondary)]'

  return (
    <span
      className="hidden items-center gap-1.5 text-[13px] sm:flex"
      title="Actual spend this month against the monthly ceiling. A call still in flight counts at its estimate until it settles."
    >
      <span className="text-[var(--color-text-muted)]">Month</span>
      <span className={`font-mono tabular-nums ${tone}`}>
        ${monthSpendUsd.toFixed(2)} / ${ceilingUsd.toFixed(0)}
      </span>
    </span>
  )
}
