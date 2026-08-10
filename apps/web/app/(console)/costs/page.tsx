import { getSettings } from '@boom-busters/db'
import {
  listLedger,
  monthSpendByProject,
  monthSpendByProvider,
  monthTotalUsd,
} from '@boom-busters/cost'
import { PROVIDERS, effectiveBudgetUsd, monthKey } from '@boom-busters/schemas'
import type { Provider } from '@boom-busters/schemas'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { BudgetEditor, KillSwitch } from './cost-controls'
import { LedgerTable } from './ledger-table'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Costs · Boom-Busters' }

/**
 * The Costs screen (build spec section 11.3): per-provider spend against
 * budget, per-project breakdown, the filterable ledger, the kill switch and
 * the budget editors.
 *
 * Every number here is the same one the guard compares against — the bars read
 * `effectiveBudgetUsd`, so an approved overage shows up as a raised cap rather
 * than as a bar mysteriously over 100%.
 */
export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; project?: string }>
}) {
  const filters = await searchParams
  const now = new Date()

  const [settings, byProvider, byProject, total, ledger] = await Promise.all([
    getSettings(db),
    monthSpendByProvider(db, now),
    monthSpendByProject(db, now),
    monthTotalUsd(db, now),
    listLedger(db, {
      ...(isProvider(filters.provider) ? { provider: filters.provider } : {}),
      ...(filters.project ? { projectId: filters.project } : {}),
      limit: 200,
    }),
  ])

  const rows = PROVIDERS.map((provider) => ({
    provider,
    spendUsd: byProvider[provider] ?? 0,
    budgetUsd: effectiveBudgetUsd(settings.budgets, provider, now),
    configuredUsd: settings.budgets.perProviderMonthlyUSD[provider] ?? 0,
  }))

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[20px] font-semibold">Costs</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          <span className="font-mono">{monthKey(now)}</span> · total{' '}
          <span className="font-mono tabular-nums">${total.toFixed(2)}</span>
        </p>
      </header>

      <KillSwitch enabled={settings.budgets.killSwitch} />

      <Card>
        <CardHeader>
          <CardTitle>Spend against budget</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.map((row) => (
            <BudgetRow key={row.provider} {...row} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By project</CardTitle>
        </CardHeader>
        <CardContent>
          {byProject.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--color-text-muted)]">
              Nothing has been spent this month.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th scope="col" className="py-2 font-medium">
                    Project
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Spend
                  </th>
                </tr>
              </thead>
              <tbody>
                {byProject.map((row) => (
                  <tr
                    key={row.projectId ?? 'unattributed'}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="py-2">{row.title ?? 'Not attributed to a project'}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      ${row.totalUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budgets</CardTitle>
        </CardHeader>
        <CardContent>
          <BudgetEditor budgets={settings.budgets} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-[15px] font-semibold">Ledger</h2>
        <LedgerTable
          entries={ledger}
          activeProvider={isProvider(filters.provider) ? filters.provider : null}
        />
      </section>
    </div>
  )
}

function isProvider(value: string | undefined): value is Provider {
  return value !== undefined && (PROVIDERS as readonly string[]).includes(value)
}

function BudgetRow({
  provider,
  spendUsd,
  budgetUsd,
  configuredUsd,
}: {
  provider: Provider
  spendUsd: number
  budgetUsd: number
  configuredUsd: number
}) {
  // A zero cap is a real setting, not a missing one: it means "do not spend
  // here". Showing a full bar communicates that better than 0%.
  const ratio = budgetUsd === 0 ? (spendUsd > 0 ? 1 : 0) : Math.min(1, spendUsd / budgetUsd)
  const over = budgetUsd > 0 && spendUsd > budgetUsd
  const overage = budgetUsd - configuredUsd

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium">{provider}</span>
        <span className="font-mono text-[var(--color-text-secondary)] tabular-nums">
          ${spendUsd.toFixed(2)} / ${budgetUsd.toFixed(2)}
          {overage > 0 ? (
            <span className="ml-1 text-[var(--color-warning)]">
              (incl. ${overage.toFixed(2)} approved)
            </span>
          ) : null}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${provider} spend`}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]"
      >
        <div
          className={
            over
              ? 'h-full bg-[var(--color-danger)]'
              : ratio > 0.8
                ? 'h-full bg-[var(--color-warning)]'
                : 'h-full bg-[var(--color-accent)]'
          }
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
