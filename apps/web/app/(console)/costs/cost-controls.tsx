'use client'

import { PROVIDERS } from '@boom-busters/schemas'
import type { Budgets } from '@boom-busters/schemas'
import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { saveSettings } from '@/app/(console)/settings/actions'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

/**
 * The kill switch and budget editors (build spec section 11.3).
 *
 * Both write through `saveSettings`, the same validated action the Settings
 * screen uses — budgets live in the settings row, and having two write paths
 * to one row is how they drift.
 */

export function KillSwitch({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState(false)

  async function set(next: boolean): Promise<void> {
    setBusy(true)
    try {
      const result = await saveSettings({ budgets: { killSwitch: next } })
      if (result.ok) {
        toast({ title: next ? 'Kill switch on — all spending refused' : 'Kill switch off' })
        router.refresh()
      } else {
        toast({
          title: 'Could not change the kill switch',
          description: result.error,
          variant: 'error',
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={enabled ? 'border-[var(--color-danger)]' : undefined}>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldAlert className="size-5 text-[var(--color-danger)]" aria-hidden />
          ) : (
            <ShieldCheck className="size-5 text-[var(--color-success)]" aria-hidden />
          )}
          <div>
            <p className="text-[14px] font-medium">
              {enabled ? 'Kill switch is on' : 'Kill switch is off'}
            </p>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              {enabled
                ? 'Every priced provider call is refused. Runs park on a budget gate rather than failing.'
                : 'Spending is allowed up to each provider cap.'}
            </p>
          </div>
        </div>

        {enabled ? (
          <Button variant="primary" busy={busy} onClick={() => set(false)}>
            Turn the kill switch off
          </Button>
        ) : (
          <ConfirmButton
            label="Turn the kill switch on"
            confirmLabel="Stop all spending"
            consequence="Every run that needs a paid call will park on a budget gate until you turn this off."
            onConfirm={() => set(true)}
          />
        )}
      </CardContent>
    </Card>
  )
}

export function BudgetEditor({ budgets }: { budgets: Budgets }) {
  const router = useRouter()
  const { toast } = useToast()
  const [draft, setDraft] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      PROVIDERS.map((provider) => [provider, String(budgets.perProviderMonthlyUSD[provider] ?? 0)]),
    ),
  )
  const [busy, setBusy] = React.useState(false)

  const dirty = PROVIDERS.some(
    (provider) => Number(draft[provider]) !== (budgets.perProviderMonthlyUSD[provider] ?? 0),
  )

  async function save(): Promise<void> {
    const changed: Record<string, number> = {}
    for (const provider of PROVIDERS) {
      const next = Number(draft[provider])
      if (!Number.isFinite(next) || next < 0) {
        toast({ title: `${provider}: enter a number of dollars`, variant: 'error' })
        return
      }
      if (next !== (budgets.perProviderMonthlyUSD[provider] ?? 0)) changed[provider] = next
    }

    setBusy(true)
    try {
      const result = await saveSettings({ budgets: { perProviderMonthlyUSD: changed } })
      if (result.ok) {
        toast({ title: 'Budgets saved' })
        router.refresh()
      } else {
        toast({ title: 'Could not save budgets', description: result.error, variant: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {PROVIDERS.map((provider) => (
          <label key={provider} className="flex items-center justify-between gap-3 text-[13px]">
            <span>{provider}</span>
            <Input
              type="number"
              min="0"
              step="1"
              inputMode="decimal"
              aria-label={`${provider} monthly budget in US dollars`}
              value={draft[provider] ?? '0'}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [provider]: event.target.value }))
              }
              className="w-28 font-mono tabular-nums"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>
          Save budgets
        </Button>
        {dirty ? null : (
          <span className="text-[13px] text-[var(--color-text-muted)]">No changes to save.</span>
        )}
      </div>
    </div>
  )
}
