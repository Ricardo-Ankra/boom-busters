'use client'

import {
  EXAMPLE_SLOTS,
  SLOT_STAGES,
  SLOT_STAGE_LABELS,
  examplesWritten,
  slotStage,
} from '@boom-busters/schemas'
import type { ExampleSlot, SlotStage, TooCloseFlags } from '@boom-busters/schemas'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/input'
import { FlagNote, mutedClass, textareaClass } from './bible-fields'

/**
 * The examples, grouped by the pipeline stage that reads them. Both the view
 * and the editor share the summary line, the stage groups and "Next missing";
 * they differ in what one slot shows.
 */

const labelClass = 'text-[13px] font-medium text-[var(--color-text-secondary)]'

const isBlank = (text: string | undefined) => (text ?? '').trim() === ''

const GROUPS: { stage: SlotStage; slots: ExampleSlot[] }[] = SLOT_STAGES.map((stage) => ({
  stage,
  slots: EXAMPLE_SLOTS.filter((slot) => slotStage(slot) === stage),
}))

/** The registered slots only, in registry order, from whatever the bible holds. */
function registeredOnly(examples: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    EXAMPLE_SLOTS.filter((slot) => slot.id in examples).map((slot) => [
      slot.id,
      examples[slot.id]!,
    ]),
  )
}

function ExamplesGroups({
  examples,
  flags,
  renderSlot,
}: {
  examples: Record<string, string>
  flags: TooCloseFlags
  renderSlot: (slot: ExampleSlot, describedBy: string) => React.ReactNode
}) {
  const id = React.useId()
  const root = React.useRef<HTMLDivElement>(null)
  const total = EXAMPLE_SLOTS.length
  const written = examplesWritten(examples)

  const needsOwner = (slots: ExampleSlot[]) =>
    slots.some((slot) => isBlank(examples[slot.id]) || flags[`examples.${slot.id}`] !== undefined)
  // A group starts open when it has a gap or a flag; the owner's toggling wins after that.
  const [open, setOpen] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((group) => [group.stage, needsOwner(group.slots)])),
  )

  const nextMissing = () => {
    for (const group of GROUPS) {
      const slot = group.slots.find((it) => isBlank(examples[it.id]))
      if (!slot) continue
      setOpen((prev) => ({ ...prev, [group.stage]: true }))
      requestAnimationFrame(() => {
        root.current?.querySelector<HTMLElement>(`[data-slot-focus="${slot.id}"]`)?.focus()
      })
      return
    }
  }

  return (
    <div ref={root} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[14px]">
          {written === total
            ? `All ${total} examples written`
            : `${written} of ${total} examples written`}
        </p>
        {written < total ? (
          <Button variant="outline" onClick={nextMissing}>
            Next missing
          </Button>
        ) : null}
      </div>
      {GROUPS.map((group) => {
        const done = group.slots.filter((slot) => !isBlank(examples[slot.id])).length
        return (
          <details
            key={group.stage}
            open={open[group.stage]}
            onToggle={(event) => {
              const next = event.currentTarget.open
              setOpen((prev) =>
                prev[group.stage] === next ? prev : { ...prev, [group.stage]: next },
              )
            }}
            className="rounded-[8px] border border-[var(--color-border)]"
          >
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-3 px-4 py-3">
              <h4 className="text-[14px] font-medium">{SLOT_STAGE_LABELS[group.stage]}</h4>
              <span className={mutedClass}>
                {done} of {group.slots.length} written
              </span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-[var(--color-border)] p-4">
              {group.slots.map((slot) => (
                <div key={slot.id} className="flex flex-col gap-1.5">
                  {renderSlot(slot, `${id}-${slot.id}-teaches`)}
                  <FlagNote flags={flags} path={`examples.${slot.id}`} />
                </div>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}

/** The examples, read-only. A slot with no example offers to draft it alone. */
export function ExamplesView({
  examples,
  flags,
  disabled,
  onDraftSlot,
}: {
  examples: Record<string, string>
  flags: TooCloseFlags
  disabled: boolean
  onDraftSlot: (slotId: string) => void
}) {
  return (
    <ExamplesGroups
      examples={examples}
      flags={flags}
      renderSlot={(slot, describedBy) => {
        const text = examples[slot.id]
        return (
          <>
            <span className={labelClass}>{slot.title}</span>
            <p id={describedBy} className={mutedClass}>
              {slot.teaches}
            </p>
            {isBlank(text) ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className={mutedClass}>No example yet</span>
                <Button
                  variant="outline"
                  disabled={disabled}
                  data-slot-focus={slot.id}
                  aria-label={`Draft ${slot.title}`}
                  onClick={() => onDraftSlot(slot.id)}
                >
                  Draft
                </Button>
              </div>
            ) : (
              <p className="text-[14px] whitespace-pre-wrap">{text}</p>
            )}
          </>
        )
      }}
    />
  )
}

/** The examples, one box per slot. `onChange` carries registered slot ids only. */
export function ExamplesEditor({
  examples,
  flags,
  disabled,
  onChange,
}: {
  examples: Record<string, string>
  flags: TooCloseFlags
  disabled: boolean
  onChange: (next: Record<string, string>) => void
}) {
  const id = React.useId()
  return (
    <ExamplesGroups
      examples={examples}
      flags={flags}
      renderSlot={(slot, describedBy) => {
        const text = examples[slot.id] ?? ''
        const fieldId = `${id}-${slot.id}`
        const near = text.length >= 0.9 * slot.maxLength
        return (
          <>
            <Label htmlFor={fieldId}>{slot.title}</Label>
            <p id={describedBy} className={mutedClass}>
              {slot.teaches}
            </p>
            <textarea
              id={fieldId}
              data-slot-focus={slot.id}
              aria-describedby={describedBy}
              rows={slot.kind === 'line' ? 2 : 6}
              className={textareaClass.replace('min-h-24', '')}
              value={text}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...registeredOnly(examples), [slot.id]: event.target.value })
              }
            />
            <p className={near ? 'text-[12px] text-[var(--color-warning)]' : mutedClass}>
              {text.length} of {slot.maxLength} characters
            </p>
          </>
        )
      }}
    />
  )
}
