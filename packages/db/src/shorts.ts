import { and, asc, desc, eq, inArray, isNotNull, ne, or } from 'drizzle-orm'
import type { Database } from './client'
import { scripts, shorts } from './schema'
import type { ShortRow } from './schema'
import type {
  PointFetchesRecord,
  PointPlanRecord,
  PointScriptRecord,
  PointVoiceRecord,
  ShortsCandidate,
} from '@boom-busters/schemas'

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
    /** 'teaser' rows carry their own mini master; excerpts leave both unset. */
    kind?: ShortRow['kind']
    sourceTimeline?: Record<string, unknown>
    /** The teaser's editable script (decision 227); excerpts leave it unset. */
    teaserScript?: Record<string, unknown>
    /** The voiced beats (decision 230); stored at build so the studio starts consistent. */
    teaserVoice?: Record<string, unknown>
    /** 'point' rows name their talking point and carry its script (design 3.5). */
    pointId?: string
    pointScript?: PointScriptRecord
    pointVoice?: PointVoiceRecord
    pointPlan?: PointPlanRecord
    pointFetches?: PointFetchesRecord
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
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.sourceTimeline !== undefined ? { sourceTimeline: input.sourceTimeline } : {}),
      ...(input.teaserScript !== undefined ? { teaserScript: input.teaserScript } : {}),
      ...(input.teaserVoice !== undefined ? { teaserVoice: input.teaserVoice } : {}),
      ...(input.pointId !== undefined ? { pointId: input.pointId } : {}),
      ...(input.pointScript !== undefined ? { pointScript: input.pointScript } : {}),
      ...(input.pointVoice !== undefined ? { pointVoice: input.pointVoice } : {}),
      ...(input.pointPlan !== undefined ? { pointPlan: input.pointPlan } : {}),
      ...(input.pointFetches !== undefined ? { pointFetches: input.pointFetches } : {}),
    })
    .returning()

  if (!row) throw new Error('The short row could not be created')
  return row
}

export async function getShort(db: Database, id: string): Promise<ShortRow | undefined> {
  const [row] = await db.select().from(shorts).where(eq(shorts.id, id)).limit(1)
  return row
}

/**
 * Remove Shorts rows (decision 300): excerpts cut from an earlier script,
 * whose narration the rebuilt master no longer has. Their renders go with
 * them (the FK cascades); the cost trail is the ledger, not the render row.
 */
export async function deleteShorts(db: Database, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  await db.delete(shorts).where(inArray(shorts.id, [...ids]))
}

/** The Short built for one talking point, if any. */
export async function shortForPoint(
  db: Database,
  projectId: string,
  pointId: string,
): Promise<ShortRow | undefined> {
  const [row] = await db
    .select()
    .from(shorts)
    .where(and(eq(shorts.projectId, projectId), eq(shorts.pointId, pointId)))
    .limit(1)
  return row
}

/**
 * Whether a Short is finished. A point Short's row is created as its build
 * saves progress (script, then voice, then plan), so a re-run resumes instead
 * of re-buying; until its master is compiled it is a draft, not a Short.
 */
export function isAssembledShort(row: Pick<ShortRow, 'kind' | 'sourceTimeline'>): boolean {
  return row.kind !== 'point' || row.sourceTimeline != null
}

/**
 * A project's finished Shorts, in creation order — the Shorts screen's grid.
 * A point Short still being built (no compiled master yet) is not listed; ask
 * `shortForPoint` for it.
 */
export async function listShorts(db: Database, projectId: string): Promise<ShortRow[]> {
  return db
    .select()
    .from(shorts)
    .where(
      and(
        eq(shorts.projectId, projectId),
        or(ne(shorts.kind, 'point'), isNotNull(shorts.sourceTimeline)),
      ),
    )
    .orderBy(asc(shorts.createdAt), asc(shorts.id))
}

export async function updateShort(
  db: Database,
  id: string,
  patch: Partial<{
    title: string
    description: string
    ending: ShortRow['ending']
    /** Burned-in captions on or off (decision 326). */
    captions: boolean
    renderId: string | null
    relatedLinkChecked: boolean
    /** The teaser studio's edits and the rebuild runner's recut (decision 227). */
    segmentRef: ShortRow['segmentRef']
    sourceTimeline: Record<string, unknown>
    teaserScript: Record<string, unknown>
    /** The studio's split acts (decision 230): voice and shot choices. */
    teaserVoice: Record<string, unknown>
    teaserShots: Record<string, unknown>
    /** The studio's fetched new material (decision 231). */
    teaserFetches: Record<string, unknown>
    /** A point Short's script, voice, shot plan and fetched material (design 3.5). */
    pointScript: PointScriptRecord
    pointVoice: PointVoiceRecord
    pointPlan: PointPlanRecord
    pointFetches: PointFetchesRecord
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
