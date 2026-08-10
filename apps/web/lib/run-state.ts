import type { StageStatus } from '@boom-busters/db'

/**
 * Is anything expected to change on this screen without the user doing
 * something?
 *
 * Two sources, because neither alone is right. `liveRun` comes from the run
 * mirror and is the truth once Inngest has picked the work up — but there is a
 * window after Start where the event has been sent and no run row exists yet,
 * and a screen that waited for `liveRun` would sit frozen on "Queued" through
 * it. `stageStatus` covers that window.
 */
export function isMoving(project: { stageStatus: StageStatus }, liveRun: boolean): boolean {
  return project.stageStatus === 'queued' || project.stageStatus === 'running' || liveRun
}

/**
 * Whether the gate action bar should be offered.
 *
 * A gate needs both halves: the project parked at a review, and a run actually
 * waiting on it. Offering Approve without the second is offering to send an
 * event nothing is listening for.
 */
export function isGateOpen(project: { stageStatus: StageStatus }, liveRun: boolean): boolean {
  return project.stageStatus === 'awaiting_review' && liveRun
}

/** Parked at a review with no run behind it — a state that needs explaining. */
export function isStranded(project: { stageStatus: StageStatus }, liveRun: boolean): boolean {
  return project.stageStatus === 'awaiting_review' && !liveRun
}
