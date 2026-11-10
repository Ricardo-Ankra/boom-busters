import {
  failInFlightRenders,
  getProject,
  getRender,
  channelForProject,
  getWorkspace,
  insertRender,
  latestRender,
  latestTimeline,
  setProjectStage,
  setTimelineKey,
  shortsEnabledForProject,
  updateRender,
  updateRenderParts,
} from '@boom-busters/db'
import { release, reserve, round4, settle } from '@boom-busters/cost'
import {
  BudgetExceededError,
  combineLoudness,
  estimateRenderCostUsd,
  JoinResultSchema,
  mergeQcReports,
  newId,
  parseEventData,
  partsProgressPct,
  partWaves,
  planRenderParts,
  QcReportSchema,
  RenderPartsSchema,
  rendersInParts,
  serialiseError,
  settleRenderParts,
  timelineDurationMs,
  TimelineSchema,
} from '@boom-busters/schemas'
import type { LoudnormMeasurement, QcReport, RenderPart } from '@boom-busters/schemas'
import type { GetStepTools } from 'inngest'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { NonRetriableError, RetryAfterError } from 'inngest'
import { db } from '@/lib/db'
import {
  brokerCallbackUrl,
  brokerConfigured,
  brokerErrorStatus,
  cancelRender,
  presignRenderOutput,
  submitMediaJob,
  submitRender,
} from '@/lib/broker'
import { renderFixtureLocally } from '@/lib/local-render'
import { storageConfigured, putObject } from '@/lib/storage'
import { timelineKey } from '../lib/assembly'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markStageFailed, type GateContext } from '../lib/gates'
import { settleRenderLedger } from '../lib/render-ledger'

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
 *   arrives as one `render/settled` event through the broker hook.
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

/** Two ffmpeg passes over the master's audio; the video stream is copied. */
const LOUDNORM_TIMEOUT = '20m'

/**
 * Where the project goes once the master is done. A format with Shorts off
 * skips the Shorts stage for Publish, the stage `advanceToPublish` lands on;
 * the switch is read from the channel's current bible (ruling 18), inside
 * the step that calls this.
 */
async function leaveMaster(projectId: string): Promise<{ shorts: boolean }> {
  const shorts = await shortsEnabledForProject(db, projectId)
  await setProjectStage(
    db,
    projectId,
    shorts
      ? { stage: 'shorts', stageStatus: 'queued' }
      : { stage: 'publish', stageStatus: 'awaiting_review' },
  )
  return { shorts }
}

export const renderRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Render master',
    retries: 4,
    // One live run per project: a duplicate trigger cancels the run it
    // duplicates rather than stacking beside it (decision 233, amended).
    singleton: { key: 'event.data.projectId', mode: 'cancel' },
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      const error = serialiseError(event.data.error)
      // A film in parts that dies mid-way leaves its reservation at the full
      // estimate; settle it on what ran, before the row goes terminal.
      const latest = await latestRender(db, projectId, 'master')
      if (latest?.parts && ['queued', 'invoking', 'rendering', 'qc'].includes(latest.status)) {
        await settleRenderLedger(db, latest)
      }
      // The row the run opened must reach a terminal state too, or the
      // render panel keeps polling an honest-looking 0% forever.
      await failInFlightRenders(db, projectId, 'master', error)
      await markStageFailed({ inngestRunId: '', functionId: FUNCTION_ID, projectId }, error)
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

      // A master longer than the single-render limit renders in parts; the
      // plan goes on the row now so the progress route sees it from the start.
      // Mock mode renders the fixture locally and never plans parts, or the
      // progress route would shadow the local fixture with a parts plan.
      const parts: RenderPart[] | null =
        rendersInParts(durationSec) && !mockProvidersEnabled()
          ? planRenderParts(timeline).map((plan) => ({
              index: plan.index,
              renderId: newId<'render'>(),
              frameRange: plan.frameRange,
              startMs: plan.startMs,
              durationMs: plan.durationMs,
              status: 'queued' as const,
              attempt: 1,
              priorRenderIds: [],
            }))
          : null
      if (parts) await updateRender(db, render.id, { parts })
      const totalFrames = (parts ?? []).reduce(
        (sum, part) => sum + (part.frameRange[1] - part.frameRange[0] + 1),
        0,
      )

      const { settings } = await channelForProject(db, projectId)
      return {
        parts,
        totalFrames,
        concurrency: Math.min(settings.render.concurrency, BROKER_RENDER_CAP_DEFAULT),
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

      const localReady = await step.run('local-master-ready', async () => {
        await updateRender(db, setup.renderId, {
          status: 'done',
          progressPct: 100,
          outputS3Key: localOutcome.outputKey,
          qcReport,
          completedAt: new Date(),
        })
        return leaveMaster(projectId)
      })

      // A result stored before the switch existed has no field: Shorts on.
      if (localReady?.shorts !== false) {
        await step.sendEvent('emit-master-ready', [
          events.projectMasterReady.create({ projectId, renderId: setup.renderId }),
        ])
      }

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

      // A film in parts needs the broker's part routes. An older broker
      // answers the probe route with a 404; refuse before anything is
      // reserved. Any other answer, even an error, means the route exists.
      if (setup.parts) {
        try {
          await presignRenderOutput('renders/probe/master.mp4')
        } catch (error) {
          if (brokerErrorStatus(error) === 404) {
            throw new NonRetriableError(
              'The render broker predates long renders in parts. Run deploy:stacks ' +
                'boom-busters-broker and boom-busters-media-utils first.',
            )
          }
        }
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
            meta: {
              renderId: setup.renderId,
              timelineVersion: setup.timelineVersion,
              ...(setup.parts ? { parts: setup.parts.length } : {}),
            },
          },
          (await getWorkspace(db)).settings.budgets,
          new Date(),
        )
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        throw error
      }

      // A long master submits its parts one wave at a time, later; the
      // reservation is all this step does for it.
      if (setup.parts) return { ok: true as const, ledgerId, timelineS3Key: key }

      // A refused invoke releases its reservation before the retry: this
      // step re-runs whole, so a kept reservation per attempt would stack
      // phantom spend against the ceiling (the draft's 502s did, 2026-08-21).
      let accepted
      try {
        accepted = await submitRender({
          projectId,
          renderId: setup.renderId,
          kind: 'master',
          timelineS3Key: key,
          composition: 'DocumentaryMaster',
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

    if (setup.parts) {
      return renderInParts(ctx, step, { ...setup, parts: setup.parts }, invoked)
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
      await step.run('render-not-completed', async () => {
        const detail = settled
          ? `${settled.data.reason ?? 'error'}${settled.data.message ? `: ${settled.data.message}` : ''}`
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
      await settle(db, invoked.ledgerId, round4(completed.costUsd))
      await updateRender(db, setup.renderId, {
        status: 'qc',
        progressPct: 100,
        outputS3Key: completed.outputS3Key,
        costUsd: String(round4(completed.costUsd)),
      })
    })

    // -----------------------------------------------------------------------
    // Loudness: normalise to -14 LUFS BEFORE QC (decision 188). Section 7.6
    // says "loudnorm to -14 LUFS integrated", not merely measure — and the
    // mix comes out of the compositions ~5 LU quiet (the 2026-08-23 master:
    // -18.7). The job overwrites the SAME key once ffmpeg succeeds, so the
    // broker presign, the stage player and the YouTube upload all get the
    // corrected file with no bookkeeping. A loudnorm that fails or times
    // out downgrades to a warning, never a dead end: QC still runs on the
    // original file, and its loudness finding says what happened.
    // -----------------------------------------------------------------------

    const loudnormJobId = await step.run('submit-loudnorm', async () => {
      const id = newId<'run'>()
      await submitMediaJob({
        kind: 'loudnorm',
        jobId: id,
        projectId,
        callbackUrl: brokerCallbackUrl(),
        s3Key: completed.outputS3Key,
        outputS3Key: completed.outputS3Key,
        targetLufs: -14,
      })
      return id
    })

    await step.waitForEvent('await-loudnorm', {
      event: 'media/job.completed',
      timeout: LOUDNORM_TIMEOUT,
      if: `async.data.jobId == "${loudnormJobId}"`,
    })

    // -----------------------------------------------------------------------
    // QC: measure the finished master; findings become warnings (section 7.6)
    // -----------------------------------------------------------------------

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
        await markStageFailed(ctx, { message: `The master rendered but QC did not run: ${detail}` })
      })
      return { projectId, outcome: 'failed' as const }
    }

    // QC findings are warnings, not a verdict (decision 184): the master
    // exists and plays, so the pipeline moves on and the report rides along
    // for the preview screen to show, located on the timeline. Publishing is
    // always a human button in this app, so section 7.6's "never auto-publish
    // around a QC failure" holds by construction. Only QC that never RAN
    // (above) fails the stage; an unmeasured master is a different thing
    // from a measured one with findings.
    const qcReport = QcReportSchema.parse(qcDone.data.result)

    const ready = await step.run('master-ready', async () => {
      await updateRender(db, setup.renderId, {
        status: 'done',
        qcReport,
        completedAt: new Date(),
      })
      return leaveMaster(projectId)
    })

    if (ready?.shorts !== false) {
      await step.sendEvent('emit-master-ready', [
        events.projectMasterReady.create({ projectId, renderId: setup.renderId }),
      ])
    }

    return {
      projectId,
      outcome: 'master-ready' as const,
      renderId: setup.renderId,
      qcPassed: qcReport.passed,
    }
  },
)

// ---------------------------------------------------------------------------
// The parts path: a master longer than 30 minutes renders in parts
// ---------------------------------------------------------------------------

type StepTools = GetStepTools<typeof inngest>

/** How long a part waits for a free render slot after a 409 from the broker's cap. */
const PART_CAP_RETRY_DELAY_MS = 3 * 60 * 1000

/**
 * The broker's render cap defaults to 2 across every running render, and the
 * app cannot read it. Waves wider than that would only queue behind 409s.
 */
const BROKER_RENDER_CAP_DEFAULT = 2

/** How long media-utils may spend joining the parts and measuring the result. */
const JOIN_TIMEOUT = '20m'

interface PartsSetup {
  renderId: string
  timelineS3Key: string
  estimate: number
  timeoutMinutes: number
  parts: unknown
  totalFrames: number
  concurrency: number
}

type PartsOutcome =
  | { projectId: string; outcome: 'failed' }
  | { projectId: string; outcome: 'master-ready'; renderId: string; qcPassed: boolean }

/** A `render/settled` event, or null when the wait timed out. */
type SettledLike = { data: Record<string, unknown> } | null

type PartOutcome =
  { ok: true; outputS3Key: string; costUsd: number } | { ok: false; detail: string }

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

export function partOutcome(settled: SettledLike, webhookTimeout: string): PartOutcome {
  if (settled && settled.data['result'] === 'completed') {
    const cost = settled.data['costUsd']
    const outputS3Key = text(settled.data['outputS3Key'])
    // A completion with no key has nothing to QC or join: a failed part, so
    // the retry path runs and the ledger settles on the normal exits.
    if (!outputS3Key) return { ok: false, detail: 'completed without an output key' }
    return { ok: true, outputS3Key, costUsd: typeof cost === 'number' ? cost : 0 }
  }
  if (settled) {
    const message = text(settled.data['message'])
    return {
      ok: false,
      detail: `${text(settled.data['reason']) ?? 'error'}${message ? `: ${message}` : ''}`,
    }
  }
  return { ok: false, detail: `no webhook within ${webhookTimeout}` }
}

/**
 * What the retry step does to a part that failed or timed out: the old
 * render is tombstoned on the broker (`cancelId`), kept in `priorRenderIds`
 * because it was paid for, and the part goes again under a fresh id.
 */
export function retryPlan(part: RenderPart): { cancelId: string; next: RenderPart } {
  return {
    cancelId: part.renderId,
    next: {
      index: part.index,
      renderId: newId<'render'>(),
      frameRange: part.frameRange,
      startMs: part.startMs,
      durationMs: part.durationMs,
      status: 'queued',
      attempt: 2,
      priorRenderIds: [...part.priorRenderIds, part.renderId],
    },
  }
}

function withPart(parts: RenderPart[], index: number, next: RenderPart): RenderPart[] {
  return parts.map((part) => (part.index === index ? next : part))
}

/**
 * Parts live on the row. Every step that changes them writes the row before
 * it returns, and returns the new array (Inngest memoises step results, so
 * a replay rebuilds the in-memory copy from them).
 */
async function renderInParts(
  ctx: GateContext,
  step: StepTools,
  setup: PartsSetup,
  invoked: { ledgerId: string; timelineS3Key?: string },
): Promise<PartsOutcome> {
  const { projectId } = ctx
  const { ledgerId } = invoked
  const timelineS3Key = invoked.timelineS3Key ?? setup.timelineS3Key
  const webhookTimeout = `${setup.timeoutMinutes + WEBHOOK_GRACE_MINUTES}m`
  let parts = RenderPartsSchema.parse(setup.parts)
  const total = parts.length
  const spend = (from: RenderPart[]): number =>
    settleRenderParts(from, setup.estimate, setup.totalFrames)

  // Submits of one wave run side by side, each from the same snapshot, so
  // a step merges its own part into the row's latest parts, not its snapshot.
  const mergeIntoRow = async (
    from: RenderPart[],
    index: number,
    next: RenderPart,
  ): Promise<RenderPart[]> => {
    const row = await getRender(db, setup.renderId)
    const latest = row?.parts ? RenderPartsSchema.parse(row.parts) : from
    return withPart(latest, index, next)
  }

  const submitPart = async (
    stepId: string,
    index: number,
    snapshot?: RenderPart[],
  ): Promise<RenderPart[]> => {
    const from = snapshot ?? parts
    return RenderPartsSchema.parse(
      await step.run(stepId, async () => {
        const part = from[index]
        if (!part) throw new NonRetriableError(`There is no part ${index}.`)
        let accepted
        try {
          accepted = await submitRender({
            projectId,
            renderId: part.renderId,
            kind: 'master',
            timelineS3Key,
            composition: 'DocumentaryMaster',
            expectedDurationSec: part.durationMs / 1000,
            frameRange: part.frameRange,
          })
        } catch (error) {
          // The broker's render cap counts every running render (drafts,
          // Shorts, other projects). Money is already spent on earlier
          // parts, so wait for a slot rather than burn the quick retries.
          if (brokerErrorStatus(error) === 409) {
            throw new RetryAfterError(
              `The render cap is full; part ${index + 1} waits for a slot.`,
              PART_CAP_RETRY_DELAY_MS,
            )
          }
          throw error
        }
        const next = await mergeIntoRow(from, index, {
          ...part,
          status: 'rendering',
          remotionRenderId: accepted.remotionRenderId,
        })
        // The master row goes to rendering with the first part, once.
        if (index === 0 && part.attempt === 1) {
          await updateRender(db, setup.renderId, {
            status: 'rendering',
            startedAt: new Date(),
            parts: next,
          })
        } else {
          await updateRenderParts(db, setup.renderId, next)
        }
        return next
      }),
    )
  }

  /** The parts after each index in `done` took its own part from the matching result. */
  const takeParts = (base: RenderPart[], done: { index: number; parts: RenderPart[] }[]) =>
    done.reduce((acc, one) => {
      const own = one.parts[one.index]
      return own ? withPart(acc, one.index, own) : acc
    }, base)

  const recordPart = async (
    stepId: string,
    index: number,
    outcome: PartOutcome,
  ): Promise<RenderPart[]> => {
    const from = parts
    return RenderPartsSchema.parse(
      await step.run(stepId, async () => {
        const part = from[index]
        if (!part) throw new NonRetriableError(`There is no part ${index}.`)
        const next = withPart(
          from,
          index,
          outcome.ok
            ? {
                ...part,
                status: 'completed',
                outputS3Key: outcome.outputS3Key,
                costUsd: outcome.costUsd,
              }
            : { ...part, status: 'failed', message: outcome.detail },
        )
        // Never lower the bar: the progress route may have written a live
        // figure above the completed-parts share.
        const row = await getRender(db, setup.renderId)
        await updateRender(db, setup.renderId, {
          parts: next,
          progressPct: Math.max(row?.progressPct ?? 0, partsProgressPct(next, {})),
        })
        return next
      }),
    )
  }

  const awaitPart = (stepId: string, renderId: string) =>
    step.waitForEvent(stepId, {
      event: 'render/settled',
      timeout: webhookTimeout,
      if: `async.data.renderId == "${renderId}"`,
    })

  // ---- Render, wave by wave ------------------------------------------------

  for (const wave of partWaves(
    parts.map((part) => part.index),
    setup.concurrency,
  )) {
    // Each part's wait is registered right after its own submit, and the
    // parts of a wave go together: Inngest does not match an event that
    // arrived before the wait existed, so a late wait loses a fast part.
    const base = parts
    const ran = await Promise.all(
      wave.map(async (index) => {
        const submitted = await submitPart(`submit-part-${index}`, index)
        const event = await awaitPart(`await-part-${index}`, submitted[index]?.renderId ?? '')
        return { index, parts: submitted, event }
      }),
    )
    parts = takeParts(base, ran)
    const settled = ran.map((one) => one.event)
    for (const [k, index] of wave.entries()) {
      parts = await recordPart(
        `record-part-${index}`,
        index,
        partOutcome(settled[k] ?? null, webhookTimeout),
      )
    }

    // One more go for each part that failed; a second failure ends the render.
    const failed = wave.filter((index) => parts[index]?.status === 'failed')
    const retryBase = parts
    const retriedRuns = await Promise.all(
      failed.map(async (index) => {
        const from = retryBase
        const cancelled = RenderPartsSchema.parse(
          await step.run(`retry-part-${index}`, async () => {
            const part = from[index]
            if (!part) throw new NonRetriableError(`There is no part ${index}.`)
            const plan = retryPlan(part)
            // A tombstone that does not land is logged, not fatal: the retry
            // goes under a new id either way.
            try {
              await cancelRender(plan.cancelId)
            } catch (error) {
              console.error(
                `render-runner: could not cancel part ${index} (${plan.cancelId}): ${serialiseError(error).message}`,
              )
            }
            const next = await mergeIntoRow(from, index, plan.next)
            await updateRenderParts(db, setup.renderId, next)
            return next
          }),
        )
        // submitPart reads its snapshot from `parts`; hand it this part's.
        const submitted = await submitPart(`submit-part-${index}-retry`, index, cancelled)
        const event = await awaitPart(`await-part-${index}-retry`, submitted[index]?.renderId ?? '')
        return { index, parts: submitted, event }
      }),
    )
    parts = takeParts(retryBase, retriedRuns)
    const retried = retriedRuns.map((one) => one.event)
    for (const [k, index] of failed.entries()) {
      parts = await recordPart(
        `record-part-${index}-retry`,
        index,
        partOutcome(retried[k] ?? null, webhookTimeout),
      )
    }

    const dead = parts.find((part) => part.status === 'failed')
    if (dead) {
      const from = parts
      await step.run(`part-failed-${dead.index}`, async () => {
        const detail = dead.message ?? 'unknown error'
        const message = `part ${dead.index + 1} of ${total} failed twice: ${detail}`
        await updateRender(db, setup.renderId, {
          status: 'failed',
          error: { message },
          completedAt: new Date(),
        })
        // Every part that ran was paid for, the failed ones included.
        await settle(db, ledgerId, spend(from))
        await markStageFailed(ctx, { message: `The render failed: ${message}` })
      })
      return { projectId, outcome: 'failed' }
    }
  }

  // ---- QC every part, with its loudness measurement -------------------------

  // The row says so before the first submit, so the screen stops calling
  // this "Rendering master" for the half hour the measuring can take.
  await step.run('parts-qc-start', async () => {
    await updateRender(db, setup.renderId, { status: 'qc' })
  })

  // Each part's wait is registered right after its own submit (see the
  // render waves): an event that arrived before the wait existed is lost.
  const qcDone = await Promise.all(
    parts.map(async (part) => {
      const jobId = await step.run(`submit-qc-part-${part.index}`, async () => {
        const id = newId<'run'>()
        await submitMediaJob({
          kind: 'qc',
          jobId: id,
          projectId,
          callbackUrl: brokerCallbackUrl(),
          s3Key: part.outputS3Key ?? '',
          targetLufs: -14,
          offsetMs: part.startMs,
          withLoudnorm: true,
        })
        return id
      })
      return step.waitForEvent(`await-qc-part-${part.index}`, {
        event: 'media/job.completed',
        timeout: QC_TIMEOUT,
        if: `async.data.jobId == "${jobId}"`,
      })
    }),
  )

  // A part's report must exist and carry its loudness measurement; anything
  // else is QC that did not run, named by part.
  let qcFailure: string | null = null
  const reports: QcReport[] = []
  const measurements: { measurement: LoudnormMeasurement; durationMs: number }[] = []
  for (const [k, part] of parts.entries()) {
    const done = qcDone[k]
    const where = `part ${part.index + 1} of ${total}`
    if (!done || done.data.ok !== true) {
      qcFailure = `${where}: ${done?.data.error ?? `no QC result within ${QC_TIMEOUT}`}`
      break
    }
    const report = QcReportSchema.safeParse(done.data.result)
    if (!report.success) {
      qcFailure = `${where}: the QC report was not readable`
      break
    }
    if (!report.data.loudnorm) {
      qcFailure = `${where}: the QC report has no loudness measurement`
      break
    }
    reports.push(report.data)
    measurements.push({
      measurement: report.data.loudnorm,
      durationMs: report.data.durationMs ?? part.durationMs,
    })
  }

  if (qcFailure !== null) {
    const detail = qcFailure
    const from = parts
    await step.run('qc-errored', async () => {
      await updateRender(db, setup.renderId, {
        status: 'failed',
        error: { message: `QC did not run: ${detail}` },
        completedAt: new Date(),
      })
      await settle(db, ledgerId, spend(from))
      await markStageFailed(ctx, { message: `The master rendered but QC did not run: ${detail}` })
    })
    return { projectId, outcome: 'failed' }
  }

  const rendered = parts
  parts = RenderPartsSchema.parse(
    await step.run('record-qc-parts', async () => {
      const next = rendered.map((part, k) => ({ ...part, qc: reports[k] }))
      await updateRender(db, setup.renderId, { status: 'qc', progressPct: 100, parts: next })
      return next
    }),
  )

  // ---- Join ---------------------------------------------------------------

  const joinKey = `renders/${setup.renderId}/master.mp4`
  const measured = combineLoudness(measurements)
  const partS3Keys = parts.map((part) => part.outputS3Key ?? '')

  const runJoin = async (submitId: string, awaitId: string) => {
    const jobId = await step.run(submitId, async () => {
      const id = newId<'run'>()
      await submitMediaJob({
        kind: 'join',
        jobId: id,
        projectId,
        callbackUrl: brokerCallbackUrl(),
        partS3Keys,
        outputS3Key: joinKey,
        targetLufs: -14,
        measured,
      })
      return id
    })
    const done = await step.waitForEvent(awaitId, {
      event: 'media/job.completed',
      timeout: JOIN_TIMEOUT,
      if: `async.data.jobId == "${jobId}"`,
    })
    if (!done || done.data.ok !== true) {
      return {
        ok: false as const,
        detail: done?.data.error ?? `no join result within ${JOIN_TIMEOUT}`,
      }
    }
    const result = JoinResultSchema.safeParse(done.data.result)
    if (!result.success) return { ok: false as const, detail: 'the join result was not readable' }
    return { ok: true as const, result: result.data }
  }

  let joined = await runJoin('submit-join', 'await-join')
  if (!joined.ok) joined = await runJoin('submit-join-retry', 'await-join-retry')
  if (!joined.ok) {
    const detail = joined.detail
    const from = parts
    await step.run('join-failed', async () => {
      await updateRender(db, setup.renderId, {
        status: 'failed',
        error: { message: `the parts rendered; the join failed: ${detail}` },
        completedAt: new Date(),
      })
      await settle(db, ledgerId, spend(from))
      await markStageFailed(ctx, { message: `The parts rendered but the join failed: ${detail}` })
    })
    return { projectId, outcome: 'failed' }
  }

  // ---- Ready --------------------------------------------------------------

  const join = joined.result
  const qcReport = mergeQcReports(
    reports.map((qc) => ({ qc })),
    { integratedLufs: join.integratedLufs },
    -14,
  )
  const sum = spend(parts)

  const ready = await step.run('master-ready', async () => {
    await updateRender(db, setup.renderId, {
      status: 'done',
      progressPct: 100,
      outputS3Key: join.outputS3Key,
      costUsd: String(round4(sum)),
      qcReport,
      completedAt: new Date(),
    })
    // The join's own timing survives only here: the first live render reads it.
    await settle(db, ledgerId, sum, { join: { elapsedMs: join.elapsedMs, bytes: join.bytes } })
    return leaveMaster(projectId)
  })

  if (ready?.shorts !== false) {
    await step.sendEvent('emit-master-ready', [
      events.projectMasterReady.create({ projectId, renderId: setup.renderId }),
    ])
  }

  return {
    projectId,
    outcome: 'master-ready',
    renderId: setup.renderId,
    qcPassed: qcReport.passed,
  }
}
