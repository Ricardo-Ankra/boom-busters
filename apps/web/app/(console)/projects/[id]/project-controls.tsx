'use client'

import { RotateCcw, Square, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  approveGate,
  deleteProjectAction,
  requestChanges,
  restartStage,
  stopProject,
  type ActionResult,
} from '../actions'

/**
 * The buttons on a project screen (build spec section 11.3): a sticky gate
 * action bar with `Request changes` and `Approve`, plus `Stop` on a running
 * stage.
 *
 * Every one is a visible labelled control with its consequence on it, and
 * `Approve` is disabled with the reason shown inline when it cannot proceed —
 * a disabled button that will not say why is worse than no button.
 */

function useAction() {
  const router = useRouter()
  const { toast } = useToast()

  // Returns whether it worked, so a caller can stand its own controls down
  // without repeating the toast-and-refresh dance.
  return React.useCallback(
    async (run: () => Promise<ActionResult>, success: string): Promise<boolean> => {
      const result = await run()
      if (result.ok) {
        toast({ title: success })
        router.refresh()
      } else {
        toast({ title: 'That did not work', description: result.error, variant: 'error' })
      }
      return result.ok
    },
    [router, toast],
  )
}

/**
 * The way back from a stage that stopped — and the only start-shaped control
 * the project screen has.
 *
 * There is no plain "Start". A project's research begins the moment it is
 * created and each later stage begins when the one before it is approved, so a
 * start button could only ever start something a second time, on top of the
 * run already doing it.
 */
export function RestartRunButton({
  projectId,
  stage,
  label,
  downstream = [],
}: {
  projectId: string
  stage: string
  label: string
  /** The stages this re-run would leave stale, named rather than implied. */
  downstream?: readonly { stage: string }[]
}) {
  const act = useAction()

  /**
   * The consequence is spelled out per stage, because "this will invalidate
   * downstream work" is not something anyone can act on.
   *
   * Downstream work is kept, not deleted (decision, PROGRESS.md M3.2). So the
   * sentence has to say both halves — the old script stays readable, and it
   * stops being current — or the dialog reads like a delete warning and gets
   * dismissed by people who did not want to delete anything.
   */
  const consequence =
    downstream.length > 0
      ? `This stage runs from the start and costs what it cost the first time. ` +
        `The ${downstream.map((view) => view.stage).join(' and ')} stage${
          downstream.length === 1 ? '' : 's'
        } will be marked as built from older work — kept and still readable, ` +
        `but needing a re-run to be current again.`
      : 'This stage runs from the start and replaces what it produced last time. It costs what it cost the first time.'

  return (
    <ConfirmButton
      label={
        <>
          <RotateCcw aria-hidden />
          {label}
        </>
      }
      confirmLabel="Run it again"
      confirmVariant="primary"
      consequence={consequence}
      onConfirm={() => act(() => restartStage(projectId, stage), 'Sent to the pipeline')}
    />
  )
}

export function StopButton({ projectId }: { projectId: string }) {
  const act = useAction()

  return (
    <ConfirmButton
      label={
        <>
          <Square aria-hidden />
          Stop
        </>
      }
      confirmLabel="Stop this run"
      consequence="The run stops where it is. Work already done is kept; nothing is refunded."
      onConfirm={() => act(() => stopProject(projectId), 'Run stopped')}
    />
  )
}

/**
 * Delete the project and everything under it.
 *
 * Kept at the bottom of the screen, well away from Approve, and phrased around
 * what actually disappears. "This cannot be undone" is a warning nobody can
 * weigh; "18 claims, 6 chapters and $2.34 of research" is one they can.
 *
 * It also says what *survives*, because the surprising half is the money: the
 * spend stays on the Costs screen attributed to no project. A console whose
 * monthly total dropped every time you tidied up would be a console that could
 * not be used to answer "what has this channel cost me".
 */
export function DeleteProjectButton({
  projectId,
  summary,
}: {
  projectId: string
  summary: { claims: number; chapters: number; scripts: number; runs: number; spendUsd: number }
}) {
  const act = useAction()
  const router = useRouter()

  const parts = [
    summary.claims > 0 ? `${summary.claims} claim${summary.claims === 1 ? '' : 's'}` : null,
    summary.chapters > 0 ? `${summary.chapters} chapter${summary.chapters === 1 ? '' : 's'}` : null,
    summary.runs > 0 ? `${summary.runs} run${summary.runs === 1 ? '' : 's'}` : null,
  ].filter(Boolean)

  const consequence =
    (parts.length > 0
      ? `This deletes the project and its ${parts.join(', ')}. `
      : 'This deletes the project. ') +
    (summary.spendUsd > 0
      ? `The $${summary.spendUsd.toFixed(2)} it has already cost stays on the Costs screen — the money was spent either way. `
      : '') +
    'The case it came from is kept. Nothing here can be recovered.'

  return (
    <ConfirmButton
      label={
        <>
          <Trash2 aria-hidden />
          Delete this project
        </>
      }
      confirmLabel="Delete it"
      consequence={consequence}
      onConfirm={async () => {
        const done = await act(() => deleteProjectAction(projectId), 'Project deleted')
        // Staying on the screen of a project that no longer exists would 404 on
        // the next refresh.
        if (done) router.push('/projects')
        return done
      }}
    />
  )
}

export function GateActionBar({
  projectId,
  stage,
  context,
  blockedReason,
  handOffTimeoutMs = 30_000,
}: {
  projectId: string
  stage: string
  /** Runtime, warnings, cost of the next stage — section 11.3. */
  context: string
  /** When set, `Approve` is disabled and this is shown next to it. */
  blockedReason?: string | undefined
  /** Injectable so the expiry can be tested without waiting out half a minute. */
  handOffTimeoutMs?: number
}) {
  const act = useAction()
  const [note, setNote] = React.useState('')
  const [showNote, setShowNote] = React.useState(false)
  const [busy, setBusy] = React.useState<'approve' | 'changes' | null>(null)

  /**
   * Which gate was handed to the pipeline — not *whether* one was.
   *
   * An approval is handed to Inngest, not applied here: the parked run resumes
   * seconds later in another process. Until the page next re-reads itself the
   * gate still looks open, so the buttons stand down rather than inviting a
   * second approval that would land on a run no longer waiting for one.
   *
   * Storing the stage rather than a boolean is the fix for a real failure. As a
   * boolean this never reset, and its only escape was the component
   * unmounting — which needed the server to be observed in a state where no
   * gate was open. In production it never was: a stale run left the project at
   * `awaiting_review` continuously across the dossier-to-script handover, the
   * three-second poll never caught the one-second gap between them, and the
   * script gate inherited the dossier's flag. The result was a screen with a
   * finished script, no Approve, no Request changes, and a "handed to the
   * pipeline" note about an approval given several minutes earlier.
   */
  const [handedOff, setHandedOff] = React.useState<string | null>(null)
  const waiting = handedOff === stage

  /**
   * And it expires. If the run has not moved on within half a minute it is not
   * coming back on its own, and a human staring at a note about a hand-off that
   * evidently did not happen needs the buttons back, not reassurance.
   */
  React.useEffect(() => {
    if (!waiting) return
    const timer = window.setTimeout(() => setHandedOff(null), handOffTimeoutMs)
    return () => window.clearTimeout(timer)
  }, [waiting, handOffTimeoutMs])

  /**
   * At the top of the screen with the other controls, not stuck to the bottom.
   *
   * Spec 11.3 asks for a sticky bar along the bottom edge. On the dossier that
   * was fine; on the Script Studio it permanently covered the last few lines of
   * the chapter you were reading, on the one screen whose entire job is reading.
   * A control bar that competes with the content it acts on is the wrong
   * trade — so it sits with `Stop` and the re-run controls instead, where the
   * eye already goes for actions.
   */
  const frame = 'rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3'

  if (waiting) {
    return (
      <div className={frame}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Handed to the pipeline. The run picks this up within a few seconds, and this screen
            updates itself.
          </p>
          <Button variant="ghost" onClick={() => setHandedOff(null)}>
            Show the buttons again
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={frame}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--color-text-secondary)]">{context}</p>

        {showNote ? (
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="text-[var(--color-text-secondary)]">What needs to change?</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[14px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
            />
          </label>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {showNote ? (
            <>
              <Button
                variant="outline"
                busy={busy === 'changes'}
                onClick={async () => {
                  setBusy('changes')
                  try {
                    await act(
                      () => requestChanges(projectId, stage, note),
                      'Change request sent back to the runner',
                    )
                    setNote('')
                    setShowNote(false)
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                Send change request
              </Button>
              <Button variant="ghost" onClick={() => setShowNote(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => setShowNote(true)}>
              Request changes
            </Button>
          )}

          <Button
            variant="primary"
            disabled={Boolean(blockedReason)}
            busy={busy === 'approve'}
            onClick={async () => {
              setBusy('approve')
              try {
                const handed = await act(
                  () => approveGate(projectId, stage),
                  'Approved — handed to the pipeline',
                )
                if (handed) setHandedOff(stage)
              } finally {
                setBusy(null)
              }
            }}
          >
            Approve
          </Button>

          {blockedReason ? (
            <span className="text-[13px] text-[var(--color-warning)]">{blockedReason}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
