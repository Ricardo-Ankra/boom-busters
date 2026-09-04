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

/**
 * How long a mirror write may take before it is abandoned.
 *
 * A dead pooled socket on a reused serverless instance hangs a query
 * indefinitely — postgres.js has no client-side query timeout — and a hung
 * `onStepStart` write held a production execution request open for 18+
 * minutes, wedging the whole run (2026-09-04). The race keeps the promise at
 * the top of this file honest: a mirror write may fail, but it may never
 * hold the pipeline.
 */
const MIRROR_TIMEOUT_MS = 5_000

/** Exported for its tests; not part of the middleware's surface. */
export async function mirror(what: string, write: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      write(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`mirror write hung for ${MIRROR_TIMEOUT_MS}ms`)),
          MIRROR_TIMEOUT_MS,
        )
      }),
    ])
  } catch (error) {
    // Deliberately swallowed: see the note at the top of this file.
    console.error(`[run-mirror] ${what} failed`, error)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Inngest run id -> mirror row id, for the lifetime of this instance.
 *
 * Every hook needs the row id, and without this each one costs an upsert on
 * top of its own insert — doubling the database traffic of the whole pipeline
 * to re-derive a value that cannot change. Bounded so a long-lived instance
 * cannot grow it without limit.
 */
const RUN_ROW_IDS = new Map<string, string>()
const MAX_CACHED_RUNS = 256

/**
 * The mirror row for an Inngest run, memoised. Shared with the gate helpers so
 * both sides of a step transition agree on the row without re-deriving it.
 */
export async function resolveRunRowId(identity: {
  inngestRunId: string
  functionId: string
  projectId?: string | null
}): Promise<string> {
  const cached = RUN_ROW_IDS.get(identity.inngestRunId)
  if (cached) return cached

  const rowId = await ensureRun(db, {
    inngestRunId: identity.inngestRunId,
    functionName: identity.functionId,
    projectId: identity.projectId ?? null,
    stage: stageOfFunction(identity.functionId),
  })

  if (RUN_ROW_IDS.size >= MAX_CACHED_RUNS) {
    const oldest = RUN_ROW_IDS.keys().next().value
    if (oldest !== undefined) RUN_ROW_IDS.delete(oldest)
  }
  RUN_ROW_IDS.set(identity.inngestRunId, rowId)
  return rowId
}

/** Test-only: drop the memo so a truncated mirror is not remembered. */
export function forgetRunRows(): void {
  RUN_ROW_IDS.clear()
}

export class RunMirrorMiddleware extends Middleware.BaseMiddleware {
  readonly id = 'run-mirror'

  /** Resolve (and create on first sight) the mirror row for this run. */
  private async runRowId(ctx: CtxLike, functionId: string): Promise<string | null> {
    const inngestRunId = ctx.runId
    if (!inngestRunId) return null

    try {
      return await resolveRunRowId({
        inngestRunId,
        functionId,
        projectId: projectIdOf(ctx),
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
