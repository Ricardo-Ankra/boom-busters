import { and, desc, eq, gt, isNotNull, notExists, sql } from 'drizzle-orm'
import type { TalkingPoint } from '@boom-busters/schemas'
import type { Database } from './client'
import { talkingPointSets } from './schema'
import type { TalkingPointSetRow } from './schema'

/**
 * Talking-point proposals (playbook Shorts design 3.2). Versions are append
 * only: a re-proposal never edits an earlier set, and approval stamps the one
 * row the owner read, so the Shorts that follow can say which proposal they
 * came from.
 */

export async function insertTalkingPointSet(
  db: Database,
  input: { projectId: string; scriptVersion: number; points: TalkingPoint[]; note: string | null },
): Promise<TalkingPointSetRow> {
  const latest = await latestTalkingPointSet(db, input.projectId)
  const [row] = await db
    .insert(talkingPointSets)
    .values({
      projectId: input.projectId,
      version: (latest?.version ?? 0) + 1,
      scriptVersion: input.scriptVersion,
      points: input.points,
      note: input.note,
    })
    .returning()

  if (!row) throw new Error('The talking-point set could not be created')
  return row
}

export async function latestTalkingPointSet(
  db: Database,
  projectId: string,
): Promise<TalkingPointSetRow | undefined> {
  const [row] = await db
    .select()
    .from(talkingPointSets)
    .where(eq(talkingPointSets.projectId, projectId))
    .orderBy(desc(talkingPointSets.version))
    .limit(1)
  return row
}

/** Every version, newest first: the screen's note history. */
export async function listTalkingPointSets(
  db: Database,
  projectId: string,
): Promise<TalkingPointSetRow[]> {
  return db
    .select()
    .from(talkingPointSets)
    .where(eq(talkingPointSets.projectId, projectId))
    .orderBy(desc(talkingPointSets.version))
}

/** The newest set the owner approved; later unapproved proposals do not hide it. */
export async function approvedTalkingPointSet(
  db: Database,
  projectId: string,
): Promise<TalkingPointSetRow | undefined> {
  const [row] = await db
    .select()
    .from(talkingPointSets)
    .where(and(eq(talkingPointSets.projectId, projectId), isNotNull(talkingPointSets.approvedAt)))
    .orderBy(desc(talkingPointSets.version))
    .limit(1)
  return row
}

/**
 * Stamp one version approved, but only while no higher version exists. The
 * guard lives in the UPDATE itself, so a re-proposal landing between a
 * caller's read and this write cannot be overtaken.
 */
export async function stampTalkingPointSet(
  db: Database,
  projectId: string,
  version: number,
): Promise<boolean> {
  const stamped = await db
    .update(talkingPointSets)
    .set({ approvedAt: new Date() })
    .where(
      and(
        eq(talkingPointSets.projectId, projectId),
        eq(talkingPointSets.version, version),
        notExists(
          db
            .select({ one: sql`1` })
            .from(talkingPointSets)
            .where(
              and(eq(talkingPointSets.projectId, projectId), gt(talkingPointSets.version, version)),
            ),
        ),
      ),
    )
    .returning({ id: talkingPointSets.id })
  return stamped.length > 0
}

/**
 * Take back one version's approval: the builds it was approved for could not
 * be started, so a later `master.ready` must not build a set the owner never
 * saw go out. Conditional on that version, so a newer approval is untouched.
 */
export async function unstampTalkingPointSet(
  db: Database,
  projectId: string,
  version: number,
): Promise<void> {
  await db
    .update(talkingPointSets)
    .set({ approvedAt: null })
    .where(and(eq(talkingPointSets.projectId, projectId), eq(talkingPointSets.version, version)))
}

/**
 * Approve one version. `stale` when a higher version exists: the owner read a
 * proposal that has since been replaced, and approving it would build Shorts
 * from points they are no longer looking at.
 */
export async function approveTalkingPointSet(
  db: Database,
  projectId: string,
  version: number,
): Promise<'approved' | 'stale' | 'missing'> {
  if (await stampTalkingPointSet(db, projectId, version)) return 'approved'

  // Nothing stamped: tell an overtaken version from one that never existed.
  const latest = await latestTalkingPointSet(db, projectId)
  if (!latest || latest.version < version) return 'missing'
  return latest.version > version ? 'stale' : 'missing'
}
