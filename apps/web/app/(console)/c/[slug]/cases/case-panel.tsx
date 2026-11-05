'use client'

import type { CaseSort, CaseSummary } from '@boom-busters/db'
import { briefNeedsResearch } from '@boom-busters/schemas'
import type { Notice } from '@boom-busters/schemas'
import { ArrowLeft, Check, X } from 'lucide-react'
import Link from 'next/link'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Notices } from '@/components/notices'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { fitWarning } from '@/lib/brief-fit'
import { caseCategoryLabel } from '@/lib/case-category'
import { channelHref } from '@/lib/channel-href'
import { acceptCase, dismissCase, setStatus } from './actions'
import { AngleSection } from './angle-section'
import { EditDetails } from './case-forms'
import type { CaseCategoryOption } from './case-forms'
import { STATUS_LABELS, caseProgress, measuredOn } from './case-progress'
import type { StepState } from './case-progress'
import { SearchDemandSection } from './search-demand-section'
import {
  FormatPicker,
  NewProjectButton,
  ResearchControl,
  briefMatchesSubject,
} from './search-brief-panel'
import type { Run } from './search-brief-panel'

/**
 * The right pane: the open case, top to bottom in the order the owner decides.
 * Header, next step, warnings, Angle, Start a project, Search demand, footer.
 */

const projects = (n: number): string => `${n} ${n === 1 ? 'project' : 'projects'}`

const STEP_CLASS: Record<StepState, string> = {
  done: 'border-[color-mix(in_srgb,var(--color-success)_40%,transparent)] text-[var(--color-success)]',
  current: 'border-[var(--color-accent-text)] text-[var(--color-text-primary)]',
  todo: 'border-[var(--color-border)] text-[var(--color-text-muted)]',
}

const STEP_WORD: Record<StepState, string> = { done: 'done', current: 'next', todo: 'not yet' }

export function CasePanel({
  slug,
  channelId,
  blocked,
  item,
  run,
  notices,
  categories,
  sort,
  explicit,
}: {
  slug: string
  channelId: string
  /** Why a project cannot start, or null when it can. */
  blocked: string | null
  item: CaseSummary
  run: Run
  notices: readonly Notice[]
  categories: readonly CaseCategoryOption[]
  sort: CaseSort
  /** Whether the URL named this case; below `xl` only then is the panel shown, with Back to cases. */
  explicit: boolean
}) {
  const titleId = React.useId()
  const brief = item.searchBrief
  const suggestion = item.status === 'idea'
  const retired = item.status === 'retired'
  const { steps, next } = caseProgress(item)
  const needsResearch = brief !== null && briefNeedsResearch(brief)
  const research = retired || suggestion ? null : <ResearchControl item={item} run={run} />
  const fit = brief === null ? null : fitWarning(brief.fit, item.category, categories)
  const mismatch = brief !== null && !briefMatchesSubject(brief, item.subject)
  const pillar = caseCategoryLabel({ caseCategories: [...categories] }, item.category)

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-5">
      {explicit ? (
        <Button asChild variant="ghost" className="w-fit xl:hidden">
          <Link href={channelHref(slug, '/cases', { sort })}>
            <ArrowLeft aria-hidden />
            Back to cases
          </Link>
        </Button>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h2 id={titleId} className="text-[20px] leading-tight font-semibold">
            {item.title}
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            {pillar}
            {suggestion ? ` · ${STATUS_LABELS.idea}` : ''}
            {item.projectCount > 0 ? ` · ${projects(item.projectCount)}` : ''}
            {brief === null ? '' : ` · Researched ${measuredOn(brief.measuredAt)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {suggestion ? (
            <SuggestionActions item={item} run={run} />
          ) : (
            <>
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
              <FormatPicker item={item} run={run} />
              {needsResearch ? null : research}
            </>
          )}
        </div>
      </header>

      {notices.length === 0 ? null : (
        <div className="w-full">
          <Notices notices={notices} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-3">
        <p className="min-w-0 text-[13px] text-[var(--color-text-secondary)]">{next}</p>
        <ol aria-label="Progress" className="flex flex-wrap gap-1.5 text-[12px]">
          {steps.map((step) => (
            <li
              key={step.id}
              aria-current={step.state === 'current' ? 'step' : undefined}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 ${STEP_CLASS[step.state]}`}
            >
              {step.state === 'done' ? <Check aria-hidden className="size-3" /> : null}
              {step.label}
              <span className="sr-only"> ({STEP_WORD[step.state]})</span>
            </li>
          ))}
        </ol>
      </div>

      {fit ? (
        <p role="status" className="text-[13px] text-[var(--color-warning)]">
          {fit}
        </p>
      ) : null}
      {mismatch && brief !== null ? (
        <p role="status" className="text-[13px] text-[var(--color-warning)]">
          This research is for {brief.subject}. Research again for {item.subject?.trim() ?? ''}.
        </p>
      ) : null}

      <AngleSection item={item} run={run} researchControl={research} />

      {item.status === 'shortlisted' ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-[13px] font-semibold text-[var(--color-text-secondary)]">
            Start a project
          </h3>
          <NewProjectButton
            slug={slug}
            channelId={channelId}
            blocked={blocked}
            item={item}
            run={run}
          />
        </section>
      ) : null}

      <SearchDemandSection item={item} run={run} />

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <p className="min-w-0 text-[13px] text-[var(--color-text-secondary)]">
          {footerSummary(item)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <EditDetails item={item} run={run} />
          {suggestion ? null : (
            <ConfirmButton
              label="Remove case"
              confirmLabel="Remove it"
              consequence={
                item.projectCount > 0
                  ? 'It has projects behind it, so it is retired rather than deleted.'
                  : 'This case is deleted. Nothing has been produced from it.'
              }
              onConfirm={() => run(() => dismissCase(item.id), 'Removed')}
            />
          )}
        </div>
      </footer>
    </section>
  )
}

/** One line on what the dossier reads: subject, people and source links. */
function footerSummary(item: CaseSummary): string {
  const subject = item.subject?.trim() ?? ''
  const links = item.sourceLinks.length
  return [
    subject === '' ? 'No subject yet' : `Subject: ${subject}`,
    item.people.length === 0 ? 'No people' : `People: ${item.people.join(', ')}`,
    `${links} source ${links === 1 ? 'link' : 'links'}`,
  ].join(' · ')
}

/** Accept and Dismiss, for a suggestion left from before Suggest cases was retired. */
function SuggestionActions({ item, run }: { item: CaseSummary; run: Run }) {
  const [accepting, setAccepting] = React.useState(false)

  return (
    <>
      <Button
        variant="primary"
        busy={accepting}
        onClick={async () => {
          setAccepting(true)
          try {
            await run(() => acceptCase(item.id), 'Accepted. It is in your backlog')
          } finally {
            setAccepting(false)
          }
        }}
      >
        <Check aria-hidden />
        Accept
      </Button>
      {/* Destructive, so it asks first, as Remove case does (decision 294). */}
      <ConfirmButton
        label={
          <>
            <X aria-hidden />
            Dismiss
          </>
        }
        // Neutral, as "Remove it" is: a suggestion with projects behind it is retired, not deleted.
        confirmLabel="Dismiss it"
        consequence={
          item.projectCount > 0
            ? 'It has projects behind it, so it is retired rather than deleted.'
            : 'This suggestion is deleted.'
        }
        onConfirm={() => run(() => dismissCase(item.id), 'Dismissed')}
      />
    </>
  )
}
