import { ensureRun, recordRunEvent, setRunStatus } from '@boom-busters/db'
import type { ProjectStage } from '@boom-busters/db'
import { isGated, serialiseError } from '@boom-busters/schemas'
import { Middleware } from 'inngest'
import { db } from '@/lib/db'

/**
 * Mirror every Inngest run transition into Postgres (build spec section 12).
 *
 * The activity drawer reads `run_events`, never the Inngest API, so "what is
 * my pipeline doing" is answerable inside the console rather than behind a
 * third-party login.
 *
 * **Mirroring never fails a run.** Every write is wrapped: an observability
 * sidecar that can take down the pipeline it observes is worse than no
 * sidecar. A failed mirror write logs and the run carries on.
 */

interface EventLike {
  name?: string
  data?: Record<string, unknown>
}

interface CtxLike {
  runId?: string
  event?: EventLike
  attempt?: number
}

/** The project a run belongs to, when its triggering event names one. */
function projectIdOf(ctx: CtxLike): string | null {
  const value = ctx.event?.data?.['projectId']
  return typeof value === 'string' ? value : null
}

/**
 * The stage a function serves, from its own id. Functions are named
 * `<stage>-runner` (spec section 7), so the id *is* the stage — no separate
 * registry to keep in sync.
 */
const STAGES: readonly ProjectStage[] = [
  'dossier',
  'script',
  'voice',
  'visuals',
  'assembly',
  'shorts',
  'publish',
]

export function stageOfFunction(functionId: string): ProjectStage | null {
  const match = /(^|-)([a-z]+)-runner$/.exec(functionId)
  const candidate = match?.[2]
  return candidate && (STAGES as readonly string[]).includes(candidate)
    ? (candidate as ProjectStage)
    : null
}

async function mirror(what: string, write: () => Promise<void>): Promise<void> {
  try {
    await write()
  } catch (error) {
    // Deliberately swallowed: see the note at the top of this file.
    console.error(`[run-mirror] ${what} failed`, error)
  }
}

export class RunMirrorMiddleware extends Middleware.BaseMiddleware {
  readonly id = 'run-mirror'

  /** Resolve (and create on first sight) the mirror row for this run. */
  private async runRowId(ctx: CtxLike, functionId: string): Promise<string | null> {
    const inngestRunId = ctx.runId
    if (!inngestRunId) return null

    try {
      return await ensureRun(db, {
        inngestRunId,
        functionName: functionId,
        projectId: projectIdOf(ctx),
        stage: stageOfFunction(functionId),
      })
    } catch (error) {
      console.error('[run-mirror] could not open a run row', error)
      return null
    }
  }

  override async onRunStart({ ctx, fn }: Middleware.OnRunStartArgs): Promise<void> {
    await mirror('onRunStart', async () => {
      const runId = await this.runRowId(ctx as CtxLike, fn.id())
      if (!runId) return
      await recordRunEvent(db, {
        runId,
        kind: 'run.started',
        message: fn.name,
        data: { event: (ctx as CtxLike).event?.name ?? null },
      })
    })
  }

  override async onStepStart({ ctx, fn, stepInfo }: Middleware.OnStepStartArgs): Promise<void> {
    await mirror('onStepStart', async () => {
      const runId = await this.runRowId(ctx as CtxLike, fn.id())
      if (!runId) return
      await recordRunEvent(db, {
        runId,
        kind: 'step.started',
        stepId: stepInfo.options.id,
        data: { stepType: stepInfo.stepType },
      })
    })
  }

  override async onStepComplete({
    ctx,
    fn,
    stepInfo,
  }: Middleware.OnStepCompleteArgs): Promise<void> {
    await mirror('onStepComplete', async () => {
      const runId = await this.runRowId(ctx as CtxLike, fn.id())
      if (!runId) return
      await recordRunEvent(db, {
        runId,
        kind: 'step.completed',
        stepId: stepInfo.options.id,
      })
    })
  }

  override async onStepError({
    ctx,
    fn,
    error,
    isFinalAttempt,
    stepInfo,
  }: Middleware.OnStepErrorArgs): Promise<void> {
    await mirror('onStepError', async () => {
      const runId = await this.runRowId(ctx as CtxLike, fn.id())
      if (!runId) return

      // A budget error is not a failure — it is the run asking a question.
      // Recording it as `step.failed` would put a red card in Needs-you for
      // something the human is meant to answer, not fix.
      if (isGated(error)) return

      await recordRunEvent(db, {
        runId,
        kind: isFinalAttempt ? 'step.failed' : 'step.retry',
        stepId: stepInfo.options.id,
        message: error.message,
        data: serialiseError(error),
      })
    })
  }

  override async onRunComplete({ ctx, fn }: Middleware.OnRunCompleteArgs): Promise<void> {
    await mirror('onRunComplete', async () => {
      const runId = await this.runRowId(ctx as CtxLike, fn.id())
      if (!runId) return
      await recordRunEvent(db, { runId, kind: 'run.completed' })
      await setRunStatus(db, runId, 'completed')
    })
  }

  override async onRunError({
    ctx,
    fn,
    error,
    isFinalAttempt,
  }: Middleware.OnRunErrorArgs): Promise<void> {
    if (!isFinalAttempt) return

    await mirror('onRunError', async () => {
      const runId = await this.runRowId(ctx as CtxLike, fn.id())
      if (!runId) return
      const serialised = serialiseError(error)
      await recordRunEvent(db, {
        runId,
        kind: 'run.failed',
        message: error.message,
        data: serialised,
      })
      await setRunStatus(db, runId, 'failed', serialised)
    })
  }
}
