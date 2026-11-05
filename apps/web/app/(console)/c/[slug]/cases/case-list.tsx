'use client'

import type { CaseSort, CaseSummary } from '@boom-busters/db'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { caseCategoryLabel } from '@/lib/case-category'
import { channelHref } from '@/lib/channel-href'
import type { CaseCategoryOption } from './case-forms'
import { STATUS_LABELS, listSignal } from './case-progress'

/**
 * The left pane: the sort toggle, the Suggested group when any exist, and the
 * backlog, every row a link to its case. The open case lives in the URL, so a
 * refresh keeps it and it can be bookmarked.
 */

/** 'priority' still parses from an old URL but has no button: nothing sets it any more. */
const SORT_LABELS: Record<Exclude<CaseSort, 'priority'>, string> = {
  category: 'Category',
  status: 'Status',
  newest: 'Newest',
}

const TONE_CLASS = {
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-warning)]',
  muted: 'text-[var(--color-text-muted)]',
} as const

const projects = (n: number): string => `${n} ${n === 1 ? 'project' : 'projects'}`

export function CaseList({
  slug,
  sort,
  cases,
  selectedId,
  explicit,
  categories,
  className,
}: {
  slug: string
  sort: CaseSort
  cases: readonly CaseSummary[]
  selectedId: string | null
  /** Whether the URL named the open case; a sort change keeps it only then. */
  explicit: boolean
  categories: readonly CaseCategoryOption[]
  /** Visibility below `xl`, set by the shell. */
  className: string
}) {
  const suggestions = cases.filter((item) => item.status === 'idea')
  const backlog = cases.filter((item) => item.status !== 'idea')

  return (
    <div className={`min-w-0 flex-col ${className}`}>
      <nav
        aria-label="Cases"
        className="flex flex-col overflow-hidden rounded-[10px] border border-[var(--color-border)] xl:max-h-[calc(100dvh-9rem)] xl:overflow-y-auto"
      >
        {suggestions.length > 0 ? (
          <div className="border-b border-[var(--color-warning)]/40">
            <p className="px-4 pt-3 pb-1 text-[12px] font-semibold text-[var(--color-warning)]">
              Suggested · {suggestions.length} waiting on you
            </p>
            <p className="px-4 pb-2 text-[12px] text-[var(--color-text-secondary)]">
              Nothing here is in the backlog yet. Accept what is worth making; dismiss the rest.
            </p>
            <Rows
              slug={slug}
              sort={sort}
              items={suggestions}
              selectedId={selectedId}
              categories={categories}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <p className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
            Backlog · {backlog.length}
          </p>
          <SortControls slug={slug} active={sort} openCase={explicit ? selectedId : null} />
        </div>

        {backlog.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
            <p className="text-[15px]">No cases yet.</p>
            <p className="text-[13px] text-[var(--color-text-muted)]">Add one yourself.</p>
          </div>
        ) : (
          <Rows
            slug={slug}
            sort={sort}
            items={backlog}
            selectedId={selectedId}
            categories={categories}
          />
        )}
      </nav>
    </div>
  )
}

function SortControls({
  slug,
  active,
  openCase,
}: {
  slug: string
  active: CaseSort
  openCase: string | null
}) {
  const router = useRouter()

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="mr-1 text-[13px] text-[var(--color-text-secondary)]">Sort by</span>
      {(Object.keys(SORT_LABELS) as (keyof typeof SORT_LABELS)[]).map((sort) => (
        <Button
          key={sort}
          variant={sort === active ? 'selected' : 'ghost'}
          aria-pressed={sort === active}
          onClick={() =>
            router.push(
              channelHref(slug, '/cases', openCase === null ? { sort } : { sort, case: openCase }),
            )
          }
        >
          {SORT_LABELS[sort]}
        </Button>
      ))}
    </div>
  )
}

function Rows({
  slug,
  sort,
  items,
  selectedId,
  categories,
}: {
  slug: string
  sort: CaseSort
  items: readonly CaseSummary[]
  selectedId: string | null
  categories: readonly CaseCategoryOption[]
}) {
  return (
    <ul className="flex flex-col divide-y divide-[var(--color-border)]">
      {items.map((item) => {
        const current = item.id === selectedId
        const signal = listSignal(item)
        return (
          <li key={item.id}>
            <Link
              href={channelHref(slug, '/cases', { sort, case: item.id })}
              scroll={false}
              aria-current={current ? 'true' : undefined}
              className={
                'grid min-h-[44px] gap-1 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
                (current
                  ? 'bg-[var(--color-surface)] shadow-[inset_3px_0_0_var(--color-accent-text)]'
                  : 'hover:bg-[var(--color-surface-raised)]')
              }
            >
              <span className="truncate text-[14px] font-semibold">{item.title}</span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--color-text-secondary)]">
                <span
                  className={
                    'rounded-full border px-2 py-0.5 text-[11px] ' +
                    (item.status === 'in_production'
                      ? 'border-[var(--color-accent-text)] text-[var(--color-accent-text)]'
                      : 'border-[var(--color-border-strong)]')
                  }
                >
                  {STATUS_LABELS[item.status]}
                </span>
                <span>{caseCategoryLabel({ caseCategories: [...categories] }, item.category)}</span>
                {item.projectCount > 0 ? <span>· {projects(item.projectCount)}</span> : null}
              </span>
              <span className="flex flex-wrap gap-x-3 text-[12px]">
                {signal.keyword === null ? null : (
                  <span className="font-mono text-[var(--color-text-muted)]">
                    kw: {signal.keyword}
                  </span>
                )}
                {signal.angle === null ? null : (
                  <span className={TONE_CLASS[signal.angle.tone]}>{signal.angle.text}</span>
                )}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
