'use client'

import type { CaseSort, CaseSummary } from '@boom-busters/db'
import { Check, Plus, Sparkles, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input, Label, NumberInput, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import {
  acceptCase,
  addCase,
  dismissCase,
  setStatus,
  startProjectFromCase,
  suggestCases,
} from './actions'

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

export function CaseLibrary({ cases, sort }: { cases: CaseSummary[]; sort: CaseSort }) {
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold">Case Library</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SuggestButton />
          <AddCaseButton run={run} />
        </div>
      </header>

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
                <SuggestionRow item={item} run={run} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[15px] font-medium">Backlog</h2>
          <SortControls active={sort} />
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
                <BacklogRow item={item} run={run} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SortControls({ active }: { active: CaseSort }) {
  const router = useRouter()

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[13px] text-[var(--color-text-secondary)]">Sort by</span>
      {(Object.keys(SORT_LABELS) as CaseSort[]).map((sort) => (
        <Button
          key={sort}
          variant={sort === active ? 'outline' : 'ghost'}
          aria-pressed={sort === active}
          onClick={() => router.push(`/cases?sort=${sort}`)}
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

function SuggestionRow({ item, run }: { item: CaseSummary; run: Run }) {
  const [busy, setBusy] = React.useState<'accept' | 'dismiss' | null>(null)

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <CaseFacts item={item} />
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          busy={busy === 'accept'}
          onClick={async () => {
            setBusy('accept')
            try {
              await run(() => acceptCase(item.id), 'Accepted — it is in your backlog')
            } finally {
              setBusy(null)
            }
          }}
        >
          <Check aria-hidden />
          Accept
        </Button>
        <Button
          variant="outline"
          busy={busy === 'dismiss'}
          onClick={async () => {
            setBusy('dismiss')
            try {
              await run(() => dismissCase(item.id), 'Dismissed')
            } finally {
              setBusy(null)
            }
          }}
        >
          <X aria-hidden />
          Dismiss
        </Button>
      </div>
    </div>
  )
}

function BacklogRow({ item, run }: { item: CaseSummary; run: Run }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <CaseFacts item={item} />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label={`${item.title} status`}
          value={item.status}
          onChange={(event) => void run(() => setStatus(item.id, event.target.value), 'Status updated')}
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
            onClick={async () => {
              setBusy(true)
              try {
                const result = await startProjectFromCase(item.id)
                if (result.ok) {
                  router.push('/projects')
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
    </div>
  )
}

function SuggestButton() {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [count, setCount] = React.useState(8)
  const [steer, setSteer] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
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
            const result = await suggestCases({ count, steer: steer.trim() || undefined })
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

function AddCaseButton({ run }: { run: Run }) {
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [category, setCategory] = React.useState<string>('collapse')
  const [angle, setAngle] = React.useState('')
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
          onChange={(event) => setTitle(event.target.value)}
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
              () => addCase({ title, category, angle: angle || undefined, priorityScore }),
              'Case added to your backlog',
            )
            if (ok) {
              setTitle('')
              setAngle('')
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
