import {
  countCases,
  countMusicBeds,
  getSettings,
  isYoutubeConnected,
  listActiveRuns,
  listFailedRuns,
  listOpenBudgetGates,
  listProjectsAwaitingReview,
} from '@boom-busters/db'
import { CheckCircle2, Circle } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { LiveRefresh } from '@/components/live-refresh'
import { NeedsYouQueue, buildNeedsYouCards } from '@/components/needs-you-queue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { db } from '@/lib/db'
import { actionableSetup, buildChecklist, pipelineBlockers, upcomingSetup } from '@/lib/first-run'
import type { ChecklistItem } from '@/lib/first-run'

export const dynamic = 'force-dynamic'

/**
 * The dashboard is the Needs-you queue, always (spec section 11.3, amended by
 * decision 2026-08-16). It used to be *replaced* by the setup checklist until
 * every item was done — and two items belong to milestones that have not
 * shipped, so the queue was unreachable in the running product. Setup is now
 * a strip above the queue: still first thing on the screen while anything is
 * missing, no longer a wall in front of the actual work.
 */
export default async function DashboardPage() {
  const [settings, youtubeConnected, musicBedCount, caseCount] = await Promise.all([
    getSettings(db),
    isYoutubeConnected(db),
    countMusicBeds(db),
    countCases(db),
  ])

  const items = buildChecklist({ settings, youtubeConnected, musicBedCount, caseCount })
  const actionable = actionableSetup(items)
  const upcoming = upcomingSetup(items)

  const [awaitingReview, budgetGates, failedRuns, activeRuns] = await Promise.all([
    listProjectsAwaitingReview(db),
    listOpenBudgetGates(db),
    listFailedRuns(db),
    listActiveRuns(db),
  ])

  const cards = buildNeedsYouCards({ awaitingReview, budgetGates, failedRuns })

  return (
    <div className="flex flex-col gap-4">
      {actionable.length > 0 ? <SetupStrip items={actionable} /> : null}

      <h1 className="text-[20px] font-semibold">
        Needs you
        {cards.length > 0 ? (
          <span className="ml-2 font-mono text-[15px] text-[var(--color-text-muted)]">
            {cards.length}
          </span>
        ) : null}
      </h1>

      <NeedsYouQueue cards={cards} />

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Active runs</h2>
          <LiveRefresh active={activeRuns.length > 0} />
        </div>
        {activeRuns.length === 0 ? (
          <p className="rounded-[8px] border border-[var(--color-border)] p-6 text-center text-[13px] text-[var(--color-text-muted)]">
            Nothing is running.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-[8px] border border-[var(--color-border)]">
            {activeRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-3 p-3 text-[13px]">
                <span
                  aria-hidden
                  className="size-2 animate-pulse rounded-full bg-[var(--color-accent)] motion-reduce:animate-none"
                />
                <span className="min-w-0 flex-1 truncate">
                  {run.projectTitle ?? run.functionName}
                </span>
                <span className="font-mono text-[12px] text-[var(--color-text-muted)]">
                  {run.currentStep ?? run.functionName}
                </span>
                {run.projectId ? (
                  <Button asChild variant="outline">
                    <Link href={`/projects/${run.projectId}` as Route}>View</Link>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {upcoming.length > 0 ? (
        // One muted line, no buttons: work that belongs to a later milestone
        // is coming, not owed, and must not read as an unticked to-do.
        <p className="text-[12px] text-[var(--color-text-muted)]">
          Coming with later milestones:{' '}
          {upcoming
            .map((item) => `${item.label.toLowerCase()} (${item.availableFrom})`)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  )
}

/**
 * The setup that still needs doing, as a strip rather than a wall. Each row
 * keeps the checklist's deep-linking button; the blocker sentence names what
 * actually stops a project from starting, and only that.
 */
function SetupStrip({ items }: { items: ChecklistItem[] }) {
  const blockers = pipelineBlockers(items)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-semibold">Set up Boom-Busters</h2>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {blockers.length === 0
              ? 'Nothing here blocks the pipeline — finish whenever you like.'
              : `The pipeline cannot start a project until ${blockers
                  .map((item) => item.label.toLowerCase())
                  .join(', ')} ${blockers.length === 1 ? 'is' : 'are'} done.`}
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3">
              {item.done ? (
                <CheckCircle2 className="size-4 shrink-0 text-[var(--color-success)]" aria-hidden />
              ) : (
                <Circle className="size-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">
                  {item.label}
                  <span className="sr-only">{item.done ? ' — done' : ' — not done'}</span>
                </p>
                <p className="text-[12px] text-[var(--color-text-muted)]">{item.detail}</p>
              </div>
              <Button asChild variant="outline">
                <Link href={item.href}>{item.buttonLabel}</Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
