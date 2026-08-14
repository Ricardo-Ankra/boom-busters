'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { saveSettings } from '@/app/(console)/settings/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'

/**
 * The one spending control (2026-08-13; supersedes spec section 11.3's kill
 * switch and per-provider budget editors, both removed by decision).
 *
 * A single number: how much the whole pipeline may spend this month, across
 * every provider. A run that would cross it parks on a budget gate rather than
 * failing — the machinery under it is unchanged. Setting it to zero refuses
 * every priced call, which is everything the kill switch did as a separate
 * concept.
 *
 * It writes through `saveSettings`, the same validated action the Settings
 * screen uses: two write paths to one row is how they drift.
 */
export function CeilingEditor({ ceilingUsd }: { ceilingUsd: number }) {
  const router = useRouter()
  const { toast } = useToast()
  const [draft, setDraft] = React.useState(String(ceilingUsd))
  const [busy, setBusy] = React.useState(false)

  const parsed = Number(draft)
  const valid = Number.isFinite(parsed) && parsed >= 0
  const dirty = valid && parsed !== ceilingUsd

  async function save(): Promise<void> {
    setBusy(true)
    try {
      const result = await saveSettings({ budgets: { monthlyCeilingUsd: parsed } })
      if (result.ok) {
        toast({
          title: `Ceiling set to $${parsed.toFixed(2)}/month`,
          ...(parsed === 0 ? { description: 'Every priced call now parks on a budget gate.' } : {}),
        })
        router.refresh()
      } else {
        toast({ title: 'Could not save the ceiling', description: result.error, variant: 'error' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="monthly-ceiling" className="text-[13px]">
        Monthly ceiling, US dollars
      </label>
      <Input
        id="monthly-ceiling"
        type="number"
        min="0"
        step="1"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="w-28 font-mono tabular-nums"
      />
      <Button variant="primary" busy={busy} disabled={!dirty} onClick={save}>
        Save
      </Button>
      <span className="text-[12px] text-[var(--color-text-muted)]">
        One number for everything. A run that would cross it parks and asks; zero parks every run.
      </span>
    </div>
  )
}
