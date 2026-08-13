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
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db'
import { buildChecklist, isSetupComplete, pipelineBlockers } from '@/lib/first-run'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [settings, youtubeConnected, musicBedCount, caseCount] = await Promise.all([
    getSettings(db),
    isYoutubeConnected(db),
    countMusicBeds(db),
    countCases(db),
  ])

  const items = buildChecklist({ settings, youtubeConnected, musicBedCount, caseCount })

  if (!isSetupComplete(items)) {
    return <FirstRunChecklist items={items} />
  }

  const [awaitingReview, budgetGates, failedRuns, activeRuns] = await Promise.all([
    listProjectsAwaitingReview(db),
    listOpenBudgetGates(db),
    listFailedRuns(db),
    listActiveRuns(db),
  ])

  const cards = buildNeedsYouCards({ awaitingReview, budgetGates, failedRuns })

  return (
    <div className="flex flex-col gap-4">
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
    </div>
  )
}

function FirstRunChecklist({ items }: { items: ReturnType<typeof buildChecklist> }) {
  const blockers = pipelineBlockers(items)

  return (
    <div className="prose-measure mx-auto flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold">Set up Boom-Busters</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          {blockers.length === 0
            ? 'Everything the pipeline needs is in place. Finish the rest whenever you like.'
            : `The pipeline cannot start a project until ${blockers
                .map((item) => item.label.toLowerCase())
                .join(', ')} ${blockers.length === 1 ? 'is' : 'are'} done.`}
        </p>
      </header>

      <ol className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={item.id}>
            <Card>
              <CardHeader className="flex-row items-start gap-3">
                {item.done ? (
                  <CheckCircle2
                    className="mt-0.5 size-5 shrink-0 text-[var(--color-success)]"
                    aria-hidden
                  />
                ) : (
                  <Circle
                    className="mt-0.5 size-5 shrink-0 text-[var(--color-text-muted)]"
                    aria-hidden
                  />
                )}

                <div className="min-w-0 flex-1">
                  <CardTitle>
                    <span className="font-mono text-[var(--color-text-muted)]">{index + 1}. </span>
                    {item.label}
                    <span className="sr-only">{item.done ? ' — done' : ' — not done'}</span>
                  </CardTitle>
                  <CardDescription>{item.detail}</CardDescription>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button asChild variant={item.done ? 'outline' : 'primary'}>
                    <Link href={item.href}>{item.buttonLabel}</Link>
                  </Button>
                  {item.availableFrom ? (
                    <span className="text-[12px] text-[var(--color-text-muted)]">
                      Arrives in {item.availableFrom}
                    </span>
                  ) : null}
                </div>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  )
}
