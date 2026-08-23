import {
  failInFlightRenders,
  getRender,
  getShort,
  getSettings,
  insertRender,
  latestRender,
  latestTimeline,
  listMusicBeds,
  updateRender,
  updateShort,
} from '@boom-busters/db'
import { release, reserve, round4, settle } from '@boom-busters/cost'
import {
  BudgetExceededError,
  estimateRenderCostUsd,
  newId,
  parseEventData,
  QcReportSchema,
  serialiseError,
  timelineDurationMs,
  TimelineSchema,
} from '@boom-busters/schemas'
import type { QcReport } from '@boom-busters/schemas'
import { compileShortTimeline } from '@boom-busters/timeline'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { brokerCallbackUrl, brokerConfigured, submitMediaJob, submitRender } from '@/lib/broker'
import { storageConfigured, putObject } from '@/lib/storage'
import { pickShortsBed } from '../lib/assembly'
import { inngest } from '../client'
import { events } from '../events'

/**
 * short-render-runner (build spec section 7.2 item 7, the render half):
 * `shorts/render.requested` → compile the Short's timeline from the stored
 * master at its CURRENT ending and bed → broker invoke of `ShortVertical` →
 * webhook wait → QC → the card is ready. One Short per run, so each run's
 * event wait starts before its own render can complete; the concurrency
 * limit below is the "parallel, capped" of the spec.
 *
 * Like the draft-runner, a failure marks only this render's row (and via
 * shortId, only THIS Short's row — siblings render concurrently). Unlike
 * the draft, a Short is a deliverable: it gets QC, and its `shorts` row
 * tracks the render of its current configuration.
 *
 * Mock mode renders nothing but finishes the bookkeeping: the row goes
 * `done` reusing the local fixture master's file when one exists, so the
 * Shorts screen (and the E2E suite) has real cards with real state.
 */

const FUNCTION_ID = 'short-render-runner'

/** How much longer than the configured render timeout we wait for the webhook. */
const WEBHOOK_GRACE_MINUTES = 10

/** A Short is at most 3 minutes; its QC scan does not get the master's 30. */
const QC_TIMEOUT = '15m'

/** The R2 key one Short-render's compiled timeline is stored under. */
export function shortTimelineKey(projectId: string, shortId: string, renderId: string): string {
  return `boom-busters/timelines/${projectId}/short-${shortId}-${renderId}.json`
}

export const shortRenderRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Render short',
    retries: 2,
    // The spec's "parallel, capped": five Shorts render two at a time. The
    // broker stack's RENDER_CAP is 2 as well — this cap exists so the queue
    // forms here, visibly, instead of as broker 429s.
    concurrency: [{ limit: 2 }],
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      const shortId = event.data.event.data['shortId']
      if (typeof projectId !== 'string' || typeof shortId !== 'string') return
      await failInFlightRenders(db, projectId, 'short', serialiseError(event.data.error), shortId)
    },
    triggers: [events.shortsRenderRequested],
  },
  async ({ event, step }) => {
    const { projectId, shortId } = parseEventData('shorts/render.requested', event.data)
    const mocked = mockProvidersEnabled()

    const setup = await step.run('compile-short', async () => {
      const short = await getShort(db, shortId)
      if (!short) throw new NonRetriableError(`Short ${shortId} no longer exists`)

      const timelineRow = await latestTimeline(db, projectId)
      if (!timelineRow) {
        throw new NonRetriableError('There is no compiled master timeline to slice.')
      }
      const master = TimelineSchema.parse(timelineRow.json)
      const beds = await listMusicBeds(db)

      const timeline = compileShortTimeline({
        master,
        segmentRef: short.segmentRef,
        ending: short.ending,
        music: pickShortsBed(beds, master.brand.music.shortsStyle),
      })

      const durationSec = timelineDurationMs(timeline) / 1000
      const estimate = estimateRenderCostUsd(durationSec, 'short')

      // Idempotent across step retries: an attempt that died after inserting
      // its row must not leave that row queued forever and open a second one
      // — the card would track the new render while the orphan sat at 0%.
      const previous = short.renderId ? await getRender(db, short.renderId) : undefined
      let render =
        previous && previous.shortId === shortId && previous.status === 'queued'
          ? previous
          : undefined
      if (!render) {
        render = await insertRender(db, {
          projectId,
          timelineVersion: timelineRow.version,
          kind: 'short',
          shortId,
          costUsd: String(estimate),
        })
        // The card tracks the render of its current configuration from the
        // moment one is queued — in-flight state included.
        await updateShort(db, shortId, { renderId: render.id })
      }

      let timelineS3Key = ''
      if (!mocked && storageConfigured()) {
        timelineS3Key = shortTimelineKey(projectId, shortId, render.id)
        await putObject(timelineS3Key, Buffer.from(JSON.stringify(timeline)), 'application/json')
      }

      const settings = await getSettings(db)
      return {
        renderId: render.id,
        timelineVersion: timelineRow.version,
        timelineS3Key,
        durationSec,
        estimate,
        timeoutMinutes: settings.render.timeoutMinutes,
      }
    })

    // -----------------------------------------------------------------------
    // Mock path: bookkeeping without a render
    // -----------------------------------------------------------------------

    if (mocked) {
      await step.run('mock-short-ready', async () => {
        // The local fixture master doubles as the mock Short's file — a
        // 16:9 file in a 9:16 player is visibly a stand-in, which is honest.
        const master = await latestRender(db, projectId, 'master')
        const qcReport: QcReport = { passed: true, integratedLufs: -14, issues: [] }
        await updateRender(db, setup.renderId, {
          status: 'done',
          progressPct: 100,
          ...(master?.outputS3Key ? { outputS3Key: master.outputS3Key } : {}),
          qcReport,
          completedAt: new Date(),
        })
      })
      return { projectId, shortId, outcome: 'mock-ready' as const, renderId: setup.renderId }
    }

    // -----------------------------------------------------------------------
    // Live path: broker invoke, webhook wait, QC
    // -----------------------------------------------------------------------

    if (!brokerConfigured() || !storageConfigured() || setup.timelineS3Key === '') {
      await step.run('missing-broker', async () => {
        const message =
          'Providers are live but the render broker or R2 is not configured — the Short ' +
          'cannot render. Set AWS_BROKER_URL, AWS_BROKER_TOKEN and the R2_* variables, or ' +
          'run with MOCK_PROVIDERS=1.'
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message },
          completedAt: new Date(),
        })
      })
      return { projectId, shortId, outcome: 'failed' as const }
    }

    const invoked = await step.run('invoke-broker', async () => {
      // Reserved before the invoke, like every spend. Over-budget fails
      // only this card — five Shorts must not park the project five times.
      let ledgerId: string
      try {
        ledgerId = await reserve(
          db,
          {
            provider: 'remotion',
            operation: 'render-short',
            projectId,
            estimateUsd: setup.estimate,
            meta: { renderId: setup.renderId, shortId, timelineVersion: setup.timelineVersion },
          },
          await getSettings(db),
          new Date(),
        )
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return {
            ok: false as const,
            message:
              `This Short would cross the monthly budget ceiling ` +
              `($${error.monthSpendUsd.toFixed(2)} spent of $${error.budgetUsd.toFixed(2)}).`,
          }
        }
        throw error
      }

      // A refused invoke releases its reservation before the retry (the
      // draft's 502 lesson, 2026-08-21).
      let accepted
      try {
        accepted = await submitRender({
          projectId,
          renderId: setup.renderId,
          kind: 'short',
          timelineS3Key: setup.timelineS3Key,
          composition: 'ShortVertical',
          expectedDurationSec: setup.durationSec,
        })
      } catch (error) {
        await release(db, ledgerId)
        throw error
      }

      await updateRender(db, setup.renderId, {
        status: 'rendering',
        brokerRenderId: accepted.brokerRenderId,
        remotionRenderId: accepted.remotionRenderId,
        costUsd: String(accepted.estimatedCostUsd),
        startedAt: new Date(),
      })

      return { ok: true as const, ledgerId }
    })

    if (!invoked.ok) {
      await step.run('short-over-budget', async () => {
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message: invoked.message },
          completedAt: new Date(),
        })
      })
      return { projectId, shortId, outcome: 'over-budget' as const }
    }

    // ONE wait on ONE event (see draft-runner: the completed/failed pair
    // under Promise.all stalled every render for the full timeout window).
    const webhookTimeout = `${setup.timeoutMinutes + WEBHOOK_GRACE_MINUTES}m`
    const settled = await step.waitForEvent('await-render-settled', {
      event: 'render/settled',
      timeout: webhookTimeout,
      if: `async.data.renderId == "${setup.renderId}"`,
    })
    const completed =
      settled && settled.data.result === 'completed'
        ? { outputS3Key: settled.data.outputS3Key ?? '', costUsd: settled.data.costUsd ?? 0 }
        : null

    if (!completed) {
      await step.run('short-not-completed', async () => {
        const detail = settled
          ? `${settled.data.reason ?? 'error'}${settled.data.message ? `: ${settled.data.message}` : ''}`
          : `no webhook within ${webhookTimeout} — the broker may still settle it`
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message: detail },
          completedAt: new Date(),
        })
        // Lambda ran (or may have); the spend is sunk either way.
        await settle(db, invoked.ledgerId, round4(setup.estimate))
      })
      return { projectId, shortId, outcome: 'failed' as const }
    }

    await step.run('record-completion', async () => {
      await settle(db, invoked.ledgerId, round4(completed.costUsd))
      await updateRender(db, setup.renderId, {
        status: 'qc',
        progressPct: 100,
        outputS3Key: completed.outputS3Key,
        costUsd: String(round4(completed.costUsd)),
      })
    })

    const qcJobId = await step.run('submit-qc', async () => {
      const id = newId<'run'>()
      await submitMediaJob({
        kind: 'qc',
        jobId: id,
        projectId,
        callbackUrl: brokerCallbackUrl(),
        s3Key: completed.outputS3Key,
        targetLufs: -14,
      })
      return id
    })

    const qcDone = await step.waitForEvent('await-qc', {
      event: 'media/job.completed',
      timeout: QC_TIMEOUT,
      if: `async.data.jobId == "${qcJobId}"`,
    })

    if (!qcDone || qcDone.data.ok !== true) {
      await step.run('qc-errored', async () => {
        const detail = qcDone?.data.error ?? `no QC result within ${QC_TIMEOUT}`
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message: `QC did not run: ${detail}` },
          completedAt: new Date(),
        })
      })
      return { projectId, shortId, outcome: 'failed' as const }
    }

    const qcReport = QcReportSchema.parse(qcDone.data.result)
    if (!qcReport.passed) {
      await step.run('qc-failed', async () => {
        await updateRender(db, setup.renderId, {
          status: 'failed',
          qcReport,
          completedAt: new Date(),
        })
      })
      return { projectId, shortId, outcome: 'qc-failed' as const }
    }

    await step.run('short-ready', async () => {
      await updateRender(db, setup.renderId, {
        status: 'done',
        qcReport,
        completedAt: new Date(),
      })
    })

    return { projectId, shortId, outcome: 'short-ready' as const, renderId: setup.renderId }
  },
)
