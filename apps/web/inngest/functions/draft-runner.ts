import {
  getSettings,
  insertRender,
  latestTimeline,
  setTimelineKey,
  updateRender,
} from '@boom-busters/db'
import { reserve, round4, settle } from '@boom-busters/cost'
import {
  BudgetExceededError,
  estimateRenderCostUsd,
  parseEventData,
  timelineDurationMs,
  TimelineSchema,
} from '@boom-busters/schemas'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { brokerConfigured, submitRender } from '@/lib/broker'
import { storageConfigured, putObject } from '@/lib/storage'
import { timelineKey } from '../lib/assembly'
import { inngest } from '../client'
import { events } from '../events'

/**
 * draft-runner (M6.8): `render/draft.requested` → broker invoke at half
 * scale → wait for the webhook → the renders row is done. Nothing else.
 *
 * A draft is the moderation copy: the assembly-runner requests one
 * automatically after storing a compiled timeline, and the preview screen's
 * "Render draft" button re-requests one after a music swap. It exists so
 * the cut can be judged in a native `<video>` element — measured 2026-08-21:
 * on a software-decode machine the live player runs 14fps with half-second
 * pauses while a plain video element plays the same content flawlessly.
 *
 * Deliberately unlike the render-runner: no QC (the master gets that), no
 * stage or gate bookkeeping (Gate 5a parks in the assembly-runner and the
 * draft arrives beside it, asynchronously), and a failure marks only the
 * renders row — a project must never read "failed" because its advisory
 * copy did. Live-only by design: in mock mode the preview player is free
 * and the fixture render already proves the pipeline, so no draft is
 * requested and none renders.
 */

const FUNCTION_ID = 'draft-runner'

/** How much longer than the configured render timeout we wait for the webhook. */
const WEBHOOK_GRACE_MINUTES = 10

export const draftRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Draft render',
    retries: 2,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    triggers: [events.renderDraftRequested],
  },
  async ({ event, step }) => {
    const { projectId } = parseEventData('render/draft.requested', event.data)

    // Pre-flight, before any row exists: a draft in mock mode or without a
    // broker is a request nothing can honour — skip loudly in the run
    // result, silently everywhere else. Never a failure: nothing failed.
    if (mockProvidersEnabled() || !brokerConfigured() || !storageConfigured()) {
      return { projectId, outcome: 'skipped' as const }
    }

    const setup = await step.run('load-draft', async () => {
      const timelineRow = await latestTimeline(db, projectId)
      if (!timelineRow) {
        throw new NonRetriableError(
          'There is no compiled timeline to draft-render — run the assembly stage first.',
        )
      }
      const timeline = TimelineSchema.parse(timelineRow.json)
      const durationSec = timelineDurationMs(timeline) / 1000
      const estimate = estimateRenderCostUsd(durationSec, 'draft')

      const render = await insertRender(db, {
        projectId,
        timelineVersion: timelineRow.version,
        kind: 'draft',
        costUsd: String(estimate),
      })

      const settings = await getSettings(db)
      return {
        renderId: render.id,
        timelineVersion: timelineRow.version,
        timelineS3Key: timelineRow.s3Key ?? '',
        durationSec,
        estimate,
        timeoutMinutes: settings.render.timeoutMinutes,
      }
    })

    const invoked = await step.run('invoke-broker', async () => {
      // A timeline compiled while R2 was absent has no key yet; the invoke
      // needs bytes at a key, not a DB row (same fallback as the master).
      let key = setup.timelineS3Key
      if (key === '') {
        const timelineRow = await latestTimeline(db, projectId)
        if (!timelineRow) throw new NonRetriableError('The timeline vanished mid-run.')
        key = timelineKey(projectId, timelineRow.version)
        await putObject(key, Buffer.from(JSON.stringify(timelineRow.json)), 'application/json')
        await setTimelineKey(db, timelineRow.id, key)
      }

      // Reserved before the invoke, like every spend. A draft that would
      // cross the ceiling refuses quietly on its own row — it must not park
      // the project at the budget gate over a dime's advisory copy.
      let ledgerId: string
      try {
        ledgerId = await reserve(
          db,
          {
            provider: 'remotion',
            operation: 'render-draft',
            projectId,
            estimateUsd: setup.estimate,
            meta: { renderId: setup.renderId, timelineVersion: setup.timelineVersion },
          },
          await getSettings(db),
          new Date(),
        )
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return {
            ok: false as const,
            message:
              `The draft would cross the monthly budget ceiling ` +
              `($${error.monthSpendUsd.toFixed(2)} spent of $${error.budgetUsd.toFixed(2)}). ` +
              'The live preview still plays; the master render offers the budget gate.',
          }
        }
        throw error
      }

      const accepted = await submitRender({
        projectId,
        renderId: setup.renderId,
        kind: 'draft',
        timelineS3Key: key,
        composition: 'DocumentaryMaster',
        expectedDurationSec: setup.durationSec,
      })

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
      await step.run('draft-over-budget', async () => {
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message: invoked.message },
          completedAt: new Date(),
        })
      })
      return { projectId, outcome: 'over-budget' as const }
    }

    const webhookTimeout = `${setup.timeoutMinutes + WEBHOOK_GRACE_MINUTES}m`
    const [completed, failed] = await Promise.all([
      step.waitForEvent('await-render-completed', {
        event: 'render/completed',
        timeout: webhookTimeout,
        if: `async.data.renderId == "${setup.renderId}"`,
      }),
      step.waitForEvent('await-render-failed', {
        event: 'render/failed',
        timeout: webhookTimeout,
        if: `async.data.renderId == "${setup.renderId}"`,
      }),
    ])

    if (!completed) {
      await step.run('draft-not-completed', async () => {
        const detail = failed
          ? `${failed.data.reason}${failed.data.message ? `: ${failed.data.message}` : ''}`
          : `no webhook within ${webhookTimeout} — the broker may still settle it`
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message: detail },
          completedAt: new Date(),
        })
        // Lambda ran (or may have); the spend is sunk either way.
        await settle(db, invoked.ledgerId, round4(setup.estimate))
      })
      return { projectId, outcome: 'failed' as const }
    }

    await step.run('draft-ready', async () => {
      await settle(db, invoked.ledgerId, round4(completed.data.costUsd))
      await updateRender(db, setup.renderId, {
        status: 'done',
        progressPct: 100,
        outputS3Key: completed.data.outputS3Key,
        costUsd: String(round4(completed.data.costUsd)),
        completedAt: new Date(),
      })
    })

    return { projectId, outcome: 'draft-ready' as const, renderId: setup.renderId }
  },
)
