import { and, desc, eq, inArray } from 'drizzle-orm'
import type { Database } from './client'
import { renders } from './schema'
import type { RenderRow } from './schema'

/**
 * Render bookkeeping (build spec sections 5, 7.6, 8.1). One row per invoke:
 * the render-runner writes it before the broker is called (the spend exists
 * the moment the invoke succeeds, so the row must exist first), progress and
 * terminal states land on the same row, and the QC report is attached to the
 * render it judged. Statuses walk `queued → invoking → rendering → qc →
 * done`, with `failed`/`cancelled` reachable from any of them.
 */

const IN_FLIGHT = ['queued', 'invoking', 'rendering', 'qc'] as const

export async function insertRender(
  db: Database,
  input: {
    projectId: string
    timelineVersion: number
    kind: RenderRow['kind']
    costUsd?: string
  },
): Promise<RenderRow> {
  const [row] = await db
    .insert(renders)
    .values({
      projectId: input.projectId,
      timelineVersion: input.timelineVersion,
      kind: input.kind,
      status: 'queued',
      ...(input.costUsd !== undefined ? { costUsd: input.costUsd } : {}),
    })
    .returning()

  if (!row) throw new Error('The render row could not be created')
  return row
}

export async function getRender(db: Database, id: string): Promise<RenderRow | undefined> {
  const [row] = await db.select().from(renders).where(eq(renders.id, id)).limit(1)
  return row
}

/** The newest render of a kind — what the preview screen's panels show. */
export async function latestRender(
  db: Database,
  projectId: string,
  kind: RenderRow['kind'] = 'master',
): Promise<RenderRow | undefined> {
  const [row] = await db
    .select()
    .from(renders)
    .where(and(eq(renders.projectId, projectId), eq(renders.kind, kind)))
    .orderBy(desc(renders.createdAt), desc(renders.id))
    .limit(1)
  return row
}

/** A render the section 8.1 stop-confirm must warn about, if any. */
export async function renderInFlight(
  db: Database,
  projectId: string,
): Promise<RenderRow | undefined> {
  const [row] = await db
    .select()
    .from(renders)
    .where(and(eq(renders.projectId, projectId), inArray(renders.status, [...IN_FLIGHT])))
    .orderBy(desc(renders.createdAt))
    .limit(1)
  return row
}

export async function updateRender(
  db: Database,
  id: string,
  patch: Partial<{
    status: RenderRow['status']
    progressPct: number
    brokerRenderId: string
    remotionRenderId: string
    outputS3Key: string
    qcReport: Record<string, unknown>
    costUsd: string
    startedAt: Date
    completedAt: Date
    error: Record<string, unknown>
  }>,
): Promise<void> {
  await db.update(renders).set(patch).where(eq(renders.id, id))
}
