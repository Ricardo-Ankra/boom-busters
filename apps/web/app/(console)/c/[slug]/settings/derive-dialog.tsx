'use client'

import {
  DERIVE_CAP_WARN_USD,
  DERIVE_ROUNDS_DEFAULT,
  DERIVE_ROUNDS_MAX,
  DERIVE_ROUNDS_MIN,
} from '@boom-busters/schemas'
import type { TechniqueKey } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Label, NumberInput, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { derivationEstimateUsd, type DerivationEstimateTable } from '@/lib/derivation-estimate'
import { deriveExemplarsAction } from './exemplar-actions'
import type { TechniqueOption } from './motion-tab'

/**
 * "Derive exemplars" (spec 2026-11-04, section 9.1): the techniques to
 * derive (ticked by default when in use with no approved version), the
 * rounds per technique, and the cap in dollars the owner types every
 * time; above $20 the field says so in red and still allows it. The
 * estimate follows the ticks and the rounds; the last run's cost per
 * technique sits beside it.
 */

const ROUNDS_IN_WORDS = 'one round gives a correct exemplar, two a tuned one, three a polished one'

/** "kpi-counter" reads "KPI counter"; the rest as they are said. */
export function techniqueName(technique: string): string {
  const words = technique.split('-').map((word) => (word === 'kpi' ? 'KPI' : word))
  const sentence = words.join(' ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

const money = (usd: number) => `$${usd.toFixed(2)}`

export function DeriveDialog({
  channelId,
  techniques,
  defaults,
  lastRun,
  estimateTable,
  storageReady,
  onClose,
  onLaunched,
}: {
  channelId: string
  techniques: readonly TechniqueOption[]
  /** Ticked when the dialogue opens. */
  defaults: readonly TechniqueKey[]
  /** The last derivation's cost per technique, from its progress; null before one ran. */
  lastRun: readonly { technique: string; costUsd: number }[] | null
  estimateTable: DerivationEstimateTable
  storageReady: boolean
  onClose: () => void
  onLaunched: (derivationId: string) => void
}) {
  const { toast } = useToast()
  const [ticked, setTicked] = React.useState<Set<TechniqueKey>>(new Set(defaults))
  const [rounds, setRounds] = React.useState(DERIVE_ROUNDS_DEFAULT)
  const [cap, setCap] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const capUsd = Number(cap)
  const capValid = cap.trim() !== '' && Number.isFinite(capUsd) && capUsd > 0
  const chosen = techniques.filter((option) => ticked.has(option.technique))
  const estimate = derivationEstimateUsd(estimateTable, { techniques: chosen.length, rounds })

  const toggle = (technique: TechniqueKey, on: boolean) => {
    setTicked((current) => {
      const next = new Set(current)
      if (on) next.add(technique)
      else next.delete(technique)
      return next
    })
  }

  const start = async () => {
    setBusy(true)
    try {
      const result = await deriveExemplarsAction(channelId, {
        techniques: chosen.map((option) => option.technique),
        rounds,
        capUsd,
      })
      if (!result.ok || !result.derivationId) {
        toast({
          title: 'Could not start the derivation',
          description: result.error,
          variant: 'error',
        })
        return
      }
      onLaunched(result.derivationId)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog label="Derive exemplars" onClose={onClose}>
      <div className="flex flex-col gap-4 text-[13px]">
        <p className="text-[var(--color-text-secondary)]">
          Each technique is planned from your references, built, judged by the critic and fixed,
          round by round, then checked once more. The result is a draft you approve on the Exemplars
          tab; nothing is approved for you.
        </p>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-[12px] font-medium">Techniques</legend>
          {techniques.map((option) => (
            <label key={option.technique} className="flex min-h-10 items-center gap-2">
              <input
                type="checkbox"
                checked={ticked.has(option.technique)}
                onChange={(event) => toggle(option.technique, event.target.checked)}
                disabled={busy}
              />
              <span>
                {techniqueName(option.technique)}
                <span className="text-[var(--color-text-muted)]"> {option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <Label htmlFor="derive-rounds">Rounds</Label>
          <Select
            id="derive-rounds"
            value={String(rounds)}
            onChange={(event) => setRounds(Number(event.target.value))}
            disabled={busy}
          >
            {Array.from({ length: DERIVE_ROUNDS_MAX - DERIVE_ROUNDS_MIN + 1 }, (_, index) => (
              <option key={index} value={String(DERIVE_ROUNDS_MIN + index)}>
                {DERIVE_ROUNDS_MIN + index}
              </option>
            ))}
          </Select>
          <p className="text-[12px] text-[var(--color-text-muted)]">{ROUNDS_IN_WORDS}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="derive-cap">Cap in dollars</Label>
          <NumberInput
            id="derive-cap"
            value={cap}
            min={0}
            step={1}
            onChange={(event) => setCap(event.target.value)}
            disabled={busy}
            required
          />
          {capValid && capUsd > DERIVE_CAP_WARN_USD ? (
            <p className="text-[12px] text-[var(--color-danger)]">
              Above ${DERIVE_CAP_WARN_USD}. It still runs.
            </p>
          ) : null}
        </div>
        <p>
          About {money(estimate)} for {chosen.length}{' '}
          {chosen.length === 1 ? 'technique' : 'techniques'} at {rounds}{' '}
          {rounds === 1 ? 'round' : 'rounds'}
        </p>
        {lastRun && lastRun.length > 0 ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Last run:{' '}
            {lastRun.map((entry) => `${entry.technique} ${money(entry.costUsd)}`).join(', ')}
          </p>
        ) : null}
        {!storageReady ? (
          <p role="status" className="text-[12px] text-[var(--color-text-muted)]">
            Without R2 the critic sees no frames; each technique is stored unreviewed.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={start} disabled={busy || chosen.length === 0 || !capValid}>
            {busy ? 'Starting' : 'Start deriving'}
          </Button>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
