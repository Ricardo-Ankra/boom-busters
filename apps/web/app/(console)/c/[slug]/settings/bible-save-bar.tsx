'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { ConfirmButton } from '@/components/confirm-button'
import { Input, Label } from '@/components/ui/input'

/**
 * The bar along the bottom while a Bible draft is open: what saving will make,
 * what still stops it, the version note, Save and Discard. The blockers show
 * even when the bar is held (archived, or a run working on the draft).
 */
export function BibleSaveBar({
  nextVersion,
  blockers,
  note,
  onNote,
  disabled,
  onSave,
  onDiscard,
}: {
  nextVersion: number
  blockers: string[]
  note: string
  onNote: (note: string) => void
  disabled: boolean
  onSave: () => void
  onDiscard: () => Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const blocked = blockers.length > 0

  return (
    <section
      aria-label="Unsaved draft"
      className="sticky bottom-0 z-20 flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg"
    >
      {blocked && open ? (
        <ul id={listId} className="list-disc pl-5 text-[13px] text-[var(--color-warning)]">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <p
            className={
              blocked ? 'text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]'
            }
          >
            {blocked
              ? `Unsaved draft. ${blockers.length === 1 ? '1 thing' : `${blockers.length} things`} to fix before saving.`
              : `Unsaved draft. Saving makes version ${nextVersion}.`}
          </p>
          {blocked ? (
            <Button
              variant="ghost"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? 'Hide' : 'Show what to fix'}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bible-note">Version note</Label>
            <Input
              id="bible-note"
              value={note}
              maxLength={300}
              disabled={disabled}
              placeholder="Edited in the Bible tab"
              onChange={(event) => onNote(event.target.value)}
            />
          </div>
          <Button variant="primary" disabled={disabled || blocked} onClick={onSave}>
            Save
          </Button>
          <ConfirmButton
            label="Discard draft"
            confirmLabel="Discard draft"
            consequence="The draft is thrown away. The saved version is not touched."
            disabled={disabled}
            onConfirm={onDiscard}
          />
        </div>
      </div>
    </section>
  )
}
