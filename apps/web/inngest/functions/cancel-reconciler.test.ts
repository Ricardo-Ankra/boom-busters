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
  setSlotRetype,
  setVisualsJob,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { newId } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { cancelReconciler } from './cancel-reconciler'

/**
 * Stop and the job stamps (decision 286): `project/cancelled` cancels the side
 * jobs without running their `onFailure`, so the reconciler is the only thing
 * left to clear what they stamped.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('cancel-reconciler: job stamps (decision 286)', () => {
  let slotId = ''

  beforeEach(async () => {
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
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

  it('leaves no card saying a job is running after Stop', async () => {
    const startedAt = new Date().toISOString()
    await setSlotJob(db, slotId, { kind: 'refetch', jobId: newId(), startedAt })
    await setSlotRetype(db, slotId, { state: 'drafting', target: 'chart' })
    await setVisualsJob(db, FIXTURE_PROJECT_ID, { op: 'fetch', jobId: newId(), startedAt })

    await new InngestTestEngine({ function: cancelReconciler }).execute({
      events: [
        { name: 'project/cancelled', data: { projectId: FIXTURE_PROJECT_ID, reason: 'owner' } },
      ],
    })

    const slot = (await getShotSlot(db, slotId))!
    expect(slot.pendingJob).toBeNull()
    expect(slot.retype).toBeNull()
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })
})
