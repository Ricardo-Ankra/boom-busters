import {
  countUploadsSince,
  getPublishRecord,
  getRender,
  getSettings,
  getShort,
  latestRender,
  recordVerifyResult,
  updatePublishRecord,
  youtubeRefreshToken,
} from '@boom-busters/db'
import { beginUpload } from '@boom-busters/db'
import {
  describeYoutubeAction,
  mapYoutubeError,
  newId,
  parseEventData,
  PublishMetadataSchema,
  quotaDayStartUtc,
  serialiseError,
} from '@boom-busters/schemas'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { brokerCallbackUrl, brokerConfigured, submitMediaJob } from '@/lib/broker'
import { notify } from '@/lib/notify'
import { presignGet, storageConfigured } from '@/lib/storage'
import { refreshAccessToken, setThumbnail, videoProcessed, YoutubeAuthError } from '@/lib/youtube'
import { inngest } from '../client'
import { events } from '../events'

/**
 * publish-runner (build spec section 7.2 item 8): per item, on the UI's
 * schedule action. Preconditions checked in words → the §5 atomic
 * `draft → uploading` claim → media-utils streams S3 → YouTube (the Lambda
 * gets a short-lived access token, never the refresh token, §9) →
 * thumbnail (masters only) → processing poll → `status='scheduled'` →
 * notification.
 *
 * Failures go through the error mapper, never raw: quota exhaustion
 * requeues for the next Pacific quota day, the channel's upload limit
 * pauses a day, dead credentials mark the connection invalid (which is
 * what puts the Reconnect card up), transients re-emit with an attempt
 * cap, and everything else fails this one item.
 *
 * A refused PRECONDITION leaves the record in `draft` with the reason in
 * its error field — the Publish screen shows why, and fixing it re-offers
 * the same button. Only a real upload failure moves a record to `failed`.
 */

const FUNCTION_ID = 'publish-runner'

/** Resumable uploads may crawl; the job hard-stops at 6 h (spec section 9). */
const UPLOAD_TIMEOUT = '7h'

/** Transient-failure re-emits stop here. */
const MAX_ATTEMPTS = 3

/** How long the processing poll waits before declaring victory anyway. */
const PROCESSING_POLLS = 5

export const publishRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Publish',
    retries: 2,
    // One upload at a time: quota politeness, and the budget count cannot
    // race itself.
    concurrency: [{ limit: 1 }],
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const data = event.data.event.data
      const targetType = data['targetType']
      const targetId = data['targetId']
      if ((targetType !== 'master' && targetType !== 'short') || typeof targetId !== 'string') {
        return
      }
      const record = await getPublishRecord(db, targetType, targetId)
      if (!record || record.status === 'scheduled' || record.status === 'live') return
      await updatePublishRecord(db, record.id, {
        status: 'failed',
        error: serialiseError(event.data.error),
      })
    },
    triggers: [events.publishRequested],
  },
  async ({ event, step }) => {
    const { projectId, targetType, targetId, attempt } = parseEventData(
      'publish/requested',
      event.data,
    )
    const mocked = mockProvidersEnabled()

    // -----------------------------------------------------------------------
    // Preconditions, checked in words (spec section 7.2 item 8)
    // -----------------------------------------------------------------------

    const preflight = await step.run('preflight', async () => {
      const record = await getPublishRecord(db, targetType, targetId)
      if (!record) {
        throw new NonRetriableError('No publish record exists — the schedule action makes one.')
      }
      if (record.status !== 'draft') {
        return { ok: false as const, refusal: null, skipped: record.status }
      }

      const refuse = async (message: string) => {
        await updatePublishRecord(db, record.id, { error: { message } })
        return { ok: false as const, refusal: message, skipped: null }
      }

      if (!record.publishAt) return refuse('No publish slot is chosen yet.')
      const metadata = PublishMetadataSchema.safeParse(record.metadata)
      if (!metadata.success) {
        return refuse('The metadata is not approved yet — a title is the minimum.')
      }
      if (targetType === 'master' && record.uploadedThumbKeys.length === 0) {
        return refuse('No thumbnail is uploaded yet — masters need one before upload.')
      }

      let videoS3Key: string | undefined
      if (targetType === 'master') {
        const render = await latestRender(db, projectId, 'master')
        if (render?.status !== 'done' || !render.outputS3Key) {
          return refuse('There is no finished master render to upload.')
        }
        videoS3Key = render.outputS3Key
      } else {
        const short = await getShort(db, targetId)
        if (!short) throw new NonRetriableError(`Short ${targetId} no longer exists`)
        if (!short.relatedLinkChecked) {
          return refuse('The related-video link is not marked done in Studio yet.')
        }
        const render = short.renderId ? await getRender(db, short.renderId) : undefined
        if (render?.status !== 'done' || !render.outputS3Key) {
          return refuse('This Short has no finished render to upload.')
        }
        videoS3Key = render.outputS3Key
      }

      if (!mocked) {
        if (!brokerConfigured() || !storageConfigured()) {
          return refuse('The render broker or R2 is not configured — uploads run in media-utils.')
        }
        const refreshToken = await youtubeRefreshToken(db, env.SECRETS_ENCRYPTION_KEY)
        if (!refreshToken) return refuse('YouTube is not connected — Settings → Connections.')
      }

      const settings = await getSettings(db)
      return {
        ok: true as const,
        refusal: null,
        skipped: null,
        recordId: record.id,
        videoS3Key,
        metadata: metadata.data,
        publishAtIso: record.publishAt.toISOString(),
        thumbKey: record.uploadedThumbKeys[0] ?? null,
        dailyBudget: settings.publish.dailyUploadBudget,
      }
    })

    if (!preflight.ok) {
      return preflight.skipped !== null
        ? { targetType, targetId, outcome: 'already-handled' as const, status: preflight.skipped }
        : { targetType, targetId, outcome: 'refused' as const, reason: preflight.refusal }
    }

    // -----------------------------------------------------------------------
    // The daily budget: over it, the item sleeps into the next quota day
    // -----------------------------------------------------------------------

    const budget = await step.run('check-budget', async () => {
      const started = await countUploadsSince(db, quotaDayStartUtc(new Date()))
      if (started < preflight.dailyBudget) return { ok: true as const, wakeAtIso: null }
      // Next Pacific quota day, plus slack for clock skew.
      const wakeAt = new Date(
        quotaDayStartUtc(new Date()).getTime() + 24 * 3600 * 1000 + 10 * 60 * 1000,
      )
      return { ok: false as const, wakeAtIso: wakeAt.toISOString() }
    })

    if (!budget.ok && budget.wakeAtIso !== null) {
      await step.run('note-queued', () =>
        notify({
          kind: 'gate-auto',
          title: 'Upload queued for tomorrow',
          body:
            `The daily upload budget (${preflight.dailyBudget}) is spent; this ` +
            `${targetType} uploads when the quota day resets.`,
          href: `/projects/${projectId}?stage=publish`,
        }),
      )
      await step.sleepUntil('wait-quota-day', new Date(budget.wakeAtIso))
      const retry = await step.run('recheck-budget', async () => {
        const started = await countUploadsSince(db, quotaDayStartUtc(new Date()))
        return started < preflight.dailyBudget
      })
      if (!retry) {
        await step.run('budget-still-spent', () =>
          updatePublishRecord(db, preflight.recordId, {
            error: { message: 'The upload budget was spent again before this item ran.' },
          }),
        )
        return { targetType, targetId, outcome: 'budget-deferred' as const }
      }
    }

    // -----------------------------------------------------------------------
    // The atomic claim — the §5 double-upload guard
    // -----------------------------------------------------------------------

    const claimed = await step.run('claim', async () => {
      const row = await beginUpload(db, preflight.recordId)
      return row !== undefined
    })
    if (!claimed) {
      return { targetType, targetId, outcome: 'already-uploading' as const }
    }

    // -----------------------------------------------------------------------
    // Mock path: the bookkeeping without YouTube
    // -----------------------------------------------------------------------

    if (mocked) {
      await step.run('mock-scheduled', async () => {
        await updatePublishRecord(db, preflight.recordId, {
          status: 'scheduled',
          youtubeVideoId: `mock-${targetId.slice(-8)}`,
          error: null,
        })
        await notify({
          kind: 'publish-success',
          title: `Scheduled (mock): ${preflight.metadata.title}`,
          body: `The ${targetType} is scheduled for ${preflight.publishAtIso} — mock mode, nothing reached YouTube.`,
          href: `/projects/${projectId}?stage=publish`,
        })
      })
      return { targetType, targetId, outcome: 'mock-scheduled' as const }
    }

    // -----------------------------------------------------------------------
    // Live: mint the short-lived token, hand the job to media-utils
    // -----------------------------------------------------------------------

    const minted = await step.run('mint-token', async () => {
      const refreshToken = await youtubeRefreshToken(db, env.SECRETS_ENCRYPTION_KEY)
      if (!refreshToken) throw new NonRetriableError('The YouTube connection vanished mid-run.')
      try {
        const grant = await refreshAccessToken(refreshToken)
        return { ok: true as const, accessToken: grant.accessToken }
      } catch (error) {
        if (error instanceof YoutubeAuthError && error.needsReconnect) {
          await recordVerifyResult(db, 'youtube', 'invalid')
          await updatePublishRecord(db, preflight.recordId, {
            status: 'failed',
            error: { message: describeYoutubeAction({ kind: 'reconnect' }) },
          })
          await notify({
            kind: 'run-failed',
            title: 'YouTube needs reconnecting',
            body: 'The stored consent is no longer honoured. Reconnect in Settings → Connections.',
            href: '/settings?tab=connections',
          })
          return { ok: false as const }
        }
        throw error
      }
    })
    if (!minted.ok) return { targetType, targetId, outcome: 'reconnect' as const }

    const jobId = await step.run('submit-upload', async () => {
      const id = newId<'run'>()
      await submitMediaJob({
        kind: 'upload-youtube',
        jobId: id,
        projectId,
        callbackUrl: brokerCallbackUrl(),
        videoS3Key: preflight.videoS3Key,
        accessToken: minted.accessToken,
        title: preflight.metadata.title,
        description: preflight.metadata.description,
        tags: preflight.metadata.tags,
        privacyStatus: 'private',
        publishAt: preflight.publishAtIso,
      })
      return id
    })

    const completion = await step.waitForEvent('await-upload', {
      event: 'media/job.completed',
      timeout: UPLOAD_TIMEOUT,
      if: `async.data.jobId == "${jobId}"`,
    })

    // -----------------------------------------------------------------------
    // Failure: through the mapper, never raw
    // -----------------------------------------------------------------------

    if (!completion || completion.data.ok !== true) {
      const message =
        completion?.data.error ?? `no completion within ${UPLOAD_TIMEOUT} — the job may be dead`
      const action = mapYoutubeError({ message })

      if (action.kind === 'requeue-tomorrow' || action.kind === 'pause-queue') {
        const wakeAt =
          action.kind === 'requeue-tomorrow'
            ? new Date(quotaDayStartUtc(new Date()).getTime() + 24 * 3600 * 1000 + 10 * 60 * 1000)
            : new Date(Date.now() + action.hours * 3600 * 1000)
        await step.run('requeue-note', async () => {
          await updatePublishRecord(db, preflight.recordId, {
            status: 'draft',
            error: { message: describeYoutubeAction(action) },
          })
          await notify({
            kind: 'run-failed',
            title: 'Upload deferred',
            body: describeYoutubeAction(action),
            href: `/projects/${projectId}?stage=publish`,
          })
        })
        await step.sleepUntil('requeue-wait', wakeAt)
        await step.sendEvent('requeue-emit', [
          events.publishRequested.create({ projectId, targetType, targetId }),
        ])
        return { targetType, targetId, outcome: 'requeued' as const }
      }

      if (action.kind === 'retry' && (attempt ?? 0) < MAX_ATTEMPTS - 1) {
        await step.run('retry-note', () =>
          updatePublishRecord(db, preflight.recordId, {
            status: 'draft',
            error: { message: describeYoutubeAction(action) },
          }),
        )
        await step.sleep('retry-wait', '10m')
        await step.sendEvent('retry-emit', [
          events.publishRequested.create({
            projectId,
            targetType,
            targetId,
            attempt: (attempt ?? 0) + 1,
          }),
        ])
        return { targetType, targetId, outcome: 'retrying' as const }
      }

      await step.run('upload-failed', async () => {
        if (action.kind === 'reconnect') await recordVerifyResult(db, 'youtube', 'invalid')
        await updatePublishRecord(db, preflight.recordId, {
          status: 'failed',
          error: { message: `${describeYoutubeAction(action)} (${message})` },
        })
        await notify({
          kind: 'run-failed',
          title: `Upload failed: ${preflight.metadata.title}`,
          body: describeYoutubeAction(action),
          href:
            action.kind === 'reconnect'
              ? '/settings?tab=connections'
              : `/projects/${projectId}?stage=publish`,
        })
      })
      return { targetType, targetId, outcome: 'failed' as const }
    }

    const videoId = (completion.data.result as { videoId?: string } | undefined)?.videoId
    if (!videoId) throw new NonRetriableError('The upload completed without a videoId.')

    await step.run('record-video', () =>
      updatePublishRecord(db, preflight.recordId, {
        status: 'uploaded',
        youtubeVideoId: videoId,
        error: null,
      }),
    )

    // -----------------------------------------------------------------------
    // Thumbnail (masters only) — a failure here warns, never unschedules
    // -----------------------------------------------------------------------

    if (targetType === 'master' && preflight.thumbKey !== null) {
      await step.run('set-thumbnail', async () => {
        const url = await presignGet(preflight.thumbKey!)
        const bytes = Buffer.from(await (await fetch(url)).arrayBuffer())
        const contentType = preflight.thumbKey!.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
        const result = await setThumbnail(minted.accessToken, videoId, bytes, contentType)
        if (!result.ok) {
          console.error('[publish] thumbnails.set failed:', result.error)
          await notify({
            kind: 'run-failed',
            title: 'Thumbnail did not stick',
            body: `The video is scheduled, but thumbnails.set failed: ${result.error}. Set it in Studio.`,
            href: `/projects/${projectId}?stage=publish`,
          })
        }
      })
    }

    // -----------------------------------------------------------------------
    // Processing poll, bounded — then scheduled
    // -----------------------------------------------------------------------

    for (let poll = 0; poll < PROCESSING_POLLS; poll += 1) {
      const processed = await step.run(`poll-processing-${poll}`, () =>
        videoProcessed(minted.accessToken, videoId),
      )
      if (processed) break
      if (poll < PROCESSING_POLLS - 1) await step.sleep(`processing-wait-${poll}`, '60s')
    }

    await step.run('scheduled', async () => {
      await updatePublishRecord(db, preflight.recordId, { status: 'scheduled', error: null })
      await notify({
        kind: 'publish-success',
        title: `Scheduled: ${preflight.metadata.title}`,
        body: `Private on YouTube (${videoId}), goes public ${preflight.publishAtIso}.`,
        href: `/projects/${projectId}?stage=publish`,
      })
    })

    return { targetType, targetId, outcome: 'scheduled' as const, videoId }
  },
)
