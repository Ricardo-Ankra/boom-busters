'use client'

import { Play, Square } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { ConfirmButton } from '@/components/confirm-button'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  approveGate,
  requestChanges,
  startDemoPipeline,
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

export function StartRunButton({ projectId }: { projectId: string }) {
  const act = useAction()
  const [busy, setBusy] = React.useState(false)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="primary"
        busy={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await act(() => startDemoPipeline(projectId), 'Run queued')
          } finally {
            setBusy(false)
          }
        }}
      >
        <Play aria-hidden />
        Start demo pipeline
      </Button>

      {/* The only way to see a budget gate without waiting for real spend to
          cross a real cap. It asks the guard for more than any cap can hold,
          so the refusal is the guard's, not a mock. */}
      <ConfirmButton
        label="Start with a forced budget gate"
        confirmLabel="Start it"
        confirmVariant="primary"
        consequence="The first step will ask for $1,000,000 and park on the budget gate."
        onConfirm={() =>
          act(
            () => startDemoPipeline(projectId, { forceBudgetGate: true }),
            'Run queued — it will park at the budget gate',
          )
        }
      />
    </div>
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
}: {
  projectId: string
  stage: string
  /** Runtime, warnings, cost of the next stage — section 11.3. */
  context: string
  /** When set, `Approve` is disabled and this is shown next to it. */
  blockedReason?: string | undefined
}) {
  const act = useAction()
  const [note, setNote] = React.useState('')
  const [showNote, setShowNote] = React.useState(false)
  const [busy, setBusy] = React.useState<'approve' | 'changes' | null>(null)
  const [handedOff, setHandedOff] = React.useState(false)

  /**
   * An approval is handed to Inngest, not applied here: the parked run resumes
   * seconds later in another process. Until the page next re-reads itself the
   * gate still looks open, so the buttons stand down rather than inviting a
   * second approval that would land on a run no longer waiting for one.
   */
  if (handedOff) {
    return (
      <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:-mx-6 md:px-6">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Handed to the pipeline. The run picks this up within a few seconds, and this screen
          updates itself.
        </p>
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
                if (handed) setHandedOff(true)
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
