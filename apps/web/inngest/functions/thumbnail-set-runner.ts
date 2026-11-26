import {
  clearThumbnailSetRequest,
  ensurePublishRecord,
  getPublishRecord,
  getThumbnailPackage,
  listThumbnailPackages,
  mergePublishMetadata,
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
 * failed is not composed. Painting and composing never throw (a paint leaves its
 * package painting with a picture or failed with words, a compose leaves it
 * ready or failed), so one package's failure never stops
 * the next, and a retry of the run repeats only what a step has not finished.
 */

const FUNCTION_ID = 'thumbnail-set-runner'
/** The claim is stamped by the app's clock, a package's `createdAt` may be the database's. */
const CLOCK_SLACK_MS = 60_000

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
      // A dead set run gives the claim back, or the next Generate waits out the fifteen
      // minutes. A paint or compose run never held it: the claim may be a queued set run's.
      // A set run sent with a stamp clears the claim only while it is still its own: a
      // newer press owns a newer claim.
      if (event.data.event.data['mode'] === 'set') {
        const sentUnder = event.data.event.data['requestedAt']
        const held = (record.metadata as Record<string, unknown>)['thumbnailSetRequestedAt']
        if (typeof sentUnder !== 'string' || held === sentUnder) {
          await clearThumbnailSetRequest(db, record.id)
        }
      }
      let marked = 0
      for (const row of await listThumbnailPackages(db, record.id)) {
        if (row.state === 'planned' || row.state === 'painting') {
          await updateThumbnailPackage(db, row.id, { state: 'failed', error: message })
          marked += 1
        }
      }
      if (marked > 0) return
      // Nothing to mark: the owner still reads why, unless this run already said.
      const current = await getPublishRecord(db, 'master', targetId)
      const note = (current?.metadata as Record<string, unknown> | undefined)?.['thumbnailSetNote']
      if (current && (note === undefined || note === '')) {
        await mergePublishMetadata(db, current.id, {
          thumbnailSetNote: `The set could not be made: ${message}`.slice(0, 500),
        })
      }
    },
    triggers: [events.thumbnailSetRequested],
  },
  async ({ event, step }) => {
    const request = parseEventData('thumbnails/set.requested', event.data)

    /** Paint (when asked) then compose one package; no compose after a failed paint. */
    const finish = async (
      packageId: string,
      paint: boolean,
      keepPicture = false,
    ): Promise<void> => {
      if (paint) {
        // A painted package stays `painting` until composed; compose only what
        // the paint left with a picture. A step retried after its picture was
        // stored (`keepPicture`, a set run) goes straight on: it never buys it twice.
        const composable = await step.run(`paint-${packageId}`, async () => {
          if (keepPicture) {
            const stored = await getThumbnailPackage(db, packageId)
            if (stored?.pictureKey) return true
          }
          await paintThumbnailPicture(packageId)
          const row = await getThumbnailPackage(db, packageId)
          return row !== undefined && row.state !== 'failed' && row.pictureKey !== null
        })
        if (!composable) return
      }
      await step.run(`compose-${packageId}`, () => composeThumbnailPackage(packageId))
    }

    if (request.mode === 'set') {
      const planned = await step.run('plan', async () => {
        const record = await ensurePublishRecord(db, 'master', request.targetId)
        // The claim this run was sent under was given back or replaced: planning now would
        // buy a second set. An event sent before the stamp existed plans as it always did.
        const held = (record.metadata as Record<string, unknown>)['thumbnailSetRequestedAt']
        if (request.requestedAt !== undefined && held !== request.requestedAt) {
          // A newer press holds the record: this run has nothing to do.
          if (held !== undefined) return { inserted: [], dropped: [] }
          // No claim at all. Either it was given back before this run planned, and
          // there is nothing to paint, or this step is running again after its own
          // plan landed (the plan's last write clears the claim): then the packages
          // it wrote are still waiting, and are painted, not planned again.
          const since = Date.parse(request.requestedAt) - CLOCK_SLACK_MS
          const waiting = (await listThumbnailPackages(db, record.id)).filter(
            (row) =>
              row.source === 'generated' &&
              row.state === 'planned' &&
              row.createdAt.getTime() >= since,
          )
          return { inserted: waiting.map((row) => row.id), dropped: [] }
        }
        return planThumbnailSet({ projectId: request.projectId, publishRecordId: record.id })
      })
      for (const packageId of planned.inserted) await finish(packageId, true, true)
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
