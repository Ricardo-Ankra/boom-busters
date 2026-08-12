import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { Database } from './client'
import { projects, runEvents, runs } from './schema'
import type { ProjectStage, RunEventRow, RunRow, RunStatus } from './schema'

/**
 * The run mirror (build spec section 12).
 *
 * Inngest middleware writes every step transition here so the in-app activity
 * drawer never depends on the Inngest dashboard. That matters for more than
 * convenience: the dashboard is a third-party surface behind a separate login,
 * and "what is my pipeline doing" must be answerable inside the console.
 *
 * The mirror is deliberately append-only apart from the run's own status. An
 * event is a fact that happened at a time; nothing rewrites history.
 */

/**
 * Event kinds the drawer knows how to render. Free-form strings would drift
 * within a milestone; this union is small enough to exhaust in a switch.
 */
export const RUN_EVENT_KINDS = [
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'step.started',
  'step.completed',
  'step.failed',
  'step.retry',
  /**
   * A step that deliberately did nothing, and said so.
   *
   * Not a failure and not a success: the voice runner's loudness pass needs
   * media-utils, which is deployed in M6, and a gap that only exists in a
   * document is a gap nobody sees. This puts it in the activity drawer of every
   * run it affects.
   */
  'step.skipped',
  'gate.opened',
  'gate.closed',
  'model.fallback',
  'spend',
] as const
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number]

/** Which gate a `gate.opened` event refers to. */
export type GateKind = 'dossier' | 'script' | 'voice' | 'visuals' | 'preview' | 'budget'

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface RunIdentity {
  inngestRunId: string
  functionName: string
  projectId?: string | null
  stage?: ProjectStage | null
}

/**
 * Find or create the mirror row for an Inngest run.
 *
 * Idempotent by `inngestRunId`, because the middleware's hooks fire once per
 * step and any of them may be the first to arrive — Inngest gives no ordering
 * guarantee across a run's transitions.
 */
export async function ensureRun(db: Database, identity: RunIdentity): Promise<string> {
  const [row] = await db
    .insert(runs)
    .values({
      inngestRunId: identity.inngestRunId,
      functionName: identity.functionName,
      projectId: identity.projectId ?? null,
      stage: identity.stage ?? null,
      status: 'running',
    })
    .onConflictDoUpdate({
      target: runs.inngestRunId,
      // Touch a column so the upsert always returns a row; without a SET the
      // conflict path returns nothing and the caller cannot get the id.
      set: { updatedAt: new Date() },
    })
    .returning({ id: runs.id })

  if (!row) throw new Error(`could not mirror run ${identity.inngestRunId}`)
  return row.id
}

export interface RunEventInput {
  runId: string
  kind: RunEventKind
  stepId?: string | null
  message?: string | null
  data?: Record<string, unknown>
  occurredAt?: Date
}

export async function recordRunEvent(db: Database, event: RunEventInput): Promise<void> {
  await db.insert(runEvents).values({
    runId: event.runId,
    kind: event.kind,
    stepId: event.stepId ?? null,
    message: event.message ?? null,
    data: event.data ?? {},
    ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
  })
}

/** Several events in one round trip — the middleware batches per transition. */
export async function recordRunEvents(db: Database, events: RunEventInput[]): Promise<void> {
  if (events.length === 0) return
  await db.insert(runEvents).values(
    events.map((event) => ({
      runId: event.runId,
      kind: event.kind,
      stepId: event.stepId ?? null,
      message: event.message ?? null,
      data: event.data ?? {},
      ...(event.occurredAt ? { occurredAt: event.occurredAt } : {}),
    })),
  )
}

export async function setRunStatus(
  db: Database,
  runId: string,
  status: RunStatus,
  error?: Record<string, unknown>,
): Promise<void> {
  const terminal = status === 'completed' || status === 'failed' || status === 'cancelled'
  await db
    .update(runs)
    .set({
      status,
      ...(terminal ? { completedAt: new Date() } : {}),
      ...(error ? { error } : {}),
      updatedAt: new Date(),
    })
    .where(eq(runs.id, runId))
}

/**
 * Close out any run still marked running for a project. Used by the cancel
 * path, where Inngest stops the function without giving us a final hook.
 *
 * `exceptRunId` exists because the canceller is itself a run: it is triggered
 * by `project/cancelled`, whose payload names the project, so the mirror
 * attributes it to that project too. Without the exclusion it would cancel
 * itself and report doing so.
 */
export async function cancelRunsForProject(
  db: Database,
  projectId: string,
  options: { exceptRunId?: string } = {},
): Promise<number> {
  const cancelled = await db
    .update(runs)
    .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(runs.projectId, projectId),
        inArray(runs.status, ['running', 'awaiting_gate']),
        options.exceptRunId ? ne(runs.id, options.exceptRunId) : undefined,
      ),
    )
    .returning({ id: runs.id })

  await recordRunEvents(
    db,
    cancelled.map((run) => ({ runId: run.id, kind: 'run.cancelled' as const })),
  )
  return cancelled.length
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  id: string
  runId: string
  projectId: string | null
  projectTitle: string | null
  functionName: string
  runStatus: RunStatus
  kind: string
  stepId: string | null
  message: string | null
  data: Record<string, unknown>
  occurredAt: Date
}

/**
 * The activity drawer's feed. Scoped to a project when one is open, otherwise
 * the whole console — the top bar's Activity button is always available and
 * showing nothing there would be a dead end.
 */
export async function listActivity(
  db: Database,
  options: { projectId?: string; limit?: number } = {},
): Promise<ActivityEntry[]> {
  const rows = await db
    .select({
      id: runEvents.id,
      runId: runEvents.runId,
      projectId: runs.projectId,
      projectTitle: projects.title,
      functionName: runs.functionName,
      runStatus: runs.status,
      kind: runEvents.kind,
      stepId: runEvents.stepId,
      message: runEvents.message,
      data: runEvents.data,
      occurredAt: runEvents.occurredAt,
    })
    .from(runEvents)
    .innerJoin(runs, eq(runEvents.runId, runs.id))
    .leftJoin(projects, eq(runs.projectId, projects.id))
    .where(options.projectId ? eq(runs.projectId, options.projectId) : undefined)
    .orderBy(desc(runEvents.occurredAt), desc(runEvents.id))
    .limit(Math.min(options.limit ?? 100, 500))

  return rows
}

export async function listRunEvents(db: Database, runId: string): Promise<RunEventRow[]> {
  return db
    .select()
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(runEvents.occurredAt, runEvents.id)
}

export interface ActiveRun {
  id: string
  projectId: string | null
  projectTitle: string | null
  functionName: string
  stage: ProjectStage | null
  startedAt: Date
  /** The step the run is on right now, for the top bar's live label. */
  currentStep: string | null
}

/**
 * Runs that are actually executing. `awaiting_gate` is excluded on purpose:
 * a run parked for three days waiting on a human is not "active", and showing
 * it as such would make the pulsing dot in the top bar meaningless.
 */
export async function listActiveRuns(db: Database): Promise<ActiveRun[]> {
  const latestStep = db
    .select({
      runId: runEvents.runId,
      stepId: sql<string>`max(${runEvents.stepId})`.as('step_id'),
      at: sql<Date>`max(${runEvents.occurredAt})`.as('at'),
    })
    .from(runEvents)
    .where(eq(runEvents.kind, 'step.started'))
    .groupBy(runEvents.runId)
    .as('latest_step')

  const rows = await db
    .select({
      id: runs.id,
      projectId: runs.projectId,
      projectTitle: projects.title,
      functionName: runs.functionName,
      stage: runs.stage,
      startedAt: runs.startedAt,
      currentStep: latestStep.stepId,
    })
    .from(runs)
    .leftJoin(projects, eq(runs.projectId, projects.id))
    .leftJoin(latestStep, eq(latestStep.runId, runs.id))
    .where(eq(runs.status, 'running'))
    .orderBy(desc(runs.startedAt))

  return rows
}

export async function countActiveRuns(db: Database): Promise<number> {
  return (await listActiveRuns(db)).length
}

export interface FailedRun {
  id: string
  projectId: string | null
  projectTitle: string | null
  functionName: string
  stage: ProjectStage | null
  error: Record<string, unknown> | null
  completedAt: Date | null
}

/** Failed runs for the Needs-you queue (spec section 11.3). */
export async function listFailedRuns(db: Database, limit = 20): Promise<FailedRun[]> {
  return db
    .select({
      id: runs.id,
      projectId: runs.projectId,
      projectTitle: projects.title,
      functionName: runs.functionName,
      stage: runs.stage,
      error: runs.error,
      completedAt: runs.completedAt,
    })
    .from(runs)
    .leftJoin(projects, eq(runs.projectId, projects.id))
    .where(eq(runs.status, 'failed'))
    .orderBy(desc(runs.completedAt))
    .limit(limit)
}

export interface OpenBudgetGate {
  runId: string
  projectId: string | null
  projectTitle: string | null
  provider: string
  operation: string
  budgetUsd: number
  monthSpendUsd: number
  estimateUsd: number
  killSwitch: boolean
  openedAt: Date
}

/**
 * Budget gates currently waiting on a human.
 *
 * The parked state lives in two places that must agree: the run's status is
 * `awaiting_gate`, and the reason is the most recent `gate.opened` event whose
 * data says `gate: 'budget'`. There is no `budget_gates` table because the gate
 * is not an entity — it is a run's current position, and duplicating it into a
 * table would give two answers to one question.
 */
export async function listOpenBudgetGates(db: Database): Promise<OpenBudgetGate[]> {
  const rows = await db
    .select({
      runId: runs.id,
      projectId: runs.projectId,
      projectTitle: projects.title,
      data: runEvents.data,
      openedAt: runEvents.occurredAt,
    })
    .from(runs)
    .innerJoin(runEvents, eq(runEvents.runId, runs.id))
    .leftJoin(projects, eq(runs.projectId, projects.id))
    .where(
      and(
        eq(runs.status, 'awaiting_gate'),
        eq(runEvents.kind, 'gate.opened'),
        sql`${runEvents.data} ->> 'gate' = 'budget'`,
        // Only gates that were never closed.
        sql`not exists (
          select 1 from ${runEvents} closed
          where closed.run_id = ${runs.id}
            and closed.kind = 'gate.closed'
            and closed.occurred_at >= ${runEvents.occurredAt}
        )`,
      ),
    )
    .orderBy(desc(runEvents.occurredAt))

  return rows.map((row) => {
    const data = row.data as Record<string, unknown>
    return {
      runId: row.runId,
      projectId: row.projectId,
      projectTitle: row.projectTitle,
      provider: String(data['provider'] ?? 'unknown'),
      operation: String(data['operation'] ?? ''),
      budgetUsd: Number(data['budgetUsd'] ?? 0),
      monthSpendUsd: Number(data['monthSpendUsd'] ?? 0),
      estimateUsd: Number(data['estimateUsd'] ?? 0),
      killSwitch: Boolean(data['killSwitch'] ?? false),
      openedAt: row.openedAt,
    }
  })
}

/**
 * Whether a project has a run actually in flight — executing or parked at a
 * gate.
 *
 * The project's own `stageStatus` is not enough to answer this. A seeded or
 * hand-edited project can read `awaiting_review` with no run waiting on it, and
 * the UI must not then offer an Approve button whose event nothing is
 * listening for.
 */
export async function hasLiveRun(db: Database, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), inArray(runs.status, ['running', 'awaiting_gate'])))
    .limit(1)
  return row !== undefined
}

/** Every mirrored run, newest first. Used by tests and the run inspector. */
export async function listRuns(db: Database, limit = 50): Promise<RunRow[]> {
  return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit)
}

export async function getRunByInngestId(
  db: Database,
  inngestRunId: string,
): Promise<RunRow | undefined> {
  const [row] = await db.select().from(runs).where(eq(runs.inngestRunId, inngestRunId))
  return row
}

/** Runs whose Inngest id never arrived — only the demo harness produces these. */
export async function listUnlinkedRuns(db: Database): Promise<RunRow[]> {
  return db.select().from(runs).where(isNull(runs.inngestRunId))
}

/**
 * Test-only: empty the mirror.
 *
 * It lives here rather than in each test because `drizzle-orm` is not a
 * dependency of `apps/web` — SQL belongs to this package (spec section 3), and
 * a test that reached around that boundary would be the first crack in it.
 */
export async function truncateRunMirror(db: Database): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE ${runEvents}, ${runs} RESTART IDENTITY CASCADE`)
}
