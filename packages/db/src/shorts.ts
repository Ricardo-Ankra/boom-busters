import { and, asc, desc, eq, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import type { Database } from './client'
import { scripts, shorts } from './schema'
import type { ShortRow } from './schema'
import type {
  PointFetchesRecord,
  PointPlanRecord,
  PointScriptRecord,
  PointVoiceRecord,
  PointWork,
  PointWorkState,
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
    /** Null turns a point Short back into a draft (rebuild from the new script). */
    sourceTimeline: Record<string, unknown> | null
    teaserScript: Record<string, unknown>
    /** The studio's split acts (decision 230): voice and shot choices. */
    teaserVoice: Record<string, unknown>
    teaserShots: Record<string, unknown>
    /** The studio's fetched new material (decision 231). */
    teaserFetches: Record<string, unknown>
    /**
     * A point Short's script, voice, shot plan and fetched material (design
     * 3.5). Null clears a record, as a rebuild from the new script does.
     */
    pointScript: PointScriptRecord | null
    pointVoice: PointVoiceRecord | null
    pointPlan: PointPlanRecord | null
    pointFetches: PointFetchesRecord | null
  }>,
): Promise<void> {
  await db
    .update(shorts)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(shorts.id, id))
}

/**
 * Win the Short studio's one slot of work on a point Short (design 6): an
 * atomic compare-and-set on the stored fetch state, so two presses racing each
 * other cannot both pass a read-then-write and both pay. Exactly one UPDATE
 * matches the WHERE. A slot already `fetching` is refused until `staleBefore`,
 * so a run that vanished without writing its failure cannot lock the Short
 * for good (decision 234); a record with no timestamp predates the guard and
 * may be claimed.
 */
export async function claimPointWork(
  db: Database,
  id: string,
  what: PointWork,
  staleBefore: Date,
): Promise<boolean> {
  const state = JSON.stringify({
    state: 'fetching',
    what,
    startedAt: new Date().toISOString(),
  } satisfies PointWorkState)
  const rows = await db
    .update(shorts)
    .set({
      pointFetches: sql`jsonb_set(coalesce(${shorts.pointFetches}, '{"candidates":[],"state":null}'::jsonb), '{state}', ${state}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shorts.id, id),
        or(
          sql`${shorts.pointFetches} is null`,
          sql`coalesce(${shorts.pointFetches} -> 'state' ->> 'state', '') <> 'fetching'`,
          sql`coalesce((${shorts.pointFetches} -> 'state' ->> 'startedAt')::timestamptz, '-infinity'::timestamptz) < ${staleBefore.toISOString()}::timestamptz`,
        ),
      ),
    )
    .returning({ id: shorts.id })
  return rows.length > 0
}

/**
 * Put the studio's slot back: `null` when the work is done, a `failed` state
 * (with words for the studio to show) when it stopped. Touches only the state,
 * so the fetched pool a racing write just stored is never overwritten.
 */
export async function settlePointWork(
  db: Database,
  id: string,
  state: PointWorkState | null,
): Promise<void> {
  await db
    .update(shorts)
    .set({
      pointFetches: sql`jsonb_set(coalesce(${shorts.pointFetches}, '{"candidates":[],"state":null}'::jsonb), '{state}', ${JSON.stringify(state)}::jsonb)`,
      updatedAt: new Date(),
    })
    .where(eq(shorts.id, id))
}

/**
 * Give back the studio's slot only when it is held for `what` (the render
 * runner releases an `assemble` claim this way): one UPDATE with the condition
 * in its WHERE, so a re-voice, a re-plan, a fetch or a stored failure that is
 * present at that moment is left exactly as it is.
 */
export async function releasePointWork(db: Database, id: string, what: PointWork): Promise<void> {
  await db
    .update(shorts)
    .set({
      pointFetches: sql`jsonb_set(${shorts.pointFetches}, '{state}', 'null'::jsonb)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(shorts.id, id),
        sql`${shorts.pointFetches} -> 'state' ->> 'state' = 'fetching'`,
        sql`${shorts.pointFetches} -> 'state' ->> 'what' = ${what}`,
      ),
    )
}

/**
 * Store one shot's new choice (a plan with the shot changed) and, when its
 * picture was just downloaded, the settled pool candidate, in ONE conditional
 * UPDATE. The plan is written only if it is still exactly what the caller read
 * (`expectedPlan`), so a paid re-plan that landed meanwhile is never overwritten
 * (false is returned and nothing changes). The pool is touched candidate by
 * candidate: the work state and any candidate added meanwhile are left as they
 * stand.
 */
export async function savePointShotChoice(
  db: Database,
  id: string,
  input: {
    expectedPlan: unknown
    plan: PointPlanRecord
    settled?: { id: string } & Record<string, unknown>
  },
): Promise<boolean> {
  const pool = input.settled
    ? sql`coalesce(jsonb_set(${shorts.pointFetches}, '{candidates}', coalesce((select jsonb_agg(case when t.c ->> 'id' = ${input.settled.id} then ${JSON.stringify(input.settled)}::jsonb else t.c end order by t.o) from jsonb_array_elements(${shorts.pointFetches} -> 'candidates') with ordinality as t(c, o)), '[]'::jsonb)), ${shorts.pointFetches})`
    : sql`${shorts.pointFetches}`
  const rows = await db
    .update(shorts)
    .set({ pointPlan: input.plan, pointFetches: pool, updatedAt: new Date() })
    .where(
      and(
        eq(shorts.id, id),
        sql`${shorts.pointPlan} = ${JSON.stringify(input.expectedPlan)}::jsonb`,
      ),
    )
    .returning({ id: shorts.id })
  return rows.length > 0
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
