/**
 * Back to visuals (decision 322): an approved board can be reopened from any
 * later stage, published included, so a shot found wrong after approval can
 * still be fixed on the board (a stretch re-plan works only at the visuals
 * stage). The board's offer and the action's refusal read this one rule.
 *
 * It never stops a run itself. A Stop's `project/cancelled` is reconciled by
 * a function that closes every live run on the project and marks it
 * cancelled; landing after the reopen it would wedge the new visuals run
 * (mirror-cancelled, Inngest-alive). So a live run is a refusal naming Stop.
 */

const LATER_STAGES: ReadonlySet<string> = new Set(['assembly', 'shorts', 'publish', 'done'])

interface ReopenProject {
  stage: string
  visualsPhase: 'plan' | 'board' | null
}

/** Whether the board shows Back to visuals at all: approved, and moved on from. */
export function reopenOffered(project: ReopenProject): boolean {
  return LATER_STAGES.has(project.stage) && project.visualsPhase === 'board'
}

/** Why the board cannot be reopened now, or null when it can. */
export function reopenRefusal(project: ReopenProject, liveRun: boolean): string | null {
  if (project.stage === 'visuals') return 'The board is already open.'
  if (!LATER_STAGES.has(project.stage)) {
    return 'This project has not reached the visuals board yet.'
  }
  if (project.visualsPhase !== 'board') {
    return 'There is no approved board to reopen. Re-run the visuals stage instead.'
  }
  if (liveRun) {
    return (
      'A later stage is still running or waiting for your review. Press Stop first, then ' +
      'Back to visuals.'
    )
  }
  return null
}
