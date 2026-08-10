import { desc, eq } from 'drizzle-orm'
import type { Database } from './client'
import { cases, projects } from './schema'
import type { ProjectStage, StageStatus } from './schema'

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
}

export async function listProjects(db: Database): Promise<ProjectSummary[]> {
  return db
    .select(summaryColumns)
    .from(projects)
    .innerJoin(cases, eq(projects.caseId, cases.id))
    .orderBy(desc(projects.updatedAt))
}

export async function getProject(db: Database, id: string): Promise<ProjectSummary | undefined> {
  const [row] = await db
    .select(summaryColumns)
    .from(projects)
    .innerJoin(cases, eq(projects.caseId, cases.id))
    .where(eq(projects.id, id))
  return row
}

/** Projects parked at a gate — the review half of the Needs-you queue. */
export async function listProjectsAwaitingReview(db: Database): Promise<ProjectSummary[]> {
  return db
    .select(summaryColumns)
    .from(projects)
    .innerJoin(cases, eq(projects.caseId, cases.id))
    .where(eq(projects.stageStatus, 'awaiting_review'))
    .orderBy(projects.updatedAt)
}

export async function setProjectStage(
  db: Database,
  id: string,
  next: { stage?: ProjectStage; stageStatus: StageStatus; inngestRunId?: string | null },
): Promise<void> {
  await db
    .update(projects)
    .set({
      ...(next.stage ? { stage: next.stage } : {}),
      stageStatus: next.stageStatus,
      ...(next.inngestRunId === undefined ? {} : { inngestRunId: next.inngestRunId }),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
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
