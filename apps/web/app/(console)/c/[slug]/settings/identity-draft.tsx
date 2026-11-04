'use client'

import type { MotionIdentity, MotionIdentityDraft } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { identityDiff } from '@/lib/identity-diff'
import { draftMotionIdentityAction } from './motion-actions'

/**
 * "Draft motion identity" (spec 2026-11-04, section 8.4): the owner's brief,
 * one paid call on the graphics route, and the proposal shown as a diff
 * against the current identity with the model's why. Apply writes the whole
 * proposal as one motion patch; Discard drops it. The proposal lives here
 * until then; a reload loses an unapplied one.
 */

const BRIEF_MAX = 1000
const textareaClass =
  'min-h-[80px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50'
const mutedClass = 'text-[12px] text-[var(--color-text-muted)]'

export function IdentityDraft({
  channelId,
  current,
  draftEstimateUsd,
  disabled,
  onApply,
}: {
  channelId: string
  current: MotionIdentity
  /** What the call costs, in dollars, on the channel's graphics route. */
  draftEstimateUsd: number
  disabled: boolean
  onApply: (identity: MotionIdentity) => Promise<void>
}) {
  const { toast } = useToast()
  const [brief, setBrief] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [proposal, setProposal] = React.useState<MotionIdentityDraft | null>(null)

  const run = async () => {
    setBusy(true)
    try {
      const result = await draftMotionIdentityAction(channelId, { brief: brief.trim() })
      if (!result.ok || !result.draft) {
        toast({
          title: 'Could not draft the identity',
          description: result.error,
          variant: 'error',
        })
        return
      }
      setProposal(result.draft)
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!proposal) return
    setBusy(true)
    try {
      await onApply(proposal.identity)
      setProposal(null)
    } finally {
      setBusy(false)
    }
  }

  const changes = proposal ? identityDiff(current, proposal.identity) : []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Draft motion identity</CardTitle>
        <CardDescription>
          One call proposes every field above from the references&apos; readings, your brief, the
          brand kit and the catalogue. You see it as a diff and apply or discard it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="motion-brief">What this channel should move like, in a few lines</Label>
          <textarea
            id="motion-brief"
            className={textareaClass}
            value={brief}
            maxLength={BRIEF_MAX}
            disabled={disabled || busy}
            onChange={(event) => setBrief(event.target.value)}
          />
          <p className={mutedClass}>
            Paid: one call on the graphics route, about ${draftEstimateUsd.toFixed(2)}. A channel
            with no references drafts from the brief alone.
          </p>
        </div>
        {proposal ? (
          <div className="flex flex-col gap-3">
            <p className="text-[13px] text-[var(--color-text-secondary)]">{proposal.why}</p>
            {changes.length === 0 ? (
              <p className={mutedClass}>The draft keeps every field as it is.</p>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="text-[var(--color-text-muted)]">
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Field
                    </th>
                    <th scope="col" className="py-1 pr-3 font-medium">
                      Now
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Proposed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((change) => (
                    <tr
                      key={change.field}
                      className="border-t border-[var(--color-border)] align-top"
                    >
                      <th scope="row" className="py-1 pr-3 font-medium">
                        {change.label}
                      </th>
                      <td className="py-1 pr-3 whitespace-pre-wrap text-[var(--color-text-secondary)]">
                        {change.current}
                      </td>
                      <td className="py-1 whitespace-pre-wrap">{change.proposed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={disabled}
                busy={busy}
                onClick={() => void apply()}
              >
                Apply
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setProposal(null)}>
                Discard
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="primary" disabled={disabled} busy={busy} onClick={() => void run()}>
              {busy ? 'Drafting...' : 'Draft motion identity'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
