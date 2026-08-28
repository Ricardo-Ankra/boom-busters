'use client'

import type { ClaimRow } from '@boom-busters/db'
import { ExternalLink, List, Pencil, ShieldAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { blocksApproval, blockingCount, sourceDomain } from '@/lib/claim-review'
import {
  anchorClaims,
  inlineText,
  overlayAnchors,
  parseDossier,
  type AnchoredSegment,
  type ClaimAnchor,
  type DossierBlock,
  type InlineSegment,
} from '@/lib/dossier-markdown'
import { editClaim, quarantineAllBlocking, quarantineClaim, verifyClaimAction } from './actions'

/**
 * Dossier review (build spec section 11.3, amended 2026-08-28 — decision 196).
 *
 * One document, not two panes. The dossier renders as formatted text, and the
 * claims live where they were made: a phrase the extractor anchored to the
 * text is highlighted, and clicking it opens that claim's actions — source,
 * edit, verify, quarantine — over the document. Claims the matcher could not
 * place in the text (extraction paraphrases; that is normal) are listed in
 * the bar above the document, and every claim that still blocks approval is
 * always listed there, whether anchored or not, because the bar is the work
 * queue: the screen exists to make one judgement easy — is this claim safe
 * to narrate over footage?
 *
 * A quarantined claim's highlight is struck through rather than removed —
 * the human needs to see what they excluded.
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
  const [showAll, setShowAll] = React.useState(false)
  const [openClaimIds, setOpenClaimIds] = React.useState<string[] | null>(null)

  const { blocks, anchorsByUnit, anchoredCount, unanchoredIds } = React.useMemo(() => {
    const parsed = parseDossier(contentMd)
    const { anchors, unanchoredIds: unplaced } = anchorClaims(parsed, claims)

    const byUnit = new Map<string, ClaimAnchor[]>()
    for (const anchor of anchors) {
      const key = `${anchor.blockIndex}:${anchor.itemIndex ?? 'p'}`
      byUnit.set(key, [...(byUnit.get(key) ?? []), anchor])
    }
    return {
      blocks: parsed,
      anchorsByUnit: byUnit,
      anchoredCount: anchors.length,
      unanchoredIds: unplaced,
    }
  }, [contentMd, claims])

  const claimsById = React.useMemo(
    () => new Map(claims.map((claim) => [claim.id, claim])),
    [claims],
  )

  // The bar's always-visible rows: everything that blocks the gate. The
  // toggle widens that to the full extraction.
  const listed = showAll ? claims : claims.filter(blocksApproval)
  const openClaims = (openClaimIds ?? [])
    .map((id) => claimsById.get(id))
    .filter((claim): claim is ClaimRow => claim !== undefined)

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col gap-0.5">
            <CardTitle>Claims — {claims.length}</CardTitle>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              {blocking > 0 ? (
                <span className="text-[var(--color-warning)]">{blocking} still block approval</span>
              ) : (
                'nothing blocks approval'
              )}
              {' · '}
              {anchoredCount} highlighted in the text
              {unanchoredIds.length > 0 ? ` · ${unanchoredIds.length} not found in the text` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The bulk verdict, beside the count it acts on. One-by-one triage
                stays for claims that deserve different answers; this is for the
                day the answer is "none of these made the cut". */}
            {blocking > 1 ? <QuarantineAllButton projectId={projectId} count={blocking} /> : null}
            {claims.length > 0 ? (
              <Button variant="outline" onClick={() => setShowAll((on) => !on)}>
                <List aria-hidden />
                {showAll ? 'Show only what blocks' : `List all ${claims.length} claims`}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        {claims.length === 0 ? (
          <CardContent>
            <p className="text-[13px] text-[var(--color-text-muted)]">
              No claims were extracted. A dossier with no claims cannot be scripted from.
            </p>
          </CardContent>
        ) : listed.length > 0 ? (
          <CardContent>
            <ul className="flex max-h-[50vh] flex-col divide-y divide-[var(--color-border)] overflow-auto">
              {listed.map((claim) => (
                <li key={claim.id}>
                  <ClaimRowView projectId={projectId} claim={claim} />
                </li>
              ))}
            </ul>
          </CardContent>
        ) : null}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dossier</CardTitle>
          {anchoredCount > 0 ? (
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Highlighted phrases are extracted claims — press one to check its source, edit it or
              quarantine it.
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {contentMd.trim() === '' ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">The dossier is empty.</p>
          ) : (
            <div className="max-h-[75vh] overflow-auto text-[14px] leading-relaxed">
              {blocks.map((block, blockIndex) => (
                <BlockView
                  key={blockIndex}
                  block={block}
                  blockIndex={blockIndex}
                  anchorsByUnit={anchorsByUnit}
                  claimsById={claimsById}
                  onOpen={setOpenClaimIds}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {openClaims.length > 0 ? (
        <Dialog
          label={openClaims.length === 1 ? 'Claim' : `${openClaims.length} claims here`}
          onClose={() => setOpenClaimIds(null)}
        >
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {openClaims.map((claim) => (
              <li key={claim.id}>
                <ClaimRowView projectId={projectId} claim={claim} />
              </li>
            ))}
          </ul>
        </Dialog>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The rendered document
// ---------------------------------------------------------------------------

/**
 * The dossier's own headings sit under the card's h2, so depth 1 renders as
 * h3 and deeper levels step down from there — document structure the
 * heading-order audit accepts, with the visual scale carried by classes.
 */
const HEADING_LEVELS = ['h3', 'h4', 'h5', 'h6', 'h6', 'h6'] as const
const HEADING_CLASSES = [
  'text-[17px] font-semibold mt-1 mb-2',
  'text-[15px] font-semibold mt-3 mb-1.5',
  'text-[14px] font-semibold mt-2 mb-1',
  'text-[14px] font-medium mt-2 mb-1',
  'text-[14px] font-medium mt-2 mb-1',
  'text-[14px] font-medium mt-2 mb-1',
] as const

function BlockView({
  block,
  blockIndex,
  anchorsByUnit,
  claimsById,
  onOpen,
}: {
  block: DossierBlock
  blockIndex: number
  anchorsByUnit: Map<string, ClaimAnchor[]>
  claimsById: Map<string, ClaimRow>
  onOpen: (claimIds: string[]) => void
}) {
  if (block.kind === 'heading') {
    const Tag = HEADING_LEVELS[block.depth - 1] as 'h3'
    return (
      <Tag className={HEADING_CLASSES[block.depth - 1]}>
        <InlineView inline={block.inline} anchors={[]} claimsById={claimsById} onOpen={onOpen} />
      </Tag>
    )
  }

  if (block.kind === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul'
    return (
      <Tag
        className={`mb-3 flex flex-col gap-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
      >
        {block.items.map((item, itemIndex) => (
          <li key={itemIndex}>
            <InlineView
              inline={item}
              anchors={anchorsByUnit.get(`${blockIndex}:${itemIndex}`) ?? []}
              claimsById={claimsById}
              onOpen={onOpen}
            />
          </li>
        ))}
      </Tag>
    )
  }

  return (
    <p className="mb-3">
      <InlineView
        inline={block.inline}
        anchors={anchorsByUnit.get(`${blockIndex}:p`) ?? []}
        claimsById={claimsById}
        onOpen={onOpen}
      />
    </p>
  )
}

function SegmentView({ segment }: { segment: InlineSegment }) {
  if (segment.kind === 'strong') return <strong>{segment.text}</strong>
  if (segment.kind === 'em') return <em>{segment.text}</em>
  if (segment.kind === 'link') {
    return (
      <a
        href={segment.href}
        target="_blank"
        rel="noreferrer noopener"
        /* The vertical padding + negative margin buys the 40px hit target
           (section 11.1) without disturbing the line flow. */
        className="-my-[9px] py-[9px] text-[var(--color-accent)] underline"
      >
        {segment.text}
      </a>
    )
  }
  return <>{segment.text}</>
}

/**
 * Renders one unit's inline segments with its claim highlights overlaid.
 * Consecutive pieces carrying the same claims join into one button, so a
 * highlight that crosses a bold run is still a single press.
 */
function InlineView({
  inline,
  anchors,
  claimsById,
  onOpen,
}: {
  inline: InlineSegment[]
  anchors: ClaimAnchor[]
  claimsById: Map<string, ClaimRow>
  onOpen: (claimIds: string[]) => void
}) {
  const pieces = overlayAnchors(inline, anchors)

  const runs: { claimIds: string[]; pieces: AnchoredSegment[] }[] = []
  for (const piece of pieces) {
    const last = runs[runs.length - 1]
    if (last && last.claimIds.join(',') === piece.claimIds.join(',')) last.pieces.push(piece)
    else runs.push({ claimIds: piece.claimIds, pieces: [piece] })
  }

  return (
    <>
      {runs.map((run, index) =>
        run.claimIds.length === 0 ? (
          <React.Fragment key={index}>
            {run.pieces.map((piece, pieceIndex) => (
              <SegmentView key={pieceIndex} segment={piece.segment} />
            ))}
          </React.Fragment>
        ) : (
          <ClaimHighlight key={index} run={run} claimsById={claimsById} onOpen={onOpen} />
        ),
      )}
    </>
  )
}

function ClaimHighlight({
  run,
  claimsById,
  onOpen,
}: {
  run: { claimIds: string[]; pieces: AnchoredSegment[] }
  claimsById: Map<string, ClaimRow>
  onOpen: (claimIds: string[]) => void
}) {
  const runClaims = run.claimIds
    .map((id) => claimsById.get(id))
    .filter((claim): claim is ClaimRow => claim !== undefined)

  const tone = runClaims.some(blocksApproval)
    ? // Unsourced and not excluded: the amber that means "this holds the gate".
      'bg-[var(--color-warning)]/15 underline decoration-[var(--color-warning)] decoration-2 underline-offset-4'
    : runClaims.every((claim) => claim.quarantined)
      ? // Excluded but deliberately still visible.
        'text-[var(--color-text-muted)] line-through decoration-2'
      : 'bg-[var(--color-accent)]/10 underline decoration-[var(--color-accent)]/60 decoration-2 underline-offset-4'

  const summary = inlineText(run.pieces.map((piece) => piece.segment)).slice(0, 80)

  return (
    /* A span with role=button, not a <button>: a native button is an atomic
       inline box whose contents cannot fragment across line boxes, so a
       sentence-length highlight would refuse to wrap and force a phone
       screen to scroll sideways. The span wraps like the prose it sits in;
       Enter and Space activate it as a button would. The padding + negative
       margin buys the 40px hit target (section 11.1) without disturbing the
       line flow, and the visual highlight lives on the inner span so the
       padding stays invisible. */
    <span
      role="button"
      tabIndex={0}
      onClick={() => onOpen(run.claimIds)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(run.claimIds)
        }
      }}
      aria-label={`Review claim: ${summary}`}
      className="-my-[9px] cursor-pointer py-[9px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
    >
      <span className={`rounded-[2px] ${tone}`}>
        {run.pieces.map((piece, pieceIndex) => (
          <SegmentView key={pieceIndex} segment={piece.segment} />
        ))}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Claim rows and their actions (unchanged behaviour, re-housed)
// ---------------------------------------------------------------------------

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
