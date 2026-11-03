'use client'

import { BIBLE_SECTION_LABELS, sectionIsEmpty, sectionProgress } from '@boom-busters/schemas'
import type {
  BibleSection,
  BibleSectionStatus,
  ChannelBible,
  TooCloseFlags,
} from '@boom-busters/schemas'
import { Check, Circle, CircleDot } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { MeasureButton } from './bible-measure-button'
import type { KeywordReadings } from './bible-measurements'
import type { SearchSpaceView } from './bible-search-space'
import {
  NO_ISSUES,
  SectionEditor,
  SectionView,
  formPatch,
  initialFormValues,
  sectionIssues,
  type FormValues,
} from './bible-fields'

/** What the chip says: a section that holds nothing is empty whatever its status. */
export function sectionStatusLabel(
  bible: ChannelBible,
  section: BibleSection,
  status: BibleSectionStatus,
): 'Approved' | 'Drafted, not approved' | 'Empty' {
  if (sectionIsEmpty(bible, section)) return 'Empty'
  return status === 'approved' ? 'Approved' : 'Drafted, not approved'
}

const CHIP_ICON = {
  Approved: Check,
  'Drafted, not approved': CircleDot,
  Empty: Circle,
} as const

const CHIP_CLASS = {
  Approved: 'text-[var(--color-success)]',
  'Drafted, not approved': 'text-[var(--color-warning)]',
  Empty: 'text-[var(--color-text-muted)]',
} as const

/**
 * One section of the bible as a collapsible card: its status, the way to
 * redraft, approve or edit it, and its fields. The card owns the edit form;
 * the tab owns the draft and the actions, and `onEdit` says whether the save
 * went through.
 */
export function BibleSectionCard({
  section,
  bible,
  status,
  flags,
  errors,
  disabled,
  onEdit,
  onApprove,
  onRedraft,
  onDraftSlot,
  onProblems,
  readings,
  measure,
  space,
}: {
  section: BibleSection
  bible: ChannelBible
  status: BibleSectionStatus
  /** The flags that belong to this section's fields. */
  flags: TooCloseFlags
  /** Why a run could not write this section, if it could not. */
  errors: string[]
  /** A run is working on the draft, the channel is archived or an action is in flight. */
  disabled: boolean
  onEdit: (section: BibleSection, patch: Record<string, unknown>) => Promise<boolean>
  onApprove: (section: BibleSection) => void
  onRedraft: (section: BibleSection, steer?: string) => void
  onDraftSlot: (slotId: string) => void
  /** What the open form says is wrong with it, for the save bar; empty once it closes. */
  onProblems?: (section: BibleSection, problems: string[]) => void
  /** The latest VidIQ reading of each keyword, by lower-cased keyword. */
  readings?: KeywordReadings
  /** The Measure in VidIQ button: given on the cards that hold keywords. */
  measure?: { count: number; ready: boolean; onMeasure: () => void }
  /** The formats card's search-space readings and Analyse button. */
  space?: SearchSpaceView
}) {
  const label = sectionStatusLabel(bible, section, status)
  const ChipIcon = CHIP_ICON[label]
  const flagged = Object.keys(flags).length > 0
  const [editing, setEditing] = React.useState(false)
  const [steering, setSteering] = React.useState(false)
  const [steer, setSteer] = React.useState('')
  const [values, setValues] = React.useState<FormValues>({})
  // Open when the section needs the owner; the owner's own toggling wins after that.
  const [open, setOpen] = React.useState(label !== 'Approved' || errors.length > 0)

  // The schema's verdict on the form as it stands, shown under its fields and in the save bar.
  const issues = React.useMemo(
    () => (editing ? sectionIssues(section, values) : NO_ISSUES),
    [editing, section, values],
  )
  const problemKey = issues.messages.join('\n')
  React.useEffect(() => {
    onProblems?.(section, problemKey === '' ? [] : problemKey.split('\n'))
    return () => onProblems?.(section, [])
  }, [problemKey, section, onProblems])

  const startEditing = () => {
    setValues(initialFormValues(section, bible))
    setEditing(true)
    setOpen(true)
  }

  const done = async () => {
    if (await onEdit(section, formPatch(section, values))) setEditing(false)
  }

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-[8px] border border-[var(--color-border)]"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3">
        <h3 className="text-[15px] font-medium">{BIBLE_SECTION_LABELS[section]}</h3>
        <span className={`inline-flex items-center gap-1 text-[13px] ${CHIP_CLASS[label]}`}>
          <ChipIcon size={14} aria-hidden="true" />
          {label}
        </span>
        <span className="text-[13px] text-[var(--color-text-muted)]">
          {sectionProgress(bible, section)}
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-[var(--color-border)] p-4">
        {errors.map((error) => (
          <p key={error} role="alert" className="text-[13px] text-[var(--color-danger)]">
            {error}
          </p>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={disabled || editing || steering}
            aria-label={`Redraft ${BIBLE_SECTION_LABELS[section]}`}
            onClick={() => setSteering(true)}
          >
            Redraft
          </Button>
          <Button
            variant="primary"
            disabled={disabled || editing || flagged || status === 'approved'}
            aria-label={`Approve ${BIBLE_SECTION_LABELS[section]}`}
            onClick={() => onApprove(section)}
          >
            Approve
          </Button>
          {measure && !editing ? (
            <MeasureButton
              count={measure.count}
              disabled={disabled || !measure.ready}
              unavailable={!measure.ready}
              onMeasure={measure.onMeasure}
            />
          ) : null}
          {editing ? (
            <>
              <Button
                variant="primary"
                disabled={disabled || issues.messages.length > 0}
                aria-label={`Done editing ${BIBLE_SECTION_LABELS[section]}`}
                onClick={() => void done()}
              >
                Done
              </Button>
              <Button variant="ghost" disabled={disabled} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              disabled={disabled}
              aria-label={`Edit ${BIBLE_SECTION_LABELS[section]}`}
              onClick={startEditing}
            >
              Edit
            </Button>
          )}
        </div>

        {steering ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`steer-${section}`}>What should change?</Label>
            <Input
              id={`steer-${section}`}
              value={steer}
              maxLength={1000}
              placeholder="Optional"
              disabled={disabled}
              onChange={(event) => setSteer(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={disabled}
                aria-label={`Start redraft of ${BIBLE_SECTION_LABELS[section]}`}
                onClick={() => {
                  const line = steer.trim()
                  setSteering(false)
                  setSteer('')
                  onRedraft(section, line || undefined)
                }}
              >
                Start
              </Button>
              <Button variant="ghost" onClick={() => setSteering(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {flagged && !editing ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Approve stays off until the flagged lines are changed. Edit them, then press Done.
          </p>
        ) : null}

        {editing ? (
          <SectionEditor
            section={section}
            values={values}
            flags={flags}
            issues={issues}
            disabled={disabled}
            onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
          />
        ) : (
          <SectionView
            section={section}
            bible={bible}
            flags={flags}
            disabled={disabled}
            onDraftSlot={onDraftSlot}
            {...(readings ? { readings } : {})}
            {...(space ? { space } : {})}
          />
        )}
      </div>
    </details>
  )
}
