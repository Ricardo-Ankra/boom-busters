import { listShotSlots } from '@boom-busters/db'
import { JOB_STALE_MS, SlotJobSchema } from '@boom-busters/schemas'
import type { SlotJob } from '@boom-busters/schemas'
import { db } from '@/lib/db'

/**
 * The stretch re-plan's one-job-at-a-time rules (the stretch re-plan design,
 * 3.3). A stamp is live until it is older than the board's own staleness
 * window, so a job that died without clearing its stamp does not lock forever.
 */

/** The row's stamp when it is live, else null. */
export function liveSlotJob(pendingJob: unknown, now = Date.now()): SlotJob | null {
  const parsed = SlotJobSchema.safeParse(pendingJob)
  if (!parsed.success) return null
  return now - Date.parse(parsed.data.startedAt) < JOB_STALE_MS ? parsed.data : null
}

/** Whether any shot of the project carries a live stretch stamp. */
export async function hasLiveStretch(projectId: string): Promise<boolean> {
  const rows = await listShotSlots(db, projectId)
  return rows.some((row) => liveSlotJob(row.pendingJob)?.kind === 'stretch')
}

export const STRETCH_RUNNING = 'Wait for the stretch re-plan to finish.'
