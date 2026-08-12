import { desc, eq, notInArray, sql } from 'drizzle-orm'
import type { Database } from './client'
import { cases, dossiers, projects, scripts } from './schema'
import type { ProjectRow, ProjectStage, StageStatus } from './schema'

/**
 * Project queries for the pipeline screens (build spec section 11.3).
 *
 * A project's position in the pipeline is exactly two columns — `stage` and
 * `stageStatus` — and every screen derives from them. There is no separate
 * "gate" record: an open gate *is* `stageStatus = 'awaiting_review'`. One
 * source of truth means the rail, the Needs-you queue and the runner can never
 * disagree about where a project is.
 */

/** The eight stages of the pipeline rail, in order (spec section 11.3). */
export const PIPELINE_STAGES: readonly ProjectStage[] = [
  'dossier',
  'script',
  'voice',
  'visuals',
  'assembly',
  'shorts',
  'publish',
  'done',
]

export interface ProjectSummary {
  id: string
  title: string
  stage: ProjectStage
  stageStatus: StageStatus
  targetRuntimeMin: number
  caseId: string
  caseTitle: string
  caseCategory: string
  inngestRunId: string | null
  cancelledAt: Date | null
  createdAt: Date
  updatedAt: Date
  /**
   * Enough provenance for the rail to say which stages hold work and whether
   * that work is still trustworthy (`apps/web/lib/stage-view.ts`).
   *
   * Carried on the summary rather than fetched per project, because the
   * Projects list draws a rail per row: eight rows would otherwise be eight
   * extra round trips to answer a question one join already answers.
   */
  dossierVersion: number | null
  hasScript: boolean
  scriptBuiltFromDossierVersion: number | null
}

const summaryColumns = {
  id: projects.id,
  title: projects.title,
  stage: projects.stage,
  stageStatus: projects.stageStatus,
  targetRuntimeMin: projects.targetRuntimeMin,
  caseId: projects.caseId,
  caseTitle: cases.title,
  caseCategory: cases.category,
  inngestRunId: projects.inngestRunId,
  cancelledAt: projects.cancelledAt,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
  dossierVersion: dossiers.version,
  // `hasScript` is separate from the version because a null version means two
  // different things — no script at all, or a script written before provenance
  // was recorded — and the rail says something different about each.
  hasScript: sql<boolean>`exists (
    select 1 from ${scripts} where ${scripts.projectId} = ${projects.id}
  )`,
  scriptBuiltFromDossierVersion: sql<number | null>`(
    select ${scripts.builtFromDossierVersion} from ${scripts}
    where ${scripts.projectId} = ${projects.id}
    order by ${scripts.version} desc limit 1
  )`,
}

/** The two joins every summary needs, kept together so they cannot drift. */
function summaryFrom(db: Database) {
  return db
    .select(summaryColumns)
    .from(projects)
    .innerJoin(cases, eq(projects.caseId, cases.id))
    .leftJoin(dossiers, eq(dossiers.projectId, projects.id))
}

export async function listProjects(db: Database): Promise<ProjectSummary[]> {
  return summaryFrom(db).orderBy(desc(projects.updatedAt))
}

export async function getProject(db: Database, id: string): Promise<ProjectSummary | undefined> {
  const [row] = await summaryFrom(db).where(eq(projects.id, id))
  return row
}

/** Projects parked at a gate — the review half of the Needs-you queue. */
export async function listProjectsAwaitingReview(db: Database): Promise<ProjectSummary[]> {
  return summaryFrom(db)
    .where(eq(projects.stageStatus, 'awaiting_review'))
    .orderBy(projects.updatedAt)
}

export async function setProjectStage(
  db: Database,
  id: string,
  next: {
    stage?: ProjectStage
    stageStatus: StageStatus
    inngestRunId?: string | null
    /**
     * Pass `null` to clear a previous stop. Restarting a cancelled project has
     * to, or the row keeps a `cancelledAt` describing a run that is no longer
     * the current one — and every screen that reads it goes on saying the
     * project was stopped while it is plainly running.
     */
    cancelledAt?: Date | null
  },
): Promise<void> {
  await db
    .update(projects)
    .set({
      ...(next.stage ? { stage: next.stage } : {}),
      stageStatus: next.stageStatus,
      ...(next.inngestRunId === undefined ? {} : { inngestRunId: next.inngestRunId }),
      ...(next.cancelledAt === undefined ? {} : { cancelledAt: next.cancelledAt }),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
}

/**
 * Drop every project except the ones named — the projects counterpart of
 * `deleteCasesExcept`, and needed for the same reason.
 *
 * The E2E suite seeds projects in the states a project passes through, and
 * seeds them against the *fixture* case, which `deleteCasesExcept` deliberately
 * keeps. So nothing removed them and each run left two more behind, until an
 * assertion that a title appears once started matching four rows. State that
 * accumulates across runs is the flake that only shows up on the second run.
 *
 * Everything hanging off a project cascades (dossiers, scripts, runs, shots),
 * so this is a single delete rather than a teardown order to keep in step with
 * the schema.
 */
export async function deleteProjectsExcept(
  db: Database,
  keepIds: readonly string[],
): Promise<number> {
  const deleted = await db
    .delete(projects)
    .where(keepIds.length > 0 ? notInArray(projects.id, [...keepIds]) : undefined)
    .returning({ id: projects.id })

  return deleted.length
}

export async function markProjectCancelled(db: Database, id: string): Promise<void> {
  await db
    .update(projects)
    .set({ stageStatus: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(projects.id, id))
}

/** The stage after `stage`, or null at the end of the rail. */
export function nextStage(stage: ProjectStage): ProjectStage | null {
  const index = PIPELINE_STAGES.indexOf(stage)
  if (index < 0 || index === PIPELINE_STAGES.length - 1) return null
  return PIPELINE_STAGES[index + 1] ?? null
}

/**
 * Start a project from a case.
 *
 * The project begins at `dossier`/`queued`, which is the state the pipeline
 * rail renders as "waiting to start" and the state `isMoving()` polls on — so
 * the screen updates itself the moment the runner picks the work up, without
 * the human refreshing.
 *
 * `targetRuntimeMin` is a project-level decision rather than a case-level one:
 * the same case can be a 12-minute telling or a 25-minute one, and the script
 * runner's outline is built against it.
 */
export async function createProjectFromCase(
  db: Database,
  input: { caseId: string; title: string; targetRuntimeMin?: number },
): Promise<ProjectRow> {
  const [row] = await db
    .insert(projects)
    .values({
      caseId: input.caseId,
      title: input.title,
      stage: 'dossier',
      stageStatus: 'queued',
      ...(input.targetRuntimeMin === undefined ? {} : { targetRuntimeMin: input.targetRuntimeMin }),
    })
    .returning()

  return row!
}
