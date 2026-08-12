'use client'

import { RotateCcw, Square } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  approveGate,
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

  if (waiting) {
    return (
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:-mx-6 md:px-6">
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
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:-mx-6 md:px-6">
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
