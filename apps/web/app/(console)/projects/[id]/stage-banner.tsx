import type { ProjectStage } from '@boom-busters/db'
import { History, Eye } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { SEGMENT_LABELS } from '@/components/pipeline-rail'
import { Button } from '@/components/ui/button'
import type { StageView } from '@/lib/stage-view'
import { RestartRunButton } from './project-controls'

/**
 * The two things a navigable rail has to say that a fixed one never did.
 *
 * **Where you are.** Once any stage can be opened from any other, "what is on
 * screen" and "where the project is" come apart, and a screen that does not say
 * which one you are looking at is a screen you can act on by mistake. Reading
 * an old dossier and pressing Approve on it would be exactly that mistake, so
 * the gate bar is not rendered off-stage at all — this says why.
 *
 * **Whether it can be trusted.** A script written from research that has since
 * been replaced is not wrong, it is *out of date*, and the difference matters:
 * it is still the narration that exists, still worth reading, and must not be
 * quietly presented as current.
 */
export function StageBanner({
  projectId,
  projectStage,
  viewed,
  viewingCurrent,
  canRerun,
  downstream,
}: {
  projectId: string
  projectStage: ProjectStage
  viewed: StageView | undefined
  viewingCurrent: boolean
  canRerun: boolean
  downstream: readonly StageView[]
}) {
  if (!viewed) return null

  const stale = viewed.staleReason
  if (viewingCurrent && !stale) return null

  return (
    <div
      className={
        stale
          ? 'flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--color-warning)] bg-[var(--color-surface)] p-3'
          : 'flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3'
      }
    >
      <div className="flex min-w-0 items-start gap-2">
        {stale ? (
          <History className="mt-0.5 size-4 shrink-0 text-[var(--color-warning)]" aria-hidden />
        ) : (
          <Eye className="mt-0.5 size-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
        )}
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {!viewingCurrent ? (
            <>
              You are reading the <strong>{SEGMENT_LABELS[viewed.stage].toLowerCase()}</strong>.
              This project is on <strong>{SEGMENT_LABELS[projectStage].toLowerCase()}</strong>, so
              nothing here can be approved from this screen.{' '}
            </>
          ) : null}
          {stale}
        </p>
      </div>

      {/* min-w-0, never shrink-0: arming the Run-again confirm swaps the
          button for a sentence, and a container that refuses to shrink lays
          that sentence out as one line and scrolls the whole page sideways. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {canRerun ? (
          <RestartRunButton
            projectId={projectId}
            stage={viewed.stage}
            label={`Run the ${SEGMENT_LABELS[viewed.stage].toLowerCase()} stage again`}
            downstream={downstream}
          />
        ) : null}

        {!viewingCurrent ? (
          <Button asChild variant="outline">
            <Link href={`/projects/${projectId}?stage=${projectStage}` as Route}>
              Back to {SEGMENT_LABELS[projectStage].toLowerCase()}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
