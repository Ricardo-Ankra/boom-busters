import { PIPELINE_STAGES } from '@boom-busters/db'
import type { ProjectStage } from '@boom-busters/db'
import {
  AlertCircle,
  Check,
  CircleDashed,
  History,
  Loader2,
  MinusCircle,
  Pause,
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import type { StageView } from '@/lib/stage-view'

/**
 * The persistent pipeline rail (build spec section 11.3): eight segments, each
 * showing its state, **and each clickable**.
 *
 * The clickable half was in the spec from the start and was not built — the
 * rail shipped as eight `<div>`s. So a project on the script stage had no way
 * back to its own dossier: the research the narration was written from, and the
 * sources any later dispute turns on, were unreachable from the screen that
 * needed them most.
 *
 * State is never colour alone (section 11.1, accessibility): every segment
 * carries an icon and a text label, so "awaiting review" is legible without
 * seeing amber, and "stale" is legible without seeing the dashed border.
 */

export type SegmentState =
  | 'queued'
  | 'running'
  | 'awaiting_review'
  | 'approved'
  | 'failed'
  | 'cancelled'
  | 'upcoming'
  | 'stale'

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
  stale: 'needs re-running',
}

/**
 * A stage's state, from what it actually holds.
 *
 * This used to be derived from position — every stage before the current one
 * was `approved`, every stage after it `upcoming`. That describes a project
 * that has only ever moved forwards. Re-run the dossier of a project that has a
 * script and position calls the script "not started" while its chapters sit in
 * the database, and says nothing at all about the fact that they were written
 * from research that has since been replaced.
 */
export function segmentState(view: StageView): SegmentState {
  const outdated = view.availability === 'stale' || view.availability === 'unknown-provenance'

  if (view.current && view.status) {
    /**
     * Staleness overrides `approved`, and nothing else.
     *
     * "Approved" on a stage whose inputs have since been replaced is true and
     * misleading in the same breath: it *was* approved, and what it was
     * approved against is gone. Every other status wins, because a stage that
     * is running, queued or failed is describing something happening now,
     * which matters more than the provenance of what it is replacing.
     */
    return outdated && view.status === 'approved' ? 'stale' : view.status
  }

  switch (view.availability) {
    case 'upcoming':
      return 'upcoming'
    case 'stale':
    case 'unknown-provenance':
      return 'stale'
    case 'ready':
      return 'approved'
  }
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
    case 'stale':
      return <History className="size-3.5" aria-hidden />
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
  // Dashed, because stale is neither done nor undone: the work exists and
  // cannot be relied on.
  stale: 'border-dashed border-[var(--color-warning)] text-[var(--color-warning)]',
}

export function PipelineRail({
  views,
  projectId,
  viewing,
}: {
  views: readonly StageView[]
  projectId: string
  /** The stage on screen, which is not always the stage the project is on. */
  viewing: ProjectStage
}) {
  return (
    <ol
      aria-label="Pipeline stages"
      className="flex w-full flex-wrap items-center gap-1.5 sm:flex-nowrap"
    >
      {views.map((view) => {
        const state = segmentState(view)
        const label = SEGMENT_LABELS[view.stage]
        const onScreen = view.stage === viewing

        const body = (
          <>
            <StateIcon state={state} />
            <span className="truncate">{label}</span>
            <span className="sr-only">
              {' '}
              — {STATE_LABELS[state]}
              {view.current ? ', the stage this project is on' : ''}
            </span>
          </>
        )

        const shared = cn(
          'flex items-center justify-center gap-1.5 rounded-[8px] border px-2 py-2 text-[12px]',
          STATE_CLASSES[state],
          // The segment you are looking at, distinguished from the stage the
          // project is on — on a project you have navigated back through, they
          // are different segments and both matter.
          onScreen &&
            'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-background)]',
        )

        return (
          <li key={view.stage} className="min-w-0 flex-1">
            {view.viewable ? (
              <Link
                href={`/projects/${projectId}?stage=${view.stage}` as Route}
                aria-current={onScreen ? 'page' : undefined}
                className={cn(
                  shared,
                  'w-full transition-colors duration-150 hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]',
                )}
              >
                {body}
              </Link>
            ) : (
              // Not a disabled link: a stage with nothing in it has nothing to
              // show, and a control that looks pressable and is not is worse
              // than plain text.
              <div className={shared}>{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** The compact form used on each row of the Projects list (section 11.3). */
export function MiniPipelineRail({ views }: { views: readonly StageView[] }) {
  return (
    <ol aria-label="Pipeline stages" className="flex items-center gap-1">
      {views.map((view) => {
        const state = segmentState(view)
        return (
          <li key={view.stage}>
            <span
              className={cn('block size-2 rounded-full border', STATE_CLASSES[state], {
                'bg-current': state === 'approved' || state === 'running',
              })}
            />
            <span className="sr-only">
              {SEGMENT_LABELS[view.stage]} — {STATE_LABELS[state]}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export { PIPELINE_STAGES, SEGMENT_LABELS, STATE_LABELS }
