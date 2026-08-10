import type { FailedRun, OpenBudgetGate, ProjectSummary } from '@boom-busters/db'
import { AlertCircle, DollarSign, Flag } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/cn'

/**
 * The Needs-you queue (build spec section 11.3) — "the whole point" of the
 * dashboard.
 *
 * One card per open gate, budget gate and failed run, sorted oldest first,
 * each with a primary button that deep-links straight into the review screen.
 * The user's entire job is emptying this queue (spec principle 1).
 *
 * QC-failure and reconnect-YouTube cards join it in M6 and M7, when those
 * things can happen at all.
 */

export interface NeedsYouCard {
  id: string
  kind: 'gate' | 'budget' | 'failure'
  title: string
  context: string
  href: Route
  buttonLabel: string
  at: Date
}

export function buildNeedsYouCards(input: {
  awaitingReview: ProjectSummary[]
  budgetGates: OpenBudgetGate[]
  failedRuns: FailedRun[]
}): NeedsYouCard[] {
  const cards: NeedsYouCard[] = [
    ...input.awaitingReview.map((project): NeedsYouCard => ({
      id: `gate-${project.id}`,
      kind: 'gate',
      title: `${project.title} · ${project.stage} ready`,
      context: `${project.caseCategory} · ${project.targetRuntimeMin} min target`,
      href: `/projects/${project.id}` as Route,
      buttonLabel: 'Review',
      at: project.updatedAt,
    })),
    ...input.budgetGates.map((gate): NeedsYouCard => ({
      id: `budget-${gate.runId}`,
      kind: 'budget',
      title: gate.killSwitch
        ? `Kill switch blocked ${gate.provider}`
        : `Over budget on ${gate.provider}`,
      context:
        `$${gate.monthSpendUsd.toFixed(2)} spent of a $${gate.budgetUsd.toFixed(2)} cap · ` +
        `this call needs $${gate.estimateUsd.toFixed(4)}`,
      href: (gate.projectId ? `/projects/${gate.projectId}` : '/costs') as Route,
      buttonLabel: 'Decide',
      at: gate.openedAt,
    })),
    ...input.failedRuns.map((run): NeedsYouCard => ({
      id: `failure-${run.id}`,
      kind: 'failure',
      title: `${run.projectTitle ?? run.functionName} failed`,
      context: String(run.error?.['message'] ?? 'No error message was recorded.'),
      href: (run.projectId ? `/projects/${run.projectId}` : '/projects') as Route,
      buttonLabel: 'Open',
      at: run.completedAt ?? new Date(0),
    })),
  ]

  // Oldest first: the thing that has been waiting longest is the thing that
  // needs you most (spec section 11.3, "sorted by age").
  return cards.sort((a, b) => a.at.getTime() - b.at.getTime())
}

const KIND_META = {
  gate: {
    icon: Flag,
    tone: 'text-[var(--color-warning)]',
    border: 'border-[var(--color-warning)]',
  },
  budget: {
    icon: DollarSign,
    tone: 'text-[var(--color-warning)]',
    border: 'border-[var(--color-warning)]',
  },
  failure: {
    icon: AlertCircle,
    tone: 'text-[var(--color-danger)]',
    border: 'border-[var(--color-danger)]',
  },
} as const

export function NeedsYouQueue({ cards }: { cards: NeedsYouCard[] }) {
  if (cards.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <p className="text-[15px] text-[var(--color-text-primary)]">
            All clear — pipeline is running itself.
          </p>
          <p className="text-[13px] text-[var(--color-text-muted)]">
            Open gates, budget approvals and failed runs appear here.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {cards.map((card) => {
        const meta = KIND_META[card.kind]
        const Icon = meta.icon

        return (
          <li key={card.id}>
            <Card className={cn(card.kind === 'failure' && meta.border)}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4">
                <Icon className={cn('size-5 shrink-0', meta.tone)} aria-hidden />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{card.title}</p>
                  <p className="mt-0.5 text-[13px] text-[var(--color-text-secondary)]">
                    {card.context}
                  </p>
                </div>

                <span className="font-mono text-[12px] text-[var(--color-text-muted)] tabular-nums">
                  {ageLabel(card.at)}
                </span>

                <Button asChild variant="primary">
                  <Link href={card.href}>{card.buttonLabel}</Link>
                </Button>
              </CardContent>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}

export function ageLabel(since: Date): string {
  const minutes = Math.floor((Date.now() - since.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
