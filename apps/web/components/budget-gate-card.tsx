'use client'

import type { OpenBudgetGate } from '@boom-busters/db'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { abortOverage, approveOverage } from '@/app/(console)/projects/actions'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

/**
 * The "Over budget — approve overage / abort" card (build spec section 6).
 *
 * The run is parked, not dead. The card shows the arithmetic that stopped it
 * and asks for a number: approving means granting a specific amount of extra
 * headroom for this month, not flipping a switch that means "spend whatever".
 */
export function BudgetGateCard({ gate }: { gate: OpenBudgetGate }) {
  const router = useRouter()
  const { toast } = useToast()

  // Defaulted to what this call needs, rounded up to the cent, so the common
  // case is one click and the uncommon case is a deliberate edit.
  const suggested = Math.max(0.01, Math.ceil(gate.estimateUsd * 100) / 100)
  const [amount, setAmount] = React.useState(String(suggested))
  const [busy, setBusy] = React.useState<'approve' | 'abort' | null>(null)

  const projectId = gate.projectId

  async function run(action: 'approve' | 'abort'): Promise<void> {
    if (!projectId) return
    setBusy(action)
    try {
      const result =
        action === 'approve'
          ? await approveOverage(projectId, gate.provider, Number(amount))
          : await abortOverage(projectId, gate.provider)

      if (result.ok) {
        toast({ title: action === 'approve' ? 'Overage approved' : 'Run aborted' })
        router.refresh()
      } else {
        toast({ title: 'That did not work', description: result.error, variant: 'error' })
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="border-[var(--color-warning)]">
      <CardHeader>
        <CardTitle>Over budget — the run is parked</CardTitle>
        <CardDescription>{`${gate.provider} · ${gate.operation}`}</CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <dt className="text-[var(--color-text-muted)]">Spent this month</dt>
            <dd className="font-mono tabular-nums">${gate.monthSpendUsd.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">This call needs</dt>
            <dd className="font-mono tabular-nums">${gate.estimateUsd.toFixed(4)}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-muted)]">Monthly cap</dt>
            <dd className="font-mono tabular-nums">${gate.budgetUsd.toFixed(2)}</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-[var(--color-text-secondary)]">
              Extra allowed this month (USD)
            </span>
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="w-40 font-mono tabular-nums"
            />
          </label>

          <Button variant="primary" busy={busy === 'approve'} onClick={() => run('approve')}>
            Approve overage
          </Button>
          <Button variant="danger" busy={busy === 'abort'} onClick={() => run('abort')}>
            Abort this run
          </Button>
        </div>

        <p className="text-[12px] text-[var(--color-text-muted)]">
          The extra applies to {gate.provider} for this calendar month only, and expires on its own.
        </p>
      </CardContent>
    </Card>
  )
}
