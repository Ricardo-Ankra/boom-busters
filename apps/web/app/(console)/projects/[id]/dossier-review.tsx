'use client'

import type { ClaimRow } from '@boom-busters/db'
import { ExternalLink, Pencil, ShieldAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { blocksApproval, blockingCount, sourceDomain } from '@/lib/claim-review'
import { editClaim, quarantineAllBlocking, quarantineClaim, verifyClaimAction } from './actions'

/**
 * Dossier review (build spec section 11.3): the document on the left, the
 * claims table on the right.
 *
 * The screen exists to make one judgement easy: is this claim safe to narrate
 * over footage? So unverified claims are amber and float to the top, every row
 * shows where its source actually points, and a quarantined claim is struck
 * through rather than hidden — the human needs to see what they excluded.
 */

const CONFIDENCE_LABELS: Record<string, string> = {
  sourced: 'Sourced',
  single_source: 'One source',
  unverified: 'Unverified',
}

const SOURCE_TYPES = ['court', 'regulator', 'major_outlet', 'book', 'other'] as const

export function DossierReview({
  projectId,
  contentMd,
  claims,
}: {
  projectId: string
  contentMd: string
  claims: ClaimRow[]
}) {
  const blocking = blockingCount(claims)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Dossier</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Rendered as pre-wrapped markdown source rather than parsed HTML:
              this text comes from a language model, and putting model output
              through a HTML renderer is a needless injection surface on a
              screen whose whole job is scrutiny. */}
          <pre className="max-h-[70vh] overflow-auto font-sans text-[14px] leading-relaxed whitespace-pre-wrap">
            {contentMd || 'The dossier is empty.'}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>
            Claims — {claims.length}
            {blocking > 0 ? (
              <span className="ml-2 text-[13px] font-normal text-[var(--color-warning)]">
                {blocking} still block approval
              </span>
            ) : null}
          </CardTitle>
          {/* The bulk verdict, beside the count it acts on. One-by-one triage
              stays for claims that deserve different answers; this is for the
              day the answer is "none of these made the cut". */}
          {blocking > 1 ? <QuarantineAllButton projectId={projectId} count={blocking} /> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {claims.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">
              No claims were extracted. A dossier with no claims cannot be scripted from.
            </p>
          ) : (
            <ul className="flex max-h-[70vh] flex-col divide-y divide-[var(--color-border)] overflow-auto">
              {claims.map((claim) => (
                <li key={claim.id}>
                  <ClaimRowView projectId={projectId} claim={claim} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function QuarantineAllButton({ projectId, count }: { projectId: string; count: number }) {
  const router = useRouter()
  const { toast } = useToast()

  return (
    <ConfirmButton
      label={
        <>
          <ShieldAlert aria-hidden />
          Quarantine all {count}
        </>
      }
      confirmLabel={`Quarantine ${count} claims`}
      consequence={
        `All ${count} claims still blocking approval are excluded from scripting. ` +
        'Each stays visible, struck through, and can be un-quarantined on its own.'
      }
      onConfirm={async () => {
        const result = await quarantineAllBlocking(projectId)
        if (result.ok) {
          toast({ title: `${count} claims quarantined — excluded from scripting` })
          router.refresh()
        } else {
          toast({ title: 'That did not work', description: result.error, variant: 'error' })
        }
      }}
    />
  )
}

function ClaimRowView({ projectId, claim }: { projectId: string; claim: ClaimRow }) {
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = React.useState(false)
  const [verifying, setVerifying] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(true)
    try {
      const result = await action()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
        return true
      }
      toast({ title: 'That did not work', description: result.error, variant: 'error' })
      return false
    } finally {
      setBusy(false)
    }
  }

  const blocks = blocksApproval(claim)

  return (
    <div
      className={`flex flex-col gap-2 p-3 ${
        blocks ? 'border-l-2 border-[var(--color-warning)] pl-3' : ''
      }`}
    >
      <p
        className={`text-[14px] ${
          claim.quarantined
            ? 'text-[var(--color-text-muted)] line-through'
            : 'text-[var(--color-text-primary)]'
        }`}
      >
        {claim.text}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span
          className={
            claim.confidence === 'unverified'
              ? 'rounded-[4px] bg-[var(--color-warning)]/15 px-1.5 py-0.5 text-[var(--color-warning)]'
              : 'rounded-[4px] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[var(--color-text-secondary)]'
          }
        >
          {CONFIDENCE_LABELS[claim.confidence]}
        </span>
        <span className="rounded-[4px] bg-[var(--color-surface-raised)] px-1.5 py-0.5 text-[var(--color-text-secondary)]">
          {claim.sourceType.replace('_', ' ')}
        </span>
        {claim.sourceUrl ? (
          <a
            href={claim.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            /* `min-h-[40px]` is the section 11.1 hit target, and this link
               needed it: at 24px it was the smallest control in the app and the
               one most worth pressing — checking where a claim's source
               actually points is the entire job of this screen. It went
               unnoticed because the audit that would have caught it was opening
               a different project. */
            className="inline-flex min-h-[40px] items-center gap-1 text-[var(--color-accent)] underline"
          >
            {sourceDomain(claim.sourceUrl)}
            <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : (
          <span className="text-[var(--color-text-muted)]">no source</span>
        )}
        {claim.quarantined ? (
          <span className="text-[var(--color-text-muted)]">excluded from scripting</span>
        ) : null}
      </div>

      {editing ? (
        <ClaimTextEditor
          initial={claim.text}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (text) => {
            if (await run(() => editClaim(projectId, claim.id, text), 'Claim updated')) {
              setEditing(false)
            }
          }}
        />
      ) : null}

      {verifying ? (
        <ClaimVerifier
          busy={busy}
          initialUrl={claim.sourceUrl ?? ''}
          onCancel={() => setVerifying(false)}
          onSave={async (input) => {
            if (await run(() => verifyClaimAction(projectId, claim.id, input), 'Claim verified')) {
              setVerifying(false)
            }
          }}
        />
      ) : null}

      {!editing && !verifying ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <Pencil aria-hidden />
            Edit
          </Button>

          {claim.confidence === 'unverified' && !claim.quarantined ? (
            <Button variant="outline" onClick={() => setVerifying(true)}>
              I checked this — add source
            </Button>
          ) : null}

          <Button
            variant={claim.quarantined ? 'ghost' : 'outline'}
            busy={busy}
            onClick={() =>
              void run(
                () => quarantineClaim(projectId, claim.id, !claim.quarantined),
                claim.quarantined ? 'Back in the script' : 'Quarantined — excluded from scripting',
              )
            }
          >
            <ShieldAlert aria-hidden />
            {claim.quarantined ? 'Un-quarantine' : 'Quarantine'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ClaimTextEditor({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string
  busy: boolean
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = React.useState(initial)

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        aria-label="Claim text"
        className="rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[14px] text-[var(--color-text-primary)]"
      />
      <div className="flex gap-2">
        <Button variant="primary" busy={busy} onClick={() => onSave(text)}>
          Save claim
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Turning an unverified claim into a sourced one.
 *
 * It insists on a URL, because "I checked this" without a link is a claim
 * nobody can re-check — including the person who checked it, six weeks later,
 * when a subject's lawyer asks where it came from.
 */
function ClaimVerifier({
  initialUrl,
  busy,
  onSave,
  onCancel,
}: {
  initialUrl: string
  busy: boolean
  onSave: (input: { sourceUrl: string; sourceType: string; confidence: string }) => void
  onCancel: () => void
}) {
  const [sourceUrl, setSourceUrl] = React.useState(initialUrl)
  const [sourceType, setSourceType] = React.useState<string>('major_outlet')
  const [confidence, setConfidence] = React.useState<string>('single_source')

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-[8px] border border-[var(--color-border)] p-2">
      <div className="flex flex-1 flex-col gap-1">
        <Label htmlFor="claim-source">Source URL</Label>
        <Input
          id="claim-source"
          value={sourceUrl}
          placeholder="https://"
          onChange={(event) => setSourceUrl(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="claim-source-type">Type</Label>
        <Select
          id="claim-source-type"
          value={sourceType}
          onChange={(event) => setSourceType(event.target.value)}
          className="w-36"
        >
          {SOURCE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type.replace('_', ' ')}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="claim-confidence">Confidence</Label>
        <Select
          id="claim-confidence"
          value={confidence}
          onChange={(event) => setConfidence(event.target.value)}
          className="w-36"
        >
          <option value="single_source">One source</option>
          <option value="sourced">Two or more</option>
        </Select>
      </div>
      <Button
        variant="primary"
        busy={busy}
        onClick={() => onSave({ sourceUrl, sourceType, confidence })}
      >
        Save source
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  )
}
