import { getSettings } from '@boom-busters/db'
import {
  listLedger,
  monthSpendByProject,
  monthSpendByProvider,
  monthTotalUsd,
} from '@boom-busters/cost'
import { PROVIDERS, effectiveCeilingUsd, monthKey } from '@boom-busters/schemas'
import type { Provider } from '@boom-busters/schemas'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { CeilingEditor } from './cost-controls'
import { LedgerTable } from './ledger-table'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Costs · Boom-Busters' }

/**
 * The Costs screen (build spec section 11.3): total spend against the one
 * monthly ceiling, the per-provider and per-project breakdowns, and the
 * filterable ledger.
 *
 * The kill switch and per-provider budget editors the spec asks for were
 * removed by decision (2026-08-13) — accurate tracking plus a single ceiling.
 * The bar reads `effectiveCeilingUsd`, so an approved overage shows up as a
 * raised ceiling rather than as a bar mysteriously over 100%.
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

  const ceiling = effectiveCeilingUsd(settings.budgets, now)
  const overage = ceiling - settings.budgets.monthlyCeilingUsd
  const ratio = ceiling === 0 ? (total > 0 ? 1 : 0) : Math.min(1, total / ceiling)

  const spenders = PROVIDERS.map((provider) => ({
    provider,
    spendUsd: byProvider[provider] ?? 0,
  })).filter((row) => row.spendUsd > 0)

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[20px] font-semibold">Costs</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          <span className="font-mono">{monthKey(now)}</span> · total{' '}
          <span className="font-mono tabular-nums">${total.toFixed(2)}</span>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>This month against the ceiling</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-medium">All providers</span>
              <span className="font-mono text-[var(--color-text-secondary)] tabular-nums">
                ${total.toFixed(2)} / ${ceiling.toFixed(2)}
                {overage > 0 ? (
                  <span className="ml-1 text-[var(--color-warning)]">
                    (incl. ${overage.toFixed(2)} approved)
                  </span>
                ) : null}
              </span>
            </div>
            <div
              role="meter"
              aria-label="Month spend against the ceiling"
              aria-valuenow={Math.round(ratio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]"
            >
              <div
                className={
                  ceiling > 0 && total > ceiling
                    ? 'h-full bg-[var(--color-danger)]'
                    : ratio > 0.8
                      ? 'h-full bg-[var(--color-warning)]'
                      : 'h-full bg-[var(--color-accent)]'
                }
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          </div>

          <CeilingEditor ceilingUsd={settings.budgets.monthlyCeilingUsd} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By provider</CardTitle>
        </CardHeader>
        <CardContent>
          {spenders.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--color-text-muted)]">
              Nothing has been spent this month.
            </p>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                  <th scope="col" className="py-2 font-medium">
                    Provider
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Spend
                  </th>
                </tr>
              </thead>
              <tbody>
                {spenders.map((row) => (
                  <tr
                    key={row.provider}
                    className="border-b border-[var(--color-border)] last:border-0"
                  >
                    <td className="py-2">{row.provider}</td>
                    <td className="py-2 text-right font-mono tabular-nums">
                      ${row.spendUsd.toFixed(4)}
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
