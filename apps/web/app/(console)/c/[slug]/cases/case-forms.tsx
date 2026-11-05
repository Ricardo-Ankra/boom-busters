'use client'

import type { CaseSummary } from '@boom-busters/db'
import { Pencil } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/input'
import { addCase, editCase } from './actions'
import { joinPeople, joinSourceLinks, splitPeople, splitSourceLinks } from './case-details'
import type { Run } from './search-brief-panel'

/**
 * The case forms: `Edit details` in the panel footer and the Add case form in
 * the panel area. Fields are full width on a phone and take a fixed width from
 * `sm`, so nothing overflows a 390px screen.
 */

export interface CaseCategoryOption {
  key: string
  label: string
}

const TEXTAREA_CLASS =
  'min-h-[80px] w-full rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] ' +
  'px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'

/** The Subject box, shared by the add and edit forms. */
function SubjectField({
  idPrefix,
  subject,
  onSubject,
}: {
  idPrefix: string
  subject: string
  onSubject: (value: string) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${idPrefix}-subject`}>Subject</Label>
      <Input
        id={`${idPrefix}-subject`}
        value={subject}
        placeholder="As people search for it, e.g. Iomega"
        onChange={(event) => onSubject(event.target.value)}
        className="w-full sm:w-64"
      />
    </div>
  )
}

/** People and Source links: the two other fields the dossier reads. */
function PeopleAndLinksFields({
  idPrefix,
  people,
  onPeople,
  links,
  onLinks,
}: {
  idPrefix: string
  people: string
  onPeople: (value: string) => void
  links: string
  onLinks: (value: string) => void
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-people`}>People</Label>
        <Input
          id={`${idPrefix}-people`}
          value={people}
          placeholder="Full names, separated by commas"
          onChange={(event) => onPeople(event.target.value)}
          className="w-full sm:w-72"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-links`}>Source links</Label>
        <textarea
          id={`${idPrefix}-links`}
          value={links}
          rows={3}
          placeholder="One web address per line, starting with http:// or https://"
          onChange={(event) => onLinks(event.target.value)}
          className={`${TEXTAREA_CLASS} sm:w-96`}
        />
      </div>
    </>
  )
}

/** The `Edit details` form on a case: the same three fields, saved with `editCase`. */
export function EditDetails({ item, run }: { item: CaseSummary; run: Run }) {
  const [open, setOpen] = React.useState(false)
  const [subject, setSubject] = React.useState(item.subject ?? '')
  const [people, setPeople] = React.useState(joinPeople(item.people))
  const [links, setLinks] = React.useState(joinSourceLinks(item.sourceLinks))
  const [busy, setBusy] = React.useState(false)

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden />
        Edit details
      </Button>
    )
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-3 rounded-[8px] border border-[var(--color-border)] p-3">
      <SubjectField idPrefix={`edit-${item.id}`} subject={subject} onSubject={setSubject} />
      <PeopleAndLinksFields
        idPrefix={`edit-${item.id}`}
        people={people}
        onPeople={setPeople}
        links={links}
        onLinks={setLinks}
      />
      <Button
        variant="primary"
        busy={busy}
        onClick={async () => {
          setBusy(true)
          try {
            // A link keeps the note it came with when its address is left alone.
            const notes = new Map(item.sourceLinks.map((link) => [link.url, link.note]))
            const sourceLinks = splitSourceLinks(links).map(({ url }) => {
              const note = notes.get(url)
              return note === undefined ? { url } : { url, note }
            })
            const ok = await run(
              () => editCase(item.id, { subject, people: splitPeople(people), sourceLinks }),
              'Details saved',
            )
            if (ok) setOpen(false)
          } finally {
            setBusy(false)
          }
        }}
      >
        Save details
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </Button>
    </div>
  )
}

/** The Add case form, shown in the panel area. `onClose` runs on Cancel and after a save. */
export function AddCaseForm({
  channelId,
  categories,
  run,
  onClose,
}: {
  channelId: string
  categories: readonly CaseCategoryOption[]
  run: Run
  onClose: () => void
}) {
  const [subject, setSubject] = React.useState('')
  // Title follows the subject until the owner types in it themselves.
  const [title, setTitle] = React.useState('')
  const [titleTouched, setTitleTouched] = React.useState(false)
  const [category, setCategory] = React.useState<string>(categories[0]?.key ?? '')
  const [angle, setAngle] = React.useState('')
  const [people, setPeople] = React.useState('')
  const [links, setLinks] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const headingId = React.useId()

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <h2 id={headingId} className="text-[20px] font-semibold">
        Add a case
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <SubjectField
          idPrefix="case"
          subject={subject}
          onSubject={(value) => {
            setSubject(value)
            if (!titleTouched) setTitle(value)
          }}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="case-angle">Angle idea</Label>
          <Input
            id="case-angle"
            value={angle}
            placeholder="Optional: your own take, in your words"
            onChange={(event) => setAngle(event.target.value)}
            className="w-full sm:w-72"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="case-title">Title</Label>
          <Input
            id="case-title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
              setTitleTouched(event.target.value !== '')
            }}
            className="w-full sm:w-64"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="case-category">Category</Label>
          <Select
            id="case-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="w-full sm:w-40"
          >
            {categories.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <PeopleAndLinksFields
          idPrefix="case"
          people={people}
          onPeople={setPeople}
          links={links}
          onLinks={setLinks}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          busy={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const ok = await run(
                () =>
                  addCase(channelId, {
                    title,
                    category,
                    angle: angle || undefined,
                    subject,
                    people: splitPeople(people),
                    sourceLinks: splitSourceLinks(links),
                  }),
                'Case added to your backlog',
              )
              if (ok) onClose()
            } finally {
              setBusy(false)
            }
          }}
        >
          Save case
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </section>
  )
}
