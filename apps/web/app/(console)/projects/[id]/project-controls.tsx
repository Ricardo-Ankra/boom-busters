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
        `but needing a re-run to be current again. Hand edits to the current script are kept ` +
        `on the old version and are NOT carried into a newly drafted one.`
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
  placeholders = 0,
  handOffTimeoutMs = 8_000,
}: {
  projectId: string
  stage: string
  /** Runtime, warnings, cost of the next stage — section 11.3. */
  context: string
  /** When set, `Approve` is disabled and this is shown next to it. */
  blockedReason?: string | undefined
  /**
   * Visuals gate only: unresolved-into-placeholder slots the approval would
   * wave past. Spec 11.3 — "approve allowed with placeholders only via
   * explicit 'approve with N placeholders' wording", so a non-zero count
   * changes the button's own label, and the action verifies the count the
   * button actually named.
   */
  placeholders?: number
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
   * And it expires on its own. The page polls every three seconds, so after
   * two polls the server state is authoritative either way — the buttons come
   * back if the run truly has not moved. The old "Show the buttons again"
   * escape hatch existed to undo the UI's guess by hand; a control whose
   * meaning is "the app is not sure your click worked" is not a control.
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
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Handed to the pipeline. The run picks this up within a few seconds, and this screen
          updates itself.
        </p>
      </div>
    )
  }

  return (
    <div className={frame}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-[var(--color-text-secondary)]">{context}</p>

        {stage === 'dossier' && showNote ? (
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
          {/* Only where something listens. `gate/dossier.changes_requested`
              drives the dossier reviser; the script and voice equivalents had
              no subscriber, so the button collected a note, toasted success,
              and dropped both (audited 2026-08-16). On those stages the real
              change channel is the screen itself — the Studio's editor, the
              voice rows' repairs — and the bar says so instead of lying. */}
          {stage === 'dossier' ? (
            showNote ? (
              <>
                <Button
                  variant="outline"
                  busy={busy === 'changes'}
                  onClick={async () => {
                    setBusy('changes')
                    try {
                      await act(
                        () => requestChanges(projectId, stage, note),
                        'Re-researching — the gate re-opens when the new dossier lands',
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
            )
          ) : (
            <span className="text-[13px] text-[var(--color-text-muted)]">
              {stage === 'script'
                ? 'Changes happen in the Studio below — edits are saved as you make them.'
                : stage === 'visuals'
                  ? 'Changes happen on the cards below — swap a candidate, edit a brief, or upload your own.'
                  : 'Changes happen on the rows below — fix, retake or flag a paragraph.'}
            </span>
          )}

          <Button
            variant="primary"
            disabled={Boolean(blockedReason)}
            busy={busy === 'approve'}
            onClick={async () => {
              setBusy('approve')
              try {
                const handed = await act(
                  () =>
                    approveGate(
                      projectId,
                      stage,
                      // The count the button's label named — the action
                      // refuses if the board has drifted since this render.
                      stage === 'visuals' && placeholders > 0
                        ? { acknowledgePlaceholders: placeholders }
                        : undefined,
                    ),
                  stage === 'dossier'
                    ? 'Approved — the script drafts now, and parks only if the self-check finds problems'
                    : stage === 'script'
                      ? 'Approved — narration is being synthesised; review the audio when it lands'
                      : stage === 'voice'
                        ? 'Approved — the visual board is being planned; review it when it lands'
                        : stage === 'visuals'
                          ? 'Approved — the board is locked; assembly arrives with M6'
                          : 'Approved — moving on',
                )
                if (handed) setHandedOff(stage)
              } finally {
                setBusy(null)
              }
            }}
          >
            {stage === 'visuals' && placeholders > 0
              ? `Approve with ${placeholders} placeholder${placeholders === 1 ? '' : 's'}`
              : 'Approve'}
          </Button>

          {blockedReason ? (
            <span className="text-[13px] text-[var(--color-warning)]">{blockedReason}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
