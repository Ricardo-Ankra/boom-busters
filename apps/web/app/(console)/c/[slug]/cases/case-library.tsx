'use client'

import type { CaseSort, CaseSummary } from '@boom-busters/db'
import { noticesFor } from '@boom-busters/schemas'
import type { ChannelFormat, Notice, ResearchThresholds } from '@boom-busters/schemas'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
import { CHANNEL_ARCHIVED_MESSAGE } from '@/lib/channel-archived'
import { channelHref } from '@/lib/channel-href'
import { AddCaseForm } from './case-forms'
import type { CaseCategoryOption } from './case-forms'
import { CaseList } from './case-list'
import { CasePanel } from './case-panel'
import type { CaseSearchOutcome } from './case-panel'
import { FormatsContext } from './search-brief-panel'
import type { Run } from './search-brief-panel'

/**
 * The Case Library: a list on the left and the open case's panel on the right,
 * the open case in the URL as `?case=<id>`.
 *
 * A row still at the `idea` status is a suggestion left from before Suggest
 * cases was retired; nothing creates one now. It stays in its own group above
 * the backlog, because the difference between "a model proposed this" and "I
 * decided to make this" is the point of the triage step. An accepted
 * suggestion moves down into the backlog; a dismissed one disappears.
 *
 * Below `xl` one pane shows at a time, by CSS alone: the list until the URL
 * names a case, then that case with Back to cases.
 */
export function CaseLibrary({
  slug,
  channelId,
  categories,
  formats = [],
  cases,
  sort,
  selectedId,
  explicit,
  notices = [],
  bibleComplete = true,
  archived = false,
  searchOutcomes = {},
  thresholds,
}: {
  /** The channel whose library this is; navigation stays inside it. */
  slug: string
  /** The channel the cases belong to; new and suggested cases land in it. */
  channelId: string
  /** The channel bible's case categories (key and label). */
  categories: readonly CaseCategoryOption[]
  /** The channel bible's formats; a picker shows in the panel when there is more than one. */
  formats?: readonly ChannelFormat[]
  cases: CaseSummary[]
  sort: CaseSort
  /** The open case, resolved by the page, or null for an empty library. */
  selectedId: string | null
  /** Whether the URL named a case that exists; below `xl` the panel shows only then. */
  explicit: boolean
  /** The cases' open notices (decision 293); the open case shows its own. */
  notices?: readonly Notice[]
  /** Whether the channel's bible is complete; until it is, nothing here starts work. */
  bibleComplete?: boolean
  /** An archived channel is read-only: nothing here starts or adds work. */
  archived?: boolean
  /** The latest search report outcome per case id, for published cases. */
  searchOutcomes?: Readonly<Record<string, CaseSearchOutcome>>
  /** The channel's research thresholds, for the verdict card. */
  thresholds?: ResearchThresholds
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [adding, setAdding] = React.useState(false)
  // Opening another case closes the add form.
  const [seenId, setSeenId] = React.useState(selectedId)
  if (selectedId !== seenId) {
    setSeenId(selectedId)
    setAdding(false)
  }

  const run: Run = React.useCallback(
    async (action, success) => {
      const result = await action()
      if (result.ok) {
        toast({ title: typeof success === 'function' ? success() : success })
        router.refresh()
      } else {
        toast({ title: 'That did not work', description: result.error, variant: 'error' })
      }
      return result.ok
    },
    [router, toast],
  )

  const blockedReason = archived
    ? CHANNEL_ARCHIVED_MESSAGE
    : bibleComplete
      ? null
      : BIBLE_INCOMPLETE_MESSAGE
  const selected = cases.find((item) => item.id === selectedId) ?? null
  // An empty library keeps its Add case button in the panel's prompt, once.
  const empty = selected === null && !adding

  const addButton = (
    <Button
      variant="primary"
      disabled={archived}
      title={archived ? CHANNEL_ARCHIVED_MESSAGE : undefined}
      onClick={() => setAdding(true)}
    >
      <Plus aria-hidden />
      Add case
    </Button>
  )

  // Below xl the add form, like an open case, takes the screen from the list.
  const panelAlone = explicit || adding
  const listClass = panelAlone ? 'hidden xl:flex' : 'flex'
  const panelClass = panelAlone || selected === null ? 'block' : 'hidden xl:block'

  return (
    <FormatsContext.Provider value={formats}>
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[20px] font-semibold">Case Library</h1>
          {empty ? null : <div className="flex flex-wrap items-center gap-2">{addButton}</div>}
        </header>

        {blockedReason === null ? null : (
          <p
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-[8px] border border-[var(--color-warning)]/40 p-3 text-[13px]"
          >
            <span>{blockedReason}.</span>
            {archived ? null : (
              <Button asChild variant="outline">
                <Link href={channelHref(slug, '/settings', { tab: 'bible' })}>
                  Open the Bible tab
                </Link>
              </Button>
            )}
          </p>
        )}

        <div className="grid items-start gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <CaseList
            slug={slug}
            sort={sort}
            cases={cases}
            selectedId={selectedId}
            explicit={explicit}
            categories={categories}
            className={listClass}
          />
          <div className={`min-w-0 ${panelClass}`}>
            {adding ? (
              <AddCaseForm
                channelId={channelId}
                categories={categories}
                run={run}
                onClose={() => setAdding(false)}
              />
            ) : selected ? (
              <CasePanel
                key={selected.id}
                slug={slug}
                channelId={channelId}
                blocked={blockedReason}
                item={selected}
                run={run}
                notices={noticesFor(notices, 'case', selected.id)}
                categories={categories}
                sort={sort}
                explicit={explicit}
                searchOutcome={searchOutcomes[selected.id] ?? null}
                thresholds={thresholds}
              />
            ) : (
              <section
                aria-labelledby="add-a-case"
                className="flex flex-col items-start gap-3 rounded-[10px] border border-[var(--color-border)] p-6"
              >
                <h2 id="add-a-case" className="text-[17px] font-semibold">
                  Add a case
                </h2>
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  A case is a subject you might make a video about. Add one, then research it.
                </p>
                {addButton}
              </section>
            )}
          </div>
        </div>
      </div>
    </FormatsContext.Provider>
  )
}
