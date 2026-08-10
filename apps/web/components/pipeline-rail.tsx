import { PIPELINE_STAGES } from '@boom-busters/db'
import type { ProjectStage, StageStatus } from '@boom-busters/db'
import { AlertCircle, Check, CircleDashed, Loader2, MinusCircle, Pause } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The persistent pipeline rail (build spec section 11.3): eight segments, each
 * showing its state.
 *
 * State is never colour alone (section 11.1, accessibility): every segment
 * carries an icon and a text label, so "awaiting review" is legible without
 * seeing amber.
 */

export type SegmentState =
  'queued' | 'running' | 'awaiting_review' | 'approved' | 'failed' | 'cancelled' | 'upcoming'

const SEGMENT_LABELS: Record<ProjectStage, string> = {
  dossier: 'Dossier',
  script: 'Script',
  voice: 'Voice',
  visuals: 'Visuals',
  assembly: 'Assembly',
  shorts: 'Shorts',
  publish: 'Publish',
  done: 'Done',
}

const STATE_LABELS: Record<SegmentState, string> = {
  queued: 'queued',
  running: 'running',
  awaiting_review: 'awaiting review',
  approved: 'approved',
  failed: 'failed',
  cancelled: 'cancelled',
  upcoming: 'not started',
}

/**
 * A stage's state, derived from where the project is. Stages before the
 * current one are done; the current one carries `stageStatus`; the rest are
 * upcoming. There is no per-stage status column, and adding one would create a
 * second version of the truth.
 */
export function segmentState(
  stage: ProjectStage,
  current: ProjectStage,
  currentStatus: StageStatus,
): SegmentState {
  const index = PIPELINE_STAGES.indexOf(stage)
  const currentIndex = PIPELINE_STAGES.indexOf(current)

  if (index < currentIndex) return 'approved'
  if (index > currentIndex) return 'upcoming'
  return currentStatus
}

function StateIcon({ state }: { state: SegmentState }) {
  switch (state) {
    case 'running':
      return <Loader2 className="size-3.5 animate-spin" aria-hidden />
    case 'awaiting_review':
      return <Pause className="size-3.5" aria-hidden />
    case 'approved':
      return <Check className="size-3.5" aria-hidden />
    case 'failed':
      return <AlertCircle className="size-3.5" aria-hidden />
    case 'cancelled':
      return <MinusCircle className="size-3.5" aria-hidden />
    default:
      return <CircleDashed className="size-3.5" aria-hidden />
  }
}

const STATE_CLASSES: Record<SegmentState, string> = {
  queued: 'border-[var(--color-border)] text-[var(--color-text-muted)]',
  running: 'border-[var(--color-accent)] text-[var(--color-accent)]',
  awaiting_review: 'border-[var(--color-warning)] text-[var(--color-warning)]',
  approved: 'border-[var(--color-success)] text-[var(--color-success)]',
  failed: 'border-[var(--color-danger)] text-[var(--color-danger)]',
  cancelled: 'border-[var(--color-border)] text-[var(--color-text-muted)] line-through',
  upcoming: 'border-[var(--color-border)] text-[var(--color-text-muted)]',
}

export function PipelineRail({
  stage,
  stageStatus,
}: {
  stage: ProjectStage
  stageStatus: StageStatus
}) {
  return (
    <ol
      aria-label="Pipeline stages"
      className="flex w-full flex-wrap items-center gap-1.5 sm:flex-nowrap"
    >
      {PIPELINE_STAGES.map((segment) => {
        const state = segmentState(segment, stage, stageStatus)
        return (
          <li key={segment} className="min-w-0 flex-1">
            <div
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-[8px] border px-2 py-2 text-[12px]',
                STATE_CLASSES[state],
              )}
            >
              <StateIcon state={state} />
              <span className="truncate">{SEGMENT_LABELS[segment]}</span>
              <span className="sr-only">— {STATE_LABELS[state]}</span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** The compact form used on each row of the Projects list (section 11.3). */
export function MiniPipelineRail({
  stage,
  stageStatus,
}: {
  stage: ProjectStage
  stageStatus: StageStatus
}) {
  return (
    <ol aria-label="Pipeline stages" className="flex items-center gap-1">
      {PIPELINE_STAGES.map((segment) => {
        const state = segmentState(segment, stage, stageStatus)
        return (
          <li key={segment}>
            <span
              className={cn('block size-2 rounded-full border', STATE_CLASSES[state], {
                'bg-current': state === 'approved' || state === 'running',
              })}
            />
            <span className="sr-only">
              {SEGMENT_LABELS[segment]} — {STATE_LABELS[state]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export { SEGMENT_LABELS, STATE_LABELS }
