import { and, desc, eq, isNotNull } from 'drizzle-orm'
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
 * Approve one version. `stale` when a higher version exists: the owner read a
 * proposal that has since been replaced, and approving it would build Shorts
 * from points they are no longer looking at.
 */
export async function approveTalkingPointSet(
  db: Database,
  projectId: string,
  version: number,
): Promise<'approved' | 'stale' | 'missing'> {
  const latest = await latestTalkingPointSet(db, projectId)
  if (!latest || latest.version < version) return 'missing'
  if (latest.version > version) return 'stale'

  const approved = await db
    .update(talkingPointSets)
    .set({ approvedAt: new Date() })
    .where(and(eq(talkingPointSets.projectId, projectId), eq(talkingPointSets.version, version)))
    .returning({ id: talkingPointSets.id })
  return approved.length > 0 ? 'approved' : 'missing'
}
