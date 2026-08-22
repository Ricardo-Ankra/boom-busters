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
    /** The Short this render belongs to — kind 'short' only. */
    shortId?: string
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
      ...(input.shortId !== undefined ? { shortId: input.shortId } : {}),
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

/**
 * Terminal bookkeeping for a runner that died: every in-flight render of
 * the kind is marked failed with the reason. Without this, a run that
 * throws before its own failure step leaves the row 'queued' or
 * 'rendering' forever — and the UI shows an honest-looking progress bar
 * stuck at 0% with no error anywhere (the first live draft, 2026-08-21).
 */
export async function failInFlightRenders(
  db: Database,
  projectId: string,
  kind: RenderRow['kind'],
  error: Record<string, unknown>,
  /**
   * Narrow the sweep to one Short's renders. Without it, a dead
   * short-render run would fail its SIBLINGS' in-flight rows too — several
   * Shorts render concurrently for the same project.
   */
  shortId?: string,
): Promise<void> {
  await db
    .update(renders)
    .set({ status: 'failed', error, completedAt: new Date() })
    .where(
      and(
        eq(renders.projectId, projectId),
        eq(renders.kind, kind),
        inArray(renders.status, [...IN_FLIGHT]),
        ...(shortId !== undefined ? [eq(renders.shortId, shortId)] : []),
      ),
    )
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
