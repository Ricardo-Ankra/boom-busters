'use client'

import {
  REFERENCE_PURPOSES,
  type ReferencePurpose,
  type ReferenceReading,
  type ReferenceReadingEdit,
} from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input, Label, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { MOTION_GUIDELINE_FULL, MOTION_GUIDELINE_SHORT } from '@/lib/motion-guideline'
import {
  archiveReferenceAction,
  readReferenceAction,
  saveReadingAction,
  updateReferenceAction,
} from './motion-actions'
import { ReferenceMarker, type MarkerMode } from './reference-marker'

/**
 * The References section of the Motion tab (spec 2026-11-04, section 11.2):
 * the guideline's short form, the pack as cards in order, and on each card
 * the buttons that edit its words, re-mark its window, read it, archive it
 * and open its sheets and reading. While a reference is being read the page
 * refreshes every few seconds, as the Bible tab polls a draft.
 */

export interface ReferenceView {
  id: string
  kind: 'image' | 'video'
  title: string
  sourceUrl: string | null
  rights: string
  purpose: ReferencePurpose
  negative: boolean
  windowStartMs: number | null
  windowEndMs: number | null
  carryOver: string
  avoid: string
  readState: 'unread' | 'reading' | 'read' | 'failed'
  readError: string | null
  reading: ReferenceReading | null
  /** The first dense frame, presigned; null without storage. */
  thumbUrl: string | null
  denseSheetUrl: string | null
  contactSheetUrl: string | null
  /** The original clip, presigned, so Re-mark can play it; null for a still or without storage. */
  clipUrl: string | null
  contentHash: string
  durationMs: number | null
  width: number
  height: number
}

const POLL_MS = 4000
const STORAGE_LINE = 'Reference uploads need R2 configured; there is nowhere to store them.'
const mutedClass = 'text-[12px] text-[var(--color-text-muted)]'
const textareaClass =
  'min-h-[56px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50'

const windowLabel = (reference: ReferenceView) =>
  reference.windowStartMs !== null && reference.windowEndMs !== null
    ? `${(reference.windowStartMs / 1000).toFixed(1)} to ${(reference.windowEndMs / 1000).toFixed(1)} s`
    : 'still'

function readStateLine(reference: ReferenceView): {
  text: string
  tone: 'muted' | 'warning' | 'success' | 'danger'
} {
  switch (reference.readState) {
    case 'unread':
      return { text: 'Unread', tone: 'muted' }
    case 'reading':
      return { text: 'Reading...', tone: 'warning' }
    case 'read':
      return { text: 'Read', tone: 'success' }
    case 'failed':
      return { text: `Failed: ${reference.readError ?? 'unknown'}`, tone: 'danger' }
  }
}

const READING_FIELDS: { key: keyof ReferenceReadingEdit; label: string }[] = [
  { key: 'medium', label: 'Medium' },
  { key: 'palette', label: 'Palette' },
  { key: 'type', label: 'Type' },
  { key: 'enters', label: 'Enters' },
  { key: 'exits', label: 'Exits' },
  { key: 'motion', label: 'Motion' },
  { key: 'absent', label: 'Absent' },
  { key: 'notes', label: 'Notes' },
]

function editOf(reading: ReferenceReading): Record<keyof ReferenceReadingEdit, string> {
  return {
    medium: reading.medium,
    palette: reading.palette.join('\n'),
    type: reading.type,
    enters: reading.enters,
    exits: reading.exits,
    motion: reading.motion,
    absent: reading.absent,
    notes: reading.notes,
  }
}

function GuidelineDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog label="The reference guideline" onClose={onClose}>
      <div className="flex flex-col gap-3 text-[13px]">
        {MOTION_GUIDELINE_FULL.map((section) => (
          <section key={section.heading} className="flex flex-col gap-1">
            <h3 className="text-[13px] font-semibold">{section.heading}</h3>
            {section.lines.map((line) => (
              <p key={line} className="text-[var(--color-text-secondary)]">
                {line}
              </p>
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  )
}

function ReadingBlock({
  channelId,
  reference,
  disabled,
  onSaved,
}: {
  channelId: string
  reference: ReferenceView
  disabled: boolean
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [draft, setDraft] = React.useState<Record<keyof ReferenceReadingEdit, string> | null>(null)
  const reading = reference.reading
  if (!reading) return <p className={mutedClass}>No reading yet.</p>

  const save = async () => {
    if (!draft) return
    setBusy(true)
    try {
      const result = await saveReadingAction(channelId, {
        id: reference.id,
        reading: {
          medium: draft.medium.trim(),
          palette: draft.palette
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          type: draft.type.trim(),
          enters: draft.enters.trim(),
          exits: draft.exits.trim(),
          motion: draft.motion.trim(),
          absent: draft.absent.trim(),
          notes: draft.notes.trim(),
        },
      })
      if (!result.ok) {
        toast({ title: 'Could not save the reading', description: result.error, variant: 'error' })
        return
      }
      setEditing(false)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  if (editing && draft) {
    return (
      <div className="flex flex-col gap-2">
        {READING_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex flex-col gap-1">
            <Label htmlFor={`reading-${reference.id}-${key}`}>{label}</Label>
            <textarea
              id={`reading-${reference.id}-${key}`}
              className={textareaClass}
              value={draft[key]}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
            {key === 'palette' ? (
              <p className={mutedClass}>One colour per line, up to six.</p>
            ) : null}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            Save reading
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <dl className="grid gap-1 text-[13px] sm:grid-cols-[120px_1fr]">
        {READING_FIELDS.map(({ key, label }) => (
          <React.Fragment key={key}>
            <dt className="text-[var(--color-text-muted)]">{label}</dt>
            <dd className="text-[var(--color-text-secondary)]">
              {key === 'palette' ? reading.palette.join(', ') || 'none' : reading[key] || 'none'}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      <p className={mutedClass}>
        Read by {reading.model} on {new Date(reading.readAt).toLocaleDateString('en-GB')}
        {reading.editedAt ? ', edited since' : ''}.
      </p>
      <div>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => {
            setDraft(editOf(reading))
            setEditing(true)
          }}
        >
          Edit reading
        </Button>
      </div>
    </div>
  )
}

function WordsForm({
  channelId,
  reference,
  onDone,
}: {
  channelId: string
  reference: ReferenceView
  onDone: () => void
}) {
  const { toast } = useToast()
  const [busy, setBusy] = React.useState(false)
  const [title, setTitle] = React.useState(reference.title)
  const [sourceUrl, setSourceUrl] = React.useState(reference.sourceUrl ?? '')
  const [rights, setRights] = React.useState(reference.rights)
  const [purpose, setPurpose] = React.useState<ReferencePurpose>(reference.purpose)
  const [negative, setNegative] = React.useState(reference.negative)
  const [carryOver, setCarryOver] = React.useState(reference.carryOver)
  const [avoid, setAvoid] = React.useState(reference.avoid)

  const save = async () => {
    setBusy(true)
    try {
      const result = await updateReferenceAction(channelId, {
        id: reference.id,
        input: {
          title: title.trim(),
          sourceUrl: sourceUrl.trim(),
          rights: rights.trim(),
          purpose,
          negative,
          carryOver: carryOver.trim(),
          avoid: avoid.trim(),
        },
      })
      if (!result.ok) {
        toast({
          title: 'Could not save the reference',
          description: result.error,
          variant: 'error',
        })
        return
      }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  const id = (field: string) => `reference-${reference.id}-${field}`
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id('title')}>Title</Label>
        <Input
          id={id('title')}
          value={title}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id('purpose')}>Purpose</Label>
        <Select
          id={id('purpose')}
          value={purpose}
          disabled={busy}
          onChange={(e) => setPurpose(e.target.value as ReferencePurpose)}
        >
          {REFERENCE_PURPOSES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id('source')}>Source link and whose work it is</Label>
        <Input
          id={id('source')}
          value={sourceUrl}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id('rights')}>Rights</Label>
        <Input
          id={id('rights')}
          value={rights}
          maxLength={200}
          disabled={busy}
          onChange={(e) => setRights(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={id('carry-over')}>Carry over</Label>
        <textarea
          id={id('carry-over')}
          className={textareaClass}
          value={carryOver}
          maxLength={300}
          disabled={busy}
          onChange={(e) => setCarryOver(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1 sm:col-span-2">
        <Label htmlFor={id('avoid')}>Avoid</Label>
        <textarea
          id={id('avoid')}
          className={textareaClass}
          value={avoid}
          maxLength={300}
          disabled={busy}
          onChange={(e) => setAvoid(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Switch
          id={id('negative')}
          checked={negative}
          disabled={busy}
          onCheckedChange={setNegative}
        />
        <Label htmlFor={id('negative')}>This is a negative: what the channel must not do</Label>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button
          variant="primary"
          busy={busy}
          disabled={title.trim() === '' || carryOver.trim() === ''}
          onClick={() => void save()}
        >
          Save
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ReferenceCard({
  channelId,
  reference,
  disabled,
  onRemark,
}: {
  channelId: string
  reference: ReferenceView
  disabled: boolean
  onRemark: () => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const state = readStateLine(reference)

  const read = async () => {
    setBusy(true)
    try {
      const result = await readReferenceAction(channelId, reference.id)
      if (!result.ok) {
        toast({ title: 'Could not start the read', description: result.error, variant: 'error' })
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const archive = async () => {
    const result = await archiveReferenceAction(channelId, reference.id)
    if (!result.ok) {
      toast({
        title: 'Could not archive the reference',
        description: result.error,
        variant: 'error',
      })
      return
    }
    router.refresh()
  }

  return (
    <li className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
      <div className="flex gap-3">
        <div className="h-[72px] w-[128px] shrink-0 overflow-hidden rounded-[4px] bg-[var(--color-background)]">
          {reference.thumbUrl ? (
            <img
              src={reference.thumbUrl}
              alt={`First frame of ${reference.title}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <p className={`${mutedClass} p-2`}>No preview</p>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">{reference.title}</span>
            <Badge>{reference.purpose}</Badge>
            {reference.negative ? <Badge tone="warning">negative</Badge> : null}
            <Badge tone="muted">{windowLabel(reference)}</Badge>
          </div>
          <p className="text-[13px] text-[var(--color-text-secondary)]">{reference.carryOver}</p>
          {reference.avoid ? <p className={mutedClass}>Avoid: {reference.avoid}</p> : null}
          <Badge tone={state.tone}>{state.text}</Badge>
        </div>
      </div>
      {editing ? (
        <WordsForm
          channelId={channelId}
          reference={reference}
          onDone={() => {
            setEditing(false)
            router.refresh()
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || busy} onClick={() => setEditing(true)}>
            Edit
          </Button>
          {reference.kind === 'video' ? (
            <Button variant="outline" disabled={disabled || busy} onClick={onRemark}>
              Re-mark
            </Button>
          ) : null}
          {reference.readState === 'unread' || reference.readState === 'failed' ? (
            <Button
              variant="outline"
              disabled={disabled || busy}
              busy={busy}
              onClick={() => void read()}
            >
              Read
            </Button>
          ) : null}
          <ConfirmButton
            label="Archive"
            confirmLabel="Archive for good"
            consequence="The reference leaves the pack; its files are kept."
            disabled={disabled || busy}
            onConfirm={archive}
          />
          <Button variant="ghost" disabled={busy} onClick={() => setOpen((value) => !value)}>
            Details
          </Button>
        </div>
      )}
      {open ? (
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
          {reference.contactSheetUrl ? (
            <img
              src={reference.contactSheetUrl}
              alt={`Contact sheet of ${reference.title}`}
              className="w-full rounded-[4px]"
            />
          ) : null}
          {reference.denseSheetUrl ? (
            <img
              src={reference.denseSheetUrl}
              alt={`Dense sheet of ${reference.title}`}
              className="w-full rounded-[4px]"
            />
          ) : (
            <p className={mutedClass}>No sheets yet.</p>
          )}
          <ReadingBlock
            channelId={channelId}
            reference={reference}
            disabled={disabled}
            onSaved={() => router.refresh()}
          />
        </div>
      ) : null}
    </li>
  )
}

export function ReferencesSection({
  channelId,
  references,
  storageReady,
  readingEstimateUsd,
  archived,
}: {
  channelId: string
  references: readonly ReferenceView[]
  storageReady: boolean
  readingEstimateUsd: number
  archived: boolean
}) {
  const router = useRouter()
  const [guideline, setGuideline] = React.useState(false)
  const [marker, setMarker] = React.useState<MarkerMode | null>(null)

  const reading = references.some((reference) => reference.readState === 'reading')
  React.useEffect(() => {
    if (!reading) return
    const timer = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [reading, router])

  return (
    <Card>
      <CardHeader>
        <CardTitle>References</CardTitle>
        <CardDescription>
          The stills and clips this channel&apos;s motion is built from. Their pixels never enter a
          film.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] text-[var(--color-text-secondary)]">
          {MOTION_GUIDELINE_SHORT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={archived || !storageReady}
            onClick={() => setMarker({ kind: 'add' })}
          >
            Add reference
          </Button>
          <Button variant="ghost" onClick={() => setGuideline(true)}>
            Read the full guideline
          </Button>
          {!storageReady ? <span className={mutedClass}>{STORAGE_LINE}</span> : null}
        </div>
        {references.length === 0 ? (
          <p className={mutedClass}>No references yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {references.map((reference) => (
              <ReferenceCard
                key={reference.id}
                channelId={channelId}
                reference={reference}
                disabled={archived}
                onRemark={() => setMarker({ kind: 'remark', reference })}
              />
            ))}
          </ul>
        )}
      </CardContent>
      {guideline ? <GuidelineDialog onClose={() => setGuideline(false)} /> : null}
      {marker ? (
        <ReferenceMarker
          channelId={channelId}
          mode={marker}
          storageReady={storageReady}
          readingEstimateUsd={readingEstimateUsd}
          onClose={() => setMarker(null)}
        />
      ) : null}
    </Card>
  )
}
