import {
  ensurePublishRecord,
  getThumbnailPackage,
  listThumbnailPackages,
  updateThumbnailPackage,
} from '@boom-busters/db'
import { parseEventData } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import {
  composeThumbnailPackage,
  paintThumbnailPicture,
  planThumbnailSet,
} from '@/lib/thumbnail-set'
import { inngest } from '../client'
import { events } from '../events'

/**
 * thumbnail-set-runner (design 2026-11-24, 7.4): `thumbnails/set.requested`.
 *
 * `set` plans the free places, then paints and composes each new package;
 * `paint` repaints one package and composes it; `compose` sets the type on one
 * package's stored picture again and buys nothing. A package whose paint
 * failed is not composed. Painting and composing never throw (each leaves its
 * package ready or failed with words), so one package's failure never stops
 * the next, and a retry of the run repeats only what a step has not finished.
 */

const FUNCTION_ID = 'thumbnail-set-runner'

export const thumbnailSetRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Thumbnail set',
    retries: 1,
    concurrency: [{ key: 'event.data.targetId', limit: 1 }],
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const targetId = event.data.event.data['targetId']
      if (typeof targetId !== 'string') return
      const record = await ensurePublishRecord(db, 'master', targetId)
      const message = event.data.error.message
      for (const row of await listThumbnailPackages(db, record.id)) {
        if (row.state === 'planned' || row.state === 'painting') {
          await updateThumbnailPackage(db, row.id, { state: 'failed', error: message })
        }
      }
    },
    triggers: [events.thumbnailSetRequested],
  },
  async ({ event, step }) => {
    const request = parseEventData('thumbnails/set.requested', event.data)

    /** Paint (when asked) then compose one package; no compose after a failed paint. */
    const finish = async (packageId: string, paint: boolean): Promise<void> => {
      if (paint) {
        const state = await step.run(`paint-${packageId}`, async () => {
          await paintThumbnailPicture(packageId)
          return (await getThumbnailPackage(db, packageId))?.state ?? 'failed'
        })
        if (state === 'failed') return
      }
      await step.run(`compose-${packageId}`, () => composeThumbnailPackage(packageId))
    }

    if (request.mode === 'set') {
      const planned = await step.run('plan', async () => {
        const record = await ensurePublishRecord(db, 'master', request.targetId)
        return planThumbnailSet({ projectId: request.projectId, publishRecordId: record.id })
      })
      for (const packageId of planned.inserted) await finish(packageId, true)
      return {
        mode: request.mode,
        packages: planned.inserted.length,
        dropped: planned.dropped.length,
      }
    }

    // The schema holds that a request for one package carries its id.
    const packageId = request.packageId!
    await finish(packageId, request.mode === 'paint')
    return { mode: request.mode, packages: 1 }
  },
)
