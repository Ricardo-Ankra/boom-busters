import {
  getProject,
  getSettings,
  insertRender,
  latestTimeline,
  setProjectStage,
  setTimelineKey,
  updateRender,
} from '@boom-busters/db'
import { reserve, round4, settle } from '@boom-busters/cost'
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
import { mockProvidersEnabled } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { brokerCallbackUrl, brokerConfigured, submitMediaJob, submitRender } from '@/lib/broker'
import { renderFixtureLocally } from '@/lib/local-render'
import { storageConfigured, putObject } from '@/lib/storage'
import { timelineKey } from '../lib/assembly'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markStageFailed, type GateContext } from '../lib/gates'

/**
 * render-runner (build spec section 7.6): `gate/preview.approved` — the
 * user clicked "Render master", the real spend decision — → broker invoke →
 * wait for the webhook-driven completion event → QC → `project/master.ready`.
 *
 * Two paths, one shape, forked on MOCK_PROVIDERS — never on whether the
 * broker env vars happen to exist (the M4.6 lesson: env presence as a mode
 * switch is one fact with two meanings, and the day AWS_BROKER_URL landed
 * in a dev .env.local every "mock" render became a real Lambda invoke):
 * - **Live** (mock off): the timeline's canonical JSON is on R2, the
 *   broker materialises and invokes Remotion Lambda, and completion
 *   arrives as `render/completed`/`render/failed` through the broker hook.
 *   QC runs in media-utils on the finished master. Live with no broker
 *   configured refuses at pre-flight (decision 61's rule) — a missing
 *   deployment will not fix itself between retries.
 * - **Mock/local** (MOCK_PROVIDERS=1): a real `renderMedia` of the
 *   20-second fixture on this machine (spec section 13), progress mirrored
 *   into the renders row; QC is a deterministic pass, since media-utils
 *   does not exist locally.
 *
 * Stopping (section 8.1): `project/cancelled` cancels this run. The broker
 * cancel — tombstone, discard, no completion event — is issued by the stop
 * action itself, because the cancelled run can no longer do it.
 */

const FUNCTION_ID = 'render-runner'

/** How much longer than the configured render timeout we wait for the webhook. */
const WEBHOOK_GRACE_MINUTES = 10

/** How long media-utils may chew on a full master's QC scan. */
const QC_TIMEOUT = '30m'

export const renderRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Render master',
    retries: 4,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await markStageFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        serialiseError(event.data.error),
      )
    },
    triggers: [events.previewApproved],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('gate/preview.approved', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    // -----------------------------------------------------------------------
    // The renders row exists before anything can cost money
    // -----------------------------------------------------------------------

    const setup = await step.run('load-render', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      const timelineRow = await latestTimeline(db, projectId)
      if (!timelineRow) {
        throw new NonRetriableError(
          'There is no compiled timeline to render — run the assembly stage first.',
        )
      }
      const timeline = TimelineSchema.parse(timelineRow.json)
      const durationSec = timelineDurationMs(timeline) / 1000
      const estimate = estimateRenderCostUsd(durationSec)

      await setProjectStage(db, projectId, { stage: 'assembly', stageStatus: 'running' })

      const render = await insertRender(db, {
        projectId,
        timelineVersion: timelineRow.version,
        kind: 'master',
        costUsd: String(estimate),
      })

      const settings = await getSettings(db)
      return {
        renderId: render.id,
        timelineId: timelineRow.id,
        timelineVersion: timelineRow.version,
        timelineS3Key: timelineRow.s3Key ?? '',
        durationSec,
        estimate,
        timeoutMinutes: settings.render.timeoutMinutes,
      }
    })

    // -----------------------------------------------------------------------
    // Mock/local path: a real render of the 20-second fixture, no AWS
    // -----------------------------------------------------------------------

    if (mockProvidersEnabled()) {
      const localOutcome = await step.run('render-local', async () => {
        await updateRender(db, setup.renderId, { status: 'rendering', startedAt: new Date() })
        try {
          const { outputKey } = await renderFixtureLocally({
            renderId: setup.renderId,
            onProgress: (progress) => {
              void updateRender(db, setup.renderId, {
                progressPct: Math.round(progress * 100),
              }).catch(() => undefined)
            },
          })
          return { ok: true as const, outputKey }
        } catch (error) {
          return { ok: false as const, message: serialiseError(error).message }
        }
      })

      if (!localOutcome.ok) {
        await step.run('local-render-failed', async () => {
          await updateRender(db, setup.renderId, {
            status: 'failed',
            error: { message: localOutcome.message },
            completedAt: new Date(),
          })
          await markStageFailed(ctx, {
            message: `The local render failed: ${localOutcome.message}`,
          })
        })
        return { projectId, outcome: 'failed' as const }
      }

      // Media-utils does not exist on this machine, so QC is a pass by
      // construction — and says so, instead of pretending it measured.
      const qcReport: QcReport = {
        passed: true,
        integratedLufs: -14,
        issues: [],
      }

      await step.run('local-master-ready', async () => {
        await updateRender(db, setup.renderId, {
          status: 'done',
          progressPct: 100,
          outputS3Key: localOutcome.outputKey,
          qcReport,
          completedAt: new Date(),
        })
        await setProjectStage(db, projectId, { stage: 'shorts', stageStatus: 'queued' })
      })

      await step.sendEvent('emit-master-ready', [
        events.projectMasterReady.create({ projectId, renderId: setup.renderId }),
      ])

      return { projectId, outcome: 'master-ready' as const, renderId: setup.renderId }
    }

    // -----------------------------------------------------------------------
    // Live path: canonical JSON to R2, broker invoke, webhook wait
    // -----------------------------------------------------------------------

    // Refused before the reservation: nothing is spent, and the message
    // names both ways out because the cheap one should not need discovering.
    if (!brokerConfigured()) {
      await step.run('missing-broker', async () => {
        const message =
          'Providers are live but no render broker is configured. Set AWS_BROKER_URL and ' +
          'AWS_BROKER_TOKEN (deployed per infra/README.md), or run with MOCK_PROVIDERS=1 ' +
          'for a local fixture render.'
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message },
          completedAt: new Date(),
        })
        await markStageFailed(ctx, { message })
      })
      return { projectId, outcome: 'failed' as const }
    }

    const invoked = await step.run('invoke-broker', async () => {
      if (!storageConfigured()) {
        throw new NonRetriableError(
          'The broker is configured but R2 is not — the canonical timeline has nowhere to ' +
            'live. Set the R2_* variables; the broker reads the timeline from R2 by key.',
        )
      }

      // Assembly uploads the compiled JSON when storage is configured; a
      // timeline compiled while R2 was absent has no key yet, so it is
      // uploaded here — the invoke needs bytes at a key, not a DB row.
      let key = setup.timelineS3Key
      if (key === '') {
        const timelineRow = await latestTimeline(db, projectId)
        if (!timelineRow) throw new NonRetriableError('The timeline vanished mid-run.')
        key = timelineKey(projectId, timelineRow.version)
        await putObject(key, Buffer.from(JSON.stringify(timelineRow.json)), 'application/json')
        await setTimelineKey(db, timelineRow.id, key)
      }

      // The spend is reserved BEFORE the invoke — a render that would cross
      // the monthly ceiling refuses to start. The pre-render confirm is the
      // real cancel point (section 8.1); nothing has been spent yet here.
      let ledgerId: string
      try {
        ledgerId = await reserve(
          db,
          {
            provider: 'remotion',
            operation: 'render-master',
            projectId,
            estimateUsd: setup.estimate,
            meta: { renderId: setup.renderId, timelineVersion: setup.timelineVersion },
          },
          await getSettings(db),
          new Date(),
        )
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        throw error
      }

      const accepted = await submitRender({
        projectId,
        renderId: setup.renderId,
        kind: 'master',
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
      await step.run('render-over-budget', async () => {
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: invoked.gate,
          completedAt: new Date(),
        })
        await markStageFailed(ctx, invoked.gate)
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
      await step.run('render-not-completed', async () => {
        const detail = failed
          ? `${failed.data.reason}${failed.data.message ? `: ${failed.data.message}` : ''}`
          : `no webhook within ${webhookTimeout} — the broker may still settle it`
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message: detail },
          completedAt: new Date(),
        })
        // The reservation settles at its estimate: Lambda ran (or may have);
        // the spend is sunk either way (section 8.1).
        await settle(db, invoked.ledgerId, round4(setup.estimate))
        await markStageFailed(ctx, { message: `The render failed: ${detail}` })
      })
      return { projectId, outcome: 'failed' as const }
    }

    await step.run('record-completion', async () => {
      await settle(db, invoked.ledgerId, round4(completed.data.costUsd))
      await updateRender(db, setup.renderId, {
        status: 'qc',
        progressPct: 100,
        outputS3Key: completed.data.outputS3Key,
        costUsd: String(round4(completed.data.costUsd)),
      })
    })

    // -----------------------------------------------------------------------
    // QC: never auto-publish around a failure (section 7.6)
    // -----------------------------------------------------------------------

    const qcJobId = await step.run('submit-qc', async () => {
      const id = newId<'run'>()
      await submitMediaJob({
        kind: 'qc',
        jobId: id,
        projectId,
        callbackUrl: brokerCallbackUrl(),
        s3Key: completed.data.outputS3Key,
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
        await markStageFailed(ctx, { message: `The master rendered but QC did not run: ${detail}` })
      })
      return { projectId, outcome: 'failed' as const }
    }

    const qcReport = QcReportSchema.parse(qcDone.data.result)

    if (!qcReport.passed) {
      await step.run('qc-failed', async () => {
        await updateRender(db, setup.renderId, {
          status: 'failed',
          qcReport,
          completedAt: new Date(),
        })
        await markStageFailed(ctx, {
          message:
            `QC failed: ${qcReport.issues.length} issue(s), integrated loudness ` +
            `${qcReport.integratedLufs} LUFS. The master is playable on the preview screen ` +
            'for inspection; nothing publishes around a QC failure.',
        })
      })
      return { projectId, outcome: 'qc-failed' as const }
    }

    await step.run('master-ready', async () => {
      await updateRender(db, setup.renderId, {
        status: 'done',
        qcReport,
        completedAt: new Date(),
      })
      await setProjectStage(db, projectId, { stage: 'shorts', stageStatus: 'queued' })
    })

    await step.sendEvent('emit-master-ready', [
      events.projectMasterReady.create({ projectId, renderId: setup.renderId }),
    ])

    return { projectId, outcome: 'master-ready' as const, renderId: setup.renderId }
  },
)
