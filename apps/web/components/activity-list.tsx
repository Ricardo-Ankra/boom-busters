import type { ActivityEntry } from '@boom-busters/db'
import {
  AlertCircle,
  Check,
  CircleDot,
  DollarSign,
  Flag,
  MinusCircle,
  Play,
  RefreshCw,
  Shuffle,
  Unlock,
} from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The run feed rendered by both the Activity drawer and the project screen
 * (build spec sections 11.2 and 12).
 *
 * It reads `run_events`, mirrored from Inngest by middleware, so it works with
 * no Inngest dashboard, no third-party login and no network call to Inngest.
 */

const KIND_META: Record<
  string,
  { icon: typeof Play; label: string; tone: 'neutral' | 'good' | 'warn' | 'bad' }
> = {
  'run.started': { icon: Play, label: 'Run started', tone: 'neutral' },
  'run.completed': { icon: Check, label: 'Run completed', tone: 'good' },
  'run.failed': { icon: AlertCircle, label: 'Run failed', tone: 'bad' },
  'run.cancelled': { icon: MinusCircle, label: 'Run cancelled', tone: 'neutral' },
  'step.started': { icon: CircleDot, label: 'Step started', tone: 'neutral' },
  'step.completed': { icon: Check, label: 'Step completed', tone: 'good' },
  'step.failed': { icon: AlertCircle, label: 'Step failed', tone: 'bad' },
  'step.retry': { icon: RefreshCw, label: 'Retrying', tone: 'warn' },
  'gate.opened': { icon: Flag, label: 'Gate opened', tone: 'warn' },
  'gate.closed': { icon: Unlock, label: 'Gate closed', tone: 'good' },
  'model.fallback': { icon: Shuffle, label: 'Fallback model', tone: 'warn' },
  spend: { icon: DollarSign, label: 'Spend', tone: 'neutral' },
}

const TONE_CLASSES = {
  neutral: 'text-[var(--color-text-muted)]',
  good: 'text-[var(--color-success)]',
  warn: 'text-[var(--color-warning)]',
  bad: 'text-[var(--color-danger)]',
} as const

function formatTime(at: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(at)
}

export function ActivityList({
  entries,
  emptyMessage,
  showProject = false,
}: {
  entries: ActivityEntry[]
  emptyMessage: string
  showProject?: boolean
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-[8px] border border-[var(--color-border)] p-6 text-center text-[13px] text-[var(--color-text-muted)]">
        {emptyMessage}
      </p>
    )
  }

  return (
    <ol className="flex flex-col divide-y divide-[var(--color-border)] rounded-[8px] border border-[var(--color-border)]">
      {entries.map((entry) => {
        const meta = KIND_META[entry.kind] ?? {
          icon: CircleDot,
          label: entry.kind,
          tone: 'neutral' as const,
        }
        const Icon = meta.icon

        return (
          <li key={entry.id} className="flex items-start gap-3 p-3">
            <Icon className={cn('mt-0.5 size-4 shrink-0', TONE_CLASSES[meta.tone])} aria-hidden />

            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-[var(--color-text-primary)]">
                {meta.label}
                {entry.stepId ? (
                  <span className="ml-1.5 font-mono text-[12px] text-[var(--color-text-muted)]">
                    {entry.stepId}
                  </span>
                ) : null}
              </p>
              {entry.message ? (
                <p className="mt-0.5 text-[12px] text-[var(--color-text-secondary)]">
                  {entry.message}
                </p>
              ) : null}
              {showProject && entry.projectTitle ? (
                <p className="mt-0.5 text-[12px] text-[var(--color-text-muted)]">
                  {entry.projectTitle}
                </p>
              ) : null}
            </div>

            <time
              dateTime={entry.occurredAt.toISOString()}
              className="shrink-0 font-mono text-[12px] text-[var(--color-text-muted)] tabular-nums"
            >
              {formatTime(entry.occurredAt)}
            </time>
          </li>
        )
      })}
    </ol>
  )
}
