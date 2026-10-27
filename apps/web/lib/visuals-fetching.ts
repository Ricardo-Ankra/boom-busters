/**
 * Whether Fetch visuals is under way (decision 286). The runner keeps the
 * plan phase for the whole fetch pass, and the stage reads `running` from the
 * moment it closes the gate, so no stamp is needed; a stopped or failed fetch
 * leaves the stage `cancelled` or `failed`, which is not fetching.
 *
 * `running` counts only with a live run behind it, `isMoving`'s rule: a
 * runner that died without its `onFailure` leaves the column saying running,
 * and reading that as a fetch would lock the board for good and refuse the
 * one free way out, Fetch visuals resuming at the fetch pass (decision 279).
 * And only while the project is at the visuals stage: a voice re-run leaves
 * the plan phase in the row, and its run is not a fetch.
 *
 * Apart from the review model so the stretch-replanner can read the board's
 * rule without that module's imports (the stretch re-plan design, 3.3).
 */
export function isFetching(
  phase: 'plan' | 'board' | null,
  project: { stage: string; stageStatus: string } | undefined,
  liveRun: boolean,
): boolean {
  if (phase !== 'plan' || project?.stage !== 'visuals') return false
  return project.stageStatus === 'queued' || (project.stageStatus === 'running' && liveRun)
}
