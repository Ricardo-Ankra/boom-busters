import { desc, eq } from 'drizzle-orm'
import { TimelineSchema } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import type { Database } from './client'
import { timelines } from './schema'
import type { TimelineRow } from './schema'

/**
 * Timeline storage (build spec section 5). Versions are append-only: a
 * recompile after a music swap or a board edit writes version n+1, never
 * mutates version n — an old renders row referencing timelineVersion 3 must
 * be able to say exactly what it rendered forever. The JSON is validated on
 * the way IN as well as at compile time: a row that does not parse against
 * TimelineSchema must never exist.
 */

export async function insertTimeline(
  db: Database,
  input: { projectId: string; json: Timeline; s3Key: string },
): Promise<TimelineRow> {
  const timeline = TimelineSchema.parse(input.json)
  const latest = await latestTimeline(db, input.projectId)
  const version = (latest?.version ?? 0) + 1

  const [row] = await db
    .insert(timelines)
    .values({
      projectId: input.projectId,
      version,
      json: timeline as unknown as Record<string, unknown>,
      s3Key: input.s3Key,
      compiledAt: new Date(),
    })
    .returning()

  if (!row) throw new Error('The timeline could not be stored')
  return row
}

/** Record where the compiled JSON was uploaded, once the bytes are safe. */
export async function setTimelineKey(db: Database, id: string, s3Key: string): Promise<void> {
  await db.update(timelines).set({ s3Key }).where(eq(timelines.id, id))
}

export async function latestTimeline(
  db: Database,
  projectId: string,
): Promise<TimelineRow | undefined> {
  const [row] = await db
    .select()
    .from(timelines)
    .where(eq(timelines.projectId, projectId))
    .orderBy(desc(timelines.version))
    .limit(1)
  return row
}
