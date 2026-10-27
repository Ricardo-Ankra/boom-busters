import { releaseSlotJob, releaseVisualsJob } from '@boom-busters/db'
import { db } from '@/lib/db'

/**
 * The `onFailure` half of decision 286: a job that failed after its retries
 * lets go of the stamp its action wrote, and only its own (matched on the
 * event's `jobId`). An event with no `jobId` was sent before job ids existed
 * and has nothing of its own to release; the board's 10-minute limit covers
 * whatever it left.
 *
 * Never throws: `onFailure` goes on to say why the job failed, and a release
 * that could not be written must not swallow that.
 */
export async function releaseFailedSlotJob(data: Record<string, unknown>): Promise<void> {
  const { slotId, jobId } = data
  if (typeof slotId !== 'string' || typeof jobId !== 'string') return
  await releaseSlotJob(db, slotId, jobId).catch((error: unknown) => {
    console.error('[jobs] could not release a failed slot job', error)
  })
}

export async function releaseFailedVisualsJob(data: Record<string, unknown>): Promise<void> {
  const { projectId, jobId } = data
  if (typeof projectId !== 'string' || typeof jobId !== 'string') return
  await releaseVisualsJob(db, projectId, { jobId }).catch((error: unknown) => {
    console.error('[jobs] could not release a failed visuals job', error)
  })
}

/**
 * A stretch re-plan stamps every selected slot with one job id (the stretch
 * re-plan design, 3.3), so a failed one lets go of each of them, still only
 * where the stamp is its own.
 */
export async function releaseFailedStretchJob(data: Record<string, unknown>): Promise<void> {
  const { slotIds, jobId } = data
  if (!Array.isArray(slotIds) || typeof jobId !== 'string') return
  for (const slotId of slotIds) {
    if (typeof slotId !== 'string') continue
    await releaseSlotJob(db, slotId, jobId).catch((error: unknown) => {
      console.error('[jobs] could not release a failed stretch job', error)
    })
  }
}
