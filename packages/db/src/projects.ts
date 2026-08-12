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
  scriptVersion: number | null
  scriptBuiltFromDossierVersion: number | null
  /** How many takes exist at all, and the oldest script version among them. */
  voiceTakes: number
  voiceBuiltFromScriptVersion: number | null
  /**
   * Whether the run mirror shows anything executing or parked on this project.
   *
   * Carried here so the Projects list can tell "running" from "a column that
   * still says running", without a query per row. `stageStatus` alone cannot:
   * it keeps whatever the last runner wrote, including from runs that died.
   */
  hasActiveRun: boolean
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
  scriptVersion: sql<number | null>`(
    select ${scripts.version} from ${scripts}
    where ${scripts.projectId} = ${projects.id}
    order by ${scripts.version} desc limit 1
  )`,
  scriptBuiltFromDossierVersion: sql<number | null>`(
    select ${scripts.builtFromDossierVersion} from ${scripts}
    where ${scripts.projectId} = ${projects.id}
    order by ${scripts.version} desc limit 1
  )`,
  /**
   * The narration, in the two numbers the rail needs.
   *
   * The count answers "is there any audio at all"; the version answers "was it
   * read from the script that exists now". `min` rather than `max` on the
   * version deliberately: a project whose script was re-run and only partly
   * re-narrated has some takes from the old script, and the honest reading of
   * that mixture is the oldest one — some of this narration is out of date.
   */
  voiceTakes: sql<number>`(
    select count(*)::int from voice_takes vt where vt.project_id = projects.id
  )`,
  voiceBuiltFromScriptVersion: sql<number | null>`(
    select min(vt.built_from_script_version) from voice_takes vt
    where vt.project_id = projects.id
  )`,
  hasActiveRun: sql<boolean>`exists (
    select 1 from runs r
    where r.project_id = projects.id and r.status in ('running', 'awaiting_gate')
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

export interface ProjectDeletionSummary {
  claims: number
  chapters: number
  scripts: number
  runs: number
  /** Every dollar this project has cost, all time — not this month's slice. */
  spendUsd: number
  /** Anything published to YouTube from this project. Blocks deletion. */
  publishedCount: number
}

/**
 * What deleting this project would destroy, counted so the confirm can say it.
 *
 * "This cannot be undone" is a warning nobody can weigh. "18 claims, 6 chapters
 * and $2.34 of research" is one they can.
 */
export async function projectDeletionSummary(
  db: Database,
  id: string,
): Promise<ProjectDeletionSummary> {
  /**
   * Written with literal table names and explicit aliases rather than
   * interpolated column objects.
   *
   * Drizzle emits a bare `"id"` for an interpolated column inside a correlated
   * subquery, so `where ${dossiers.projectId} = ${projects.id}` becomes
   * `where "project_id" = "id"` — which Postgres rejects as ambiguous, and
   * which would silently correlate to the wrong table if it ever resolved.
   */
  const [row] = await db
    .select({
      claims: sql<number>`(
        select count(*)::int from claims c
        join dossiers d on d.id = c.dossier_id
        where d.project_id = projects.id
      )`,
      chapters: sql<number>`(
        select count(*)::int from chapters ch
        join scripts s on s.id = ch.script_id
        where s.project_id = projects.id
      )`,
      scripts: sql<number>`(
        select count(*)::int from scripts s where s.project_id = projects.id
      )`,
      runs: sql<number>`(
        select count(*)::int from runs r where r.project_id = projects.id
      )`,
      spendUsd: sql<number>`(
        select coalesce(sum(coalesce(cl.actual_usd, cl.estimated_usd)), 0)::float8
        from cost_ledger cl where cl.project_id = projects.id
      )`,
      /**
       * Anything of this project's already on YouTube — the master, or any
       * Short cut from it.
       *
       * `publish_records` is polymorphic: `targetType`/`targetId` rather than a
       * foreign key, so nothing in the database stops a delete from stranding a
       * row that points at a live video. Shorts have to be counted through
       * `shorts`, because deleting the project cascades them away and takes
       * their publish records' referents with them.
       */
      publishedCount: sql<number>`(
        select count(*)::int from publish_records pr
        where (pr.target_type = 'master' and pr.target_id = projects.id)
           or (pr.target_type = 'short' and pr.target_id in (
                 select sh.id from shorts sh where sh.project_id = projects.id
              ))
      )`,
    })
    .from(projects)
    .where(eq(projects.id, id))

  return row ?? { claims: 0, chapters: 0, scripts: 0, runs: 0, spendUsd: 0, publishedCount: 0 }
}

/**
 * Delete a project and everything produced under it.
 *
 * Every table that hangs off a project cascades, with one deliberate exception:
 * `cost_ledger.project_id` is `set null`, so the spend survives. The money was
 * really spent, and a Costs screen that quietly got cheaper because a project
 * was tidied away would be a Costs screen nobody could trust. Those rows stay,
 * attributed to no project.
 *
 * The case itself is untouched. It is a library entry describing a story worth
 * telling, and deleting an attempt at it does not retract that.
 */
export async function deleteProject(db: Database, id: string): Promise<boolean> {
  const deleted = await db
    .delete(projects)
    .where(eq(projects.id, id))
    .returning({ id: projects.id })
  return deleted.length > 0
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
