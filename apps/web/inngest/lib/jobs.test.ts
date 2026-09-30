// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotJob,
  setVisualsJob,
  shotSlots,
} from '@boom-busters/db'
import { newId } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { releaseFailedSlotJob, releaseFailedVisualsJob } from './jobs'

/** What `onFailure` hands back of the event (decision 286). */

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('releasing a failed job’s stamp', () => {
  let slotId = ''

  beforeEach(async () => {
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: {
          type: 'stock',
          coversText: 'One.',
          description: 'the lobby',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'lobby',
          rejectionCriteria: [],
        },
        startMs: 0,
        durationMs: 6000,
      },
    ])
    slotId = (await listShotSlots(db, FIXTURE_PROJECT_ID))[0]!.id
  })

  it('lets go of the failed job’s own slot stamp, and not a newer one', async () => {
    const failed = newId()
    await setSlotJob(db, slotId, {
      kind: 'refetch',
      jobId: failed,
      startedAt: new Date().toISOString(),
    })
    await releaseFailedSlotJob({ projectId: FIXTURE_PROJECT_ID, slotId, jobId: failed })
    expect((await getShotSlot(db, slotId))!.pendingJob).toBeNull()

    const newer = { kind: 'refetch' as const, jobId: newId(), startedAt: new Date().toISOString() }
    await setSlotJob(db, slotId, newer)
    await releaseFailedSlotJob({ projectId: FIXTURE_PROJECT_ID, slotId, jobId: failed })
    expect((await getShotSlot(db, slotId))!.pendingJob).toEqual(newer)
  })

  it('does nothing for an event sent before job ids existed', async () => {
    const stamp = { kind: 'refetch' as const, jobId: newId(), startedAt: new Date().toISOString() }
    await setSlotJob(db, slotId, stamp)
    await releaseFailedSlotJob({ projectId: FIXTURE_PROJECT_ID, slotId })
    expect((await getShotSlot(db, slotId))!.pendingJob).toEqual(stamp)
  })

  it('lets go of the failed job’s own project stamp', async () => {
    const jobId = newId()
    await setVisualsJob(db, FIXTURE_PROJECT_ID, {
      op: 'shots',
      jobId,
      startedAt: new Date().toISOString(),
    })
    await releaseFailedVisualsJob({ projectId: FIXTURE_PROJECT_ID, op: 'shots', jobId })
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })
})
