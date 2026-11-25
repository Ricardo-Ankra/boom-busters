'use client'

import { ImagePlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { THUMB_REFERENCES_MAX } from '@boom-busters/schemas'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import {
  removeThumbnailReference,
  saveThumbnailReference,
  saveThumbnailStyle,
  uploadThumbnailReference,
} from './thumbnail-reference-actions'

/**
 * The channel's thumbnail references: up to six pictures the owner kept as
 * style examples, three of them in use at a time, plus a style note and the
 * corner the channel mark takes on a generated thumbnail. The image model is
 * shown the in-use pictures as style references; they are never published.
 *
 * Every field keeps a local draft and saves with its own button, so nothing
 * here copies a prop into state after the first render.
 */

export type MarkPlacement = 'none' | 'tl' | 'tr' | 'bl'

export interface ThumbnailReferenceView {
  id: string
  note: string
  inUse: boolean
  /** Presigned GET, or null when no storage is configured. */
  url: string | null
}

/** Bottom right is not offered: YouTube draws the duration there. */
const CORNERS: { value: MarkPlacement; label: string }[] = [
  { value: 'tl', label: 'Top left' },
  { value: 'tr', label: 'Top right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'none', label: 'None' },
]

const TEXTAREA_CLASS =
  'min-h-24 w-full rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] ' +
  'px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
  'disabled:cursor-not-allowed disabled:opacity-50'

type Outcome = { ok: boolean; error?: string }

export function ThumbnailsTab({
  slug,
  styleNote,
  markPlacement,
  references,
}: {
  slug: string
  styleNote: string
  markPlacement: MarkPlacement
  references: ThumbnailReferenceView[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const fileRef = React.useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [noteDraft, setNoteDraft] = React.useState(styleNote)
  const [cornerDraft, setCornerDraft] = React.useState<MarkPlacement>(markPlacement)
  // What the server last accepted, so Save wakes only for a real change.
  const [savedStyle, setSavedStyle] = React.useState({ styleNote, markPlacement })

  const run = async (work: () => Promise<Outcome>, success: string): Promise<boolean> => {
    setBusy(true)
    try {
      const result = await work()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
      } else {
        toast({ title: 'That did not work', description: result.error, variant: 'error' })
      }
      return result.ok
    } catch {
      toast({
        title: 'That did not work',
        description: 'The request never reached the server. Try again.',
        variant: 'error',
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  const styleChanged =
    noteDraft.trim() !== savedStyle.styleNote.trim() || cornerDraft !== savedStyle.markPlacement
  const full = references.length >= THUMB_REFERENCES_MAX

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Thumbnail style</CardTitle>
          <CardDescription>
            A few plain words on how this channel&apos;s thumbnails should look, and where the
            channel mark sits on them.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="space-y-1">
            <Label htmlFor="thumbnail-style-note">Style note</Label>
            <textarea
              id="thumbnail-style-note"
              className={TEXTAREA_CLASS}
              value={noteDraft}
              maxLength={600}
              placeholder="One face, big flat colour, four words at most"
              onChange={(event) => setNoteDraft(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="thumbnail-mark-corner">Mark on thumbnails</Label>
            <Select
              id="thumbnail-mark-corner"
              value={cornerDraft}
              className="sm:w-48"
              onChange={(event) => setCornerDraft(event.target.value as MarkPlacement)}
            >
              {CORNERS.map((corner) => (
                <option key={corner.value} value={corner.value}>
                  {corner.label}
                </option>
              ))}
            </Select>
            <p className="text-[12px] text-[var(--color-text-muted)]">
              Bottom right is where YouTube draws the duration.
            </p>
          </div>
          <div>
            <Button
              disabled={busy || !styleChanged}
              onClick={() =>
                void run(async () => {
                  const result = await saveThumbnailStyle(slug, {
                    styleNote: noteDraft,
                    markPlacement: cornerDraft,
                  })
                  if (result.ok) {
                    setSavedStyle({ styleNote: noteDraft, markPlacement: cornerDraft })
                  }
                  return result
                }, 'Thumbnail style saved')
              }
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reference thumbnails</CardTitle>
          <CardDescription>
            Up to six pictures, PNG, JPEG or WebP, 8 MB or less each. Switch on up to three to show
            the image model as style references.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            aria-label="Choose a reference thumbnail"
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              event.target.value = ''
              if (!chosen) return
              const data = new FormData()
              data.set('slug', slug)
              data.set('file', chosen)
              void run(() => uploadThumbnailReference(data), 'Reference added')
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={busy || full}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus aria-hidden />
              Add a reference thumbnail
            </Button>
            {full ? (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                Six reference thumbnails at most. Remove one first.
              </span>
            ) : null}
          </div>

          {references.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-muted)]">No references yet.</p>
          ) : (
            <ul aria-label="Reference thumbnails" className="grid gap-3 sm:grid-cols-2">
              {references.map((reference, index) => (
                <ReferenceCard
                  key={reference.id}
                  slug={slug}
                  reference={reference}
                  position={index + 1}
                  busy={busy}
                  run={run}
                />
              ))}
            </ul>
          )}
          <p className="text-[12px] text-[var(--color-text-muted)]">
            References steer the look. They are never published and never copied.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function ReferenceCard({
  slug,
  reference,
  position,
  busy,
  run,
}: {
  slug: string
  reference: ThumbnailReferenceView
  position: number
  busy: boolean
  run: (work: () => Promise<Outcome>, success: string) => Promise<boolean>
}) {
  const [note, setNote] = React.useState(reference.note)
  const [savedNote, setSavedNote] = React.useState(reference.note)
  const [inUse, setInUse] = React.useState(reference.inUse)
  const noteId = `thumbnail-note-${reference.id}`
  const switchId = `thumbnail-in-use-${reference.id}`

  return (
    <li
      aria-label={`Reference ${position}`}
      className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] p-3"
    >
      <div className="grid aspect-video place-items-center overflow-hidden rounded-[8px] bg-[var(--color-background)]">
        {reference.url ? (
          <img
            src={reference.url}
            alt={`Reference thumbnail ${position}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-[12px] text-[var(--color-text-muted)]">
            No preview in mock storage
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={switchId}
          checked={inUse}
          disabled={busy}
          onCheckedChange={(next) => {
            const before = inUse
            setInUse(next)
            void run(
              async () => {
                const result = await saveThumbnailReference(slug, reference.id, { inUse: next })
                if (!result.ok) setInUse(before)
                return result
              },
              next ? 'Reference in use' : 'Reference set aside',
            )
          }}
        />
        <Label htmlFor={switchId}>In use</Label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1 space-y-1">
          <Label htmlFor={noteId}>Note</Label>
          <Input
            id={noteId}
            value={note}
            maxLength={200}
            placeholder="What to take from this one"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={busy || note.trim() === savedNote.trim()}
          onClick={() =>
            void run(async () => {
              const result = await saveThumbnailReference(slug, reference.id, { note })
              if (result.ok) setSavedNote(note)
              return result
            }, 'Note saved')
          }
        >
          Save note
        </Button>
        <ConfirmButton
          variant="ghost"
          label="Remove"
          confirmLabel="Remove reference"
          consequence="The picture leaves this channel's references; thumbnails already made are not changed."
          disabled={busy}
          onConfirm={() =>
            run(() => removeThumbnailReference(slug, reference.id), 'Reference removed')
          }
        />
      </div>
    </li>
  )
}
