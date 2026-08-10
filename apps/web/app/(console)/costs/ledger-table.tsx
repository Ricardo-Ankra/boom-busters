import type { LedgerEntry } from '@boom-busters/cost'
import { PROVIDERS } from '@boom-busters/schemas'
import type { Provider } from '@boom-busters/schemas'
import type { Route } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/**
 * The filterable ledger (build spec section 11.3).
 *
 * Filters are links, not a client-side control: the filter is part of the
 * page's address, so a filtered view can be bookmarked and shared with
 * yourself later. Every filter is a visible labelled button (section 11.1).
 */
export function LedgerTable({
  entries,
  activeProvider,
}: {
  entries: LedgerEntry[]
  activeProvider: Provider | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant={activeProvider === null ? 'primary' : 'outline'}>
          <Link href={'/costs' as Route}>All providers</Link>
        </Button>
        {PROVIDERS.map((provider) => (
          <Button
            key={provider}
            asChild
            variant={activeProvider === provider ? 'primary' : 'outline'}
          >
            <Link href={`/costs?provider=${provider}` as Route}>{provider}</Link>
          </Button>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-[8px] border border-[var(--color-border)] p-6 text-center text-[13px] text-[var(--color-text-muted)]">
          No ledger entries{activeProvider ? ` for ${activeProvider}` : ''} yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[8px] border border-[var(--color-border)]">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-muted)]">
                <th scope="col" className="p-3 font-medium">
                  When
                </th>
                <th scope="col" className="p-3 font-medium">
                  Provider
                </th>
                <th scope="col" className="p-3 font-medium">
                  Operation
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  Estimated
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  Actual
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="p-3 font-mono text-[12px] whitespace-nowrap text-[var(--color-text-muted)]">
                    {entry.occurredAt.toISOString().replace('T', ' ').slice(0, 19)}
                  </td>
                  <td className="p-3">{entry.provider}</td>
                  <td className="p-3">
                    {entry.operation}
                    {entry.meta['demo'] === true ? (
                      <span className="ml-2 rounded-[4px] border border-[var(--color-border)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-muted)]">
                        demo
                      </span>
                    ) : null}
                  </td>
                  <td className="p-3 text-right font-mono tabular-nums">
                    ${entry.estimatedUsd.toFixed(4)}
                  </td>
                  <td className="p-3 text-right font-mono tabular-nums">
                    {entry.settled ? (
                      `$${(entry.actualUsd ?? 0).toFixed(4)}`
                    ) : (
                      // An unsettled row is money reserved for a call still in
                      // flight. It counts against the cap, so it must not read
                      // as $0.00.
                      <span className="text-[var(--color-warning)]">reserved</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
