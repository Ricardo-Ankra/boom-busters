'use client'

import type { Technique, TechniqueProgress } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { DerivationEstimateTable } from '@/lib/motion-estimates'
import { DeriveDialog, techniqueName } from './derive-dialog'
import { latestDerivationAction, type DerivationView } from './exemplar-actions'
import type { TechniqueOption } from './motion-tab'

/**
 * The Derive section of the Motion tab (spec 2026-11-04, section 11.3):
 * the launch, the latest derivation per technique in words with its cost,
 * and the run's state. Polls while a derivation runs, as the References
 * section polls a read.
 */

const POLL_MS = 5000
const money = (usd: number) => `$${usd.toFixed(2)}`

/** A technique's state in words. */
export function progressLine(entry: TechniqueProgress): string {
  switch (entry.state) {
    case 'pending':
      return 'waiting'
    case 'running':
      return 'running'
    case 'ready':
      return 'ready for your review'
    case 'wants-pass':
      return 'the critic wants one more pass'
    case 'no-frames':
      return `stored without frames${entry.reason ? `: ${entry.reason}` : ''}`
    case 'refused':
      return `refused: ${entry.reason ?? 'no reason given'}`
    case 'stopped-at-cap':
      return `stopped at cap: ${entry.reason ?? ''}`.trimEnd()
    case 'failed':
      return `failed: ${entry.reason ?? 'no reason given'}`
  }
}

function stateLine(derivation: DerivationView): string {
  switch (derivation.state) {
    case 'running':
      return 'Running.'
    case 'done':
      return `Done, ${money(derivation.spentUsd)} spent.`
    case 'stopped':
      return `Stopped at the cap, ${money(derivation.spentUsd)} of $${derivation.capUsd} spent.`
    case 'failed':
      return `Failed: ${derivation.error ?? 'no reason given'}`
  }
}

export function DeriveSection({
  channelId,
  derivation,
  jobRunning,
  techniques,
  defaults,
  estimateTable,
  storageReady,
  archived,
}: {
  channelId: string
  derivation: DerivationView | null
  jobRunning: boolean
  techniques: readonly TechniqueOption[]
  /** The techniques in use with no approved version. */
  defaults: readonly Technique[]
  estimateTable: DerivationEstimateTable
  storageReady: boolean
  archived: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [latest, setLatest] = React.useState<DerivationView | null>(derivation)
  React.useEffect(() => setLatest(derivation), [derivation])

  // While a derivation runs, ask for it every few seconds; refresh the page once it ends.
  React.useEffect(() => {
    if (latest?.state !== 'running') return
    const timer = setInterval(() => {
      void latestDerivationAction(channelId).then((result) => {
        if (!result.ok || !result.derivation) return
        setLatest(result.derivation)
        if (result.derivation.state !== 'running') router.refresh()
      })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [latest?.state, channelId, router])

  const lastRun =
    latest && latest.state !== 'running'
      ? latest.progress.map((entry) => ({ technique: entry.technique, costUsd: entry.costUsd }))
      : null
  const running = jobRunning || latest?.state === 'running'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Derive</CardTitle>
        <CardDescription>
          Each technique this channel uses gets its own example, planned from the references and
          judged by the critic. A paid job; you type its cap.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <Button type="button" onClick={() => setOpen(true)} disabled={archived || running}>
            Derive exemplars
          </Button>
        </div>
        {latest ? (
          <div className="flex flex-col gap-2 text-[13px]">
            <p>{stateLine(latest)}</p>
            <ul className="flex list-none flex-col gap-1 pl-0">
              {latest.progress.map((entry) => (
                <li key={entry.technique} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{techniqueName(entry.technique)}</span>
                  <span className="text-[var(--color-text-secondary)]">{progressLine(entry)}</span>
                  <span className="text-[var(--color-text-muted)]">{money(entry.costUsd)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-[var(--color-text-muted)]">No derivation has run yet.</p>
        )}
      </CardContent>
      {open ? (
        <DeriveDialog
          channelId={channelId}
          techniques={techniques}
          defaults={defaults}
          lastRun={lastRun}
          estimateTable={estimateTable}
          storageReady={storageReady}
          onClose={() => setOpen(false)}
          onLaunched={() => router.refresh()}
        />
      ) : null}
    </Card>
  )
}
