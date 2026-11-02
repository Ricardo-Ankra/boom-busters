'use client'

import { BIBLE_SECTIONS, BIBLE_SECTION_LABELS, BIBLE_SECTION_ORDER } from '@boom-busters/schemas'
import type { BibleDraft, BibleSection, ChannelBible } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/confirm-button'
import { Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { copyBibleFromChannelAction } from './bible-actions'

/** A channel the bible can be copied from. */
export interface CopySource {
  id: string
  name: string
  archived: boolean
  /** The source's current bible version number. */
  version: number
}

/** The sections whose keys differ between two bibles. */
function differingSections(a: ChannelBible, b: ChannelBible): BibleSection[] {
  return BIBLE_SECTION_ORDER.filter((section) =>
    BIBLE_SECTIONS[section].some((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])),
  )
}

/**
 * "Copy from another channel": replaces the chosen sections of the working
 * draft with another channel's current saved version. Nothing is saved as a
 * version; every copied section comes back marked drafted.
 */
export function CopyFromChannel({
  channelId,
  sources,
  draft,
  currentBible,
  disabled,
  onCopied,
}: {
  channelId: string
  /** Every other channel, archived ones included. */
  sources: CopySource[]
  draft: BibleDraft | null
  /** The saved bible the channel runs on: the draft's base when there is no draft. */
  currentBible: ChannelBible
  /** A run works on the draft or an action is in flight. */
  disabled: boolean
  onCopied: (draft: BibleDraft, note: string) => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [sourceId, setSourceId] = React.useState('')
  const [ticked, setTicked] = React.useState<Set<BibleSection>>(new Set(BIBLE_SECTION_ORDER))

  const locked = disabled || busy
  const chosen = BIBLE_SECTION_ORDER.filter((section) => ticked.has(section))
  const canCopy = sourceId !== '' && chosen.length > 0

  const overwritten = draft
    ? differingSections(draft.bible, currentBible).filter((section) => ticked.has(section))
    : []

  const toggle = (section: BibleSection) =>
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })

  const copy = async () => {
    setBusy(true)
    try {
      const result = await copyBibleFromChannelAction(channelId, sourceId, chosen)
      if (!result.ok) {
        toast({ title: 'Could not copy', description: result.error, variant: 'error' })
        return
      }
      if (result.draft) onCopied(result.draft, result.note ?? '')
      setOpen(false)
      setSourceId('')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
          Copy from another channel
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="copy-source">Channel to copy from</Label>
        <Select
          id="copy-source"
          value={sourceId}
          disabled={locked}
          onChange={(event) => setSourceId(event.target.value)}
        >
          <option value="">Choose a channel</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
              {source.archived ? ' (archived)' : ''}, version {source.version}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={locked}>
        <legend className="mb-1 text-[13px] font-medium text-[var(--color-text-secondary)]">
          Sections to copy
        </legend>
        {BIBLE_SECTION_ORDER.map((section) => (
          <label
            key={section}
            className="flex items-center gap-2 text-[14px] text-[var(--color-text-primary)]"
          >
            <input
              type="checkbox"
              className="size-4"
              checked={ticked.has(section)}
              onChange={() => toggle(section)}
            />
            {BIBLE_SECTION_LABELS[section]}
          </label>
        ))}
      </fieldset>

      <p className="text-[13px] text-[var(--color-text-secondary)]">
        The copy goes into the draft and nothing is saved. Each copied section needs your approval
        before you can save.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {overwritten.length > 0 ? (
          <ConfirmButton
            label="Copy"
            confirmLabel="Copy"
            variant="primary"
            confirmVariant="primary"
            consequence={`This overwrites ${overwritten
              .map((section) => BIBLE_SECTION_LABELS[section])
              .join(', ')} in the draft.`}
            disabled={locked || !canCopy}
            onConfirm={copy}
          />
        ) : (
          <Button
            variant="primary"
            disabled={locked || !canCopy}
            busy={busy}
            onClick={() => void copy()}
          >
            Copy
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
