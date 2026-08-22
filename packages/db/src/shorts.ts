import { asc, desc, eq } from 'drizzle-orm'
import type { Database } from './client'
import { scripts, shorts } from './schema'
import type { ShortRow } from './schema'
import type { ShortsCandidate } from '@boom-busters/schemas'

/**
 * Shorts bookkeeping (build spec sections 5, 7.2 item 7). One row per Short
 * the shorts-runner resolved from an approved candidate — a row here is a
 * Short being made, with a render, editable metadata and a publish decision
 * ahead of it; the CANDIDATES stay on the script row until then.
 *
 * `renderId` points at the render of the Short's CURRENT configuration.
 * Changing the configuration (the ending toggle) nulls it rather than
 * leaving it pointing at a render of something else; the old render row
 * survives in `renders` for the cost trail.
 */

export async function insertShort(
  db: Database,
  input: {
    projectId: string
    title: string
    description?: string
    segmentRef: ShortRow['segmentRef']
    ending?: ShortRow['ending']
  },
): Promise<ShortRow> {
  const [row] = await db
    .insert(shorts)
    .values({
      projectId: input.projectId,
      title: input.title,
      description: input.description ?? '',
      segmentRef: input.segmentRef,
      ...(input.ending !== undefined ? { ending: input.ending } : {}),
    })
    .returning()

  if (!row) throw new Error('The short row could not be created')
  return row
}

export async function getShort(db: Database, id: string): Promise<ShortRow | undefined> {
  const [row] = await db.select().from(shorts).where(eq(shorts.id, id)).limit(1)
  return row
}

/** All of a project's Shorts, in creation order — the Shorts screen's grid. */
export async function listShorts(db: Database, projectId: string): Promise<ShortRow[]> {
  return db
    .select()
    .from(shorts)
    .where(eq(shorts.projectId, projectId))
    .orderBy(asc(shorts.createdAt), asc(shorts.id))
}

export async function updateShort(
  db: Database,
  id: string,
  patch: Partial<{
    title: string
    description: string
    ending: ShortRow['ending']
    renderId: string | null
    relatedLinkChecked: boolean
  }>,
): Promise<void> {
  await db
    .update(shorts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(shorts.id, id))
}

/**
 * The latest script's Shorts candidates — what the shorts-runner resolves.
 * The script gate approved these implicitly: they were on show in the
 * Script Studio's context panel when the script was approved.
 */
export async function latestShortsCandidates(
  db: Database,
  projectId: string,
): Promise<ShortsCandidate[]> {
  const [script] = await db
    .select({ candidates: scripts.shortsCandidates })
    .from(scripts)
    .where(eq(scripts.projectId, projectId))
    .orderBy(desc(scripts.version))
    .limit(1)

  return script?.candidates ?? []
}
