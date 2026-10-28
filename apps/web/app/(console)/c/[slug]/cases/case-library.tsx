'use client'

import type { CaseSort, CaseSummary } from '@boom-busters/db'
import { noticesFor } from '@boom-busters/schemas'
import type { Notice } from '@boom-busters/schemas'
import { Check, Pencil, Plus, Sparkles, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Notices } from '@/components/notices'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Label, NumberInput, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
import { channelHref } from '@/lib/channel-href'
import {
  acceptCase,
  addCase,
  dismissCase,
  editCase,
  setStatus,
  startProjectFromCase,
  suggestCases,
} from './actions'
import {
  joinPeople,
  joinSourceLinks,
  splitPeople,
  splitSourceLinks,
  subjectFromTitle,
} from './case-details'

/**
 * The Case Library table and its triage controls.
 *
 * Suggestions arrive as `idea` rows and are visually separated from the real
 * backlog, because the difference between "a model proposed this" and "I
 * decided to make this" is the entire point of the triage step. An accepted
 * suggestion moves down into the backlog; a dismissed one disappears.
 */

const CATEGORIES = ['collapse', 'con', 'meltdown', 'turnaround', 'empire'] as const

const STATUS_LABELS: Record<string, string> = {
  idea: 'Suggested',
  shortlisted: 'Shortlisted',
  in_production: 'In production',
  published: 'Published',
  retired: 'Retired',
}

const SORT_LABELS: Record<CaseSort, string> = {
  priority: 'Priority',
  category: 'Category',
  status: 'Status',
  newest: 'Newest',
}

export function CaseLibrary({
  slug,
  channelId,
  cases,
  sort,
  notices = [],
  bibleComplete = true,
}: {
  /** The channel whose library this is; navigation stays inside it. */
  slug: string
  /** The channel the cases belong to; new and suggested cases land in it. */
  channelId: string
  cases: CaseSummary[]
  sort: CaseSort
  /** The cases' open notices (decision 293); each row shows its own. */
  notices?: readonly Notice[]
  /** Whether the channel's bible is complete; until it is, nothing here starts work. */
  bibleComplete?: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()

  const run = React.useCallback(
    async (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
      const result = await action()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
      } else {
        toast({ title: 'That did not work', description: result.error, variant: 'error' })
      }
      return result.ok
    },
    [router, toast],
  )

  const suggestions = cases.filter((item) => item.status === 'idea')
  const backlog = cases.filter((item) => item.status !== 'idea')

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold">Case Library</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SuggestButton channelId={channelId} blocked={!bibleComplete} />
          <AddCaseButton channelId={channelId} run={run} />
        </div>
      </header>

      {bibleComplete ? null : (
        <p
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-[8px] border border-[var(--color-warning)]/40 p-3 text-[13px]"
        >
          <span>{BIBLE_INCOMPLETE_MESSAGE}.</span>
          <Button asChild variant="outline">
            <Link href={channelHref(slug, '/settings', { tab: 'channel' })}>
              Open the Channel tab
            </Link>
          </Button>
        </p>
      )}

      {suggestions.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[15px] font-medium">
            Suggested — {suggestions.length} waiting on you
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Nothing here is in the backlog yet. Accept what is worth making; dismiss the rest.
          </p>
          <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[8px] border border-[var(--color-warning)]/40">
            {suggestions.map((item) => (
              <li key={item.id}>
                <SuggestionRow
                  item={item}
                  run={run}
                  notices={noticesFor(notices, 'case', item.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-medium">Backlog</h2>
          <SortControls slug={slug} active={sort} />
        </div>

        {backlog.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-[15px]">No cases yet.</p>
              <p className="text-[13px] text-[var(--color-text-muted)]">
                Use <span className="font-medium">Suggest cases</span> to get proposals, or add one
                yourself.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[8px] border border-[var(--color-border)]">
            {backlog.map((item) => (
              <li key={item.id}>
                <BacklogRow
                  slug={slug}
                  blocked={!bibleComplete}
                  item={item}
                  run={run}
                  notices={noticesFor(notices, 'case', item.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SortControls({ slug, active }: { slug: string; active: CaseSort }) {
  const router = useRouter()

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[13px] text-[var(--color-text-secondary)]">Sort by</span>
      {(Object.keys(SORT_LABELS) as CaseSort[]).map((sort) => (
        <Button
          key={sort}
          variant={sort === active ? 'outline' : 'ghost'}
          aria-pressed={sort === active}
          onClick={() => router.push(channelHref(slug, '/cases', { sort }))}
        >
          {SORT_LABELS[sort]}
        </Button>
      ))}
    </div>
  )
}

function CaseFacts({ item }: { item: CaseSummary }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-[15px] font-medium">{item.title}</p>
      <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
        <span className="capitalize">{item.category}</span> · {STATUS_LABELS[item.status]} ·
        priority <span className="font-mono">{item.priorityScore}</span>
        {item.projectCount > 0 ? ` · ${item.projectCount} project(s)` : ''}
      </p>
      {item.angle ? (
        <p className="mt-1 line-clamp-2 text-[13px] text-[var(--color-text-muted)]">{item.angle}</p>
      ) : null}
    </div>
  )
}

type Run = (
  action: () => Promise<{ ok: boolean; error?: string }>,
  success: string,
) => Promise<boolean>

const TEXTAREA_CLASS =
  'min-h-[80px] w-full rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] ' +
  'px-3 py-2 text-[14px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'

/** Subject, People and Source links: the three fields the dossier reads, shared by the add and edit forms. */
function DetailFields({
  idPrefix,
  subject,
  onSubject,
  people,
  onPeople,
  links,
  onLinks,
}: {
  idPrefix: string
  subject: string
  onSubject: (value: string) => void
  people: string
  onPeople: (value: string) => void
  links: string
  onLinks: (value: string) => void
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-subject`}>Subject</Label>
        <Input
          id={`${idPrefix}-subject`}
          value={subject}
          placeholder="The company, as Wikipedia names it"
          onChange={(event) => onSubject(event.target.value)}
          className="w-64"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-people`}>People</Label>
        <Input
          id={`${idPrefix}-people`}
          value={people}
          placeholder="Full names, separated by commas"
          onChange={(event) => onPeople(event.target.value)}
          className="w-72"
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
          className={`${TEXTAREA_CLASS} w-96`}
        />
      </div>
    </>
  )
}

/** The `Edit details` panel on a row: the same three fields, saved with `editCase`. */
function EditDetails({ item, run }: { item: CaseSummary; run: Run }) {
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
    <div className="flex w-full flex-wrap items-end gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
      <DetailFields
        idPrefix={`edit-${item.id}`}
        subject={subject}
        onSubject={setSubject}
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

function SuggestionRow({
  item,
  run,
  notices,
}: {
  item: CaseSummary
  run: Run
  notices: readonly Notice[]
}) {
  const [accepting, setAccepting] = React.useState(false)

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <CaseFacts item={item} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          busy={accepting}
          onClick={async () => {
            setAccepting(true)
            try {
              await run(() => acceptCase(item.id), 'Accepted — it is in your backlog')
            } finally {
              setAccepting(false)
            }
          }}
        >
          <Check aria-hidden />
          Accept
        </Button>
        {/* Destructive, so it asks first, as the backlog's Remove does
            (decision 294): one click used to delete the suggestion. */}
        <ConfirmButton
          label={
            <>
              <X aria-hidden />
              Dismiss
            </>
          }
          // Neutral, as the backlog's "Remove it" is: a suggestion with
          // projects behind it is retired, not deleted.
          confirmLabel="Dismiss it"
          consequence={
            item.projectCount > 0
              ? 'It has projects behind it, so it is retired rather than deleted.'
              : 'This suggestion is deleted. Suggest cases again for new ones.'
          }
          onConfirm={() => run(() => dismissCase(item.id), 'Dismissed')}
        />
      </div>
      <EditDetails item={item} run={run} />
      <RowNotices notices={notices} />
    </div>
  )
}

function BacklogRow({
  slug,
  blocked,
  item,
  run,
  notices,
}: {
  slug: string
  /** The bible is incomplete: a project cannot start. */
  blocked: boolean
  item: CaseSummary
  run: Run
  notices: readonly Notice[]
}) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <CaseFacts item={item} />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`${item.title} status`}
          value={item.status}
          onChange={(event) =>
            void run(() => setStatus(item.id, event.target.value), 'Status updated')
          }
          className="w-40"
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        {item.status === 'shortlisted' ? (
          <Button
            variant="primary"
            busy={busy}
            disabled={blocked}
            title={blocked ? BIBLE_INCOMPLETE_MESSAGE : undefined}
            onClick={async () => {
              setBusy(true)
              try {
                const result = await startProjectFromCase(item.id)
                if (result.ok) {
                  router.push(channelHref(slug, '/projects'))
                } else {
                  await run(async () => result, '')
                }
              } finally {
                setBusy(false)
              }
            }}
          >
            New project
          </Button>
        ) : null}

        <ConfirmButton
          label="Remove"
          confirmLabel="Remove it"
          consequence={
            item.projectCount > 0
              ? 'It has projects behind it, so it is retired rather than deleted.'
              : 'This case is deleted. Nothing has been produced from it.'
          }
          onConfirm={() => run(() => dismissCase(item.id), 'Removed')}
        />
      </div>
      <EditDetails item={item} run={run} />
      <RowNotices notices={notices} />
    </div>
  )
}

/** A case's notices (decision 293), full width under the row's facts and buttons. */
function RowNotices({ notices }: { notices: readonly Notice[] }) {
  if (notices.length === 0) return null
  return (
    <div className="w-full">
      <Notices notices={notices} />
    </div>
  )
}

function SuggestButton({ channelId, blocked }: { channelId: string; blocked: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [count, setCount] = React.useState(8)
  const [steer, setSteer] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  if (!open) {
    return (
      <Button
        variant="outline"
        disabled={blocked}
        title={blocked ? BIBLE_INCOMPLETE_MESSAGE : undefined}
        onClick={() => setOpen(true)}
      >
        <Sparkles aria-hidden />
        Suggest cases
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="suggest-count">How many</Label>
        <NumberInput
          id="suggest-count"
          value={count}
          min={1}
          max={20}
          onChange={(event) => setCount(Number(event.target.value))}
          className="w-24"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="suggest-steer">Steer (optional)</Label>
        <Input
          id="suggest-steer"
          value={steer}
          placeholder="e.g. aviation, 1990s, nothing US-centric"
          onChange={(event) => setSteer(event.target.value)}
          className="w-72"
        />
      </div>
      <Button
        variant="primary"
        busy={busy}
        onClick={async () => {
          setBusy(true)
          try {
            const result = await suggestCases(channelId, {
              count,
              steer: steer.trim() || undefined,
            })
            if (!result.ok) {
              toast({
                title: 'That did not work',
                description: result.error,
                variant: 'error',
              })
              return
            }
            toast({
              title: result.mocked
                ? `${result.created} placeholder rows — mock mode researched nothing`
                : `${result.created} new, ${result.skipped} already in your library`,
              // A dropped suggestion has no row to carry its notice (decision 293).
              ...(result.notice ? { description: result.notice } : {}),
            })
            setOpen(false)
            router.refresh()
          } finally {
            setBusy(false)
          }
        }}
      >
        Get suggestions
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </Button>
    </div>
  )
}

function AddCaseButton({ channelId, run }: { channelId: string; run: Run }) {
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [category, setCategory] = React.useState<string>('collapse')
  const [angle, setAngle] = React.useState('')
  // Subject follows the title until the owner types in it themselves.
  const [subject, setSubject] = React.useState('')
  const [subjectTouched, setSubjectTouched] = React.useState(false)
  const [people, setPeople] = React.useState('')
  const [links, setLinks] = React.useState('')
  const [priorityScore, setPriorityScore] = React.useState(50)
  const [busy, setBusy] = React.useState(false)

  if (!open) {
    return (
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        Add case
      </Button>
    )
  }

  return (
    <div className="flex w-full flex-wrap items-end gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="case-title">Title</Label>
        <Input
          id="case-title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            if (!subjectTouched) setSubject(subjectFromTitle(event.target.value))
          }}
          className="w-64"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="case-category">Category</Label>
        <Select
          id="case-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="w-40"
        >
          {CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="case-angle">Angle</Label>
        <Input
          id="case-angle"
          value={angle}
          onChange={(event) => setAngle(event.target.value)}
          className="w-72"
        />
      </div>
      <DetailFields
        idPrefix="case"
        subject={subject}
        onSubject={(value) => {
          setSubject(value)
          setSubjectTouched(value !== '')
        }}
        people={people}
        onPeople={setPeople}
        links={links}
        onLinks={setLinks}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="case-priority">Priority</Label>
        <NumberInput
          id="case-priority"
          value={priorityScore}
          min={0}
          max={100}
          onChange={(event) => setPriorityScore(Number(event.target.value))}
          className="w-24"
        />
      </div>
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
                  priorityScore,
                  subject,
                  people: splitPeople(people),
                  sourceLinks: splitSourceLinks(links),
                }),
              'Case added to your backlog',
            )
            if (ok) {
              setTitle('')
              setAngle('')
              setSubject('')
              setSubjectTouched(false)
              setPeople('')
              setLinks('')
              setOpen(false)
            }
          } finally {
            setBusy(false)
          }
        }}
      >
        Save case
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </Button>
    </div>
  )
}
