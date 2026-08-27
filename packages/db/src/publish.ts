import { and, count, eq, gte, inArray, isNotNull } from 'drizzle-orm'
import type { Database } from './client'
import { projects, publishRecords, shorts } from './schema'
import type { PublishRecordRow } from './schema'

/**
 * Publish bookkeeping (build spec sections 5 and 9). Two rules with teeth:
 *
 * 1. **One record per target, and `draft → uploading` is atomic.** The
 *    unique(targetType, targetId) index makes a second record impossible;
 *    `beginUpload`'s `UPDATE … WHERE status='draft'` makes a second
 *    simultaneous upload of the same record impossible. Together they are
 *    the double-upload guard.
 * 2. **The daily budget counts upload STARTS in the YouTube quota day.**
 *    `uploadStartedAt` is stamped inside the same atomic transition, so an
 *    upload that later failed still spent its 1600 quota units and still
 *    counts.
 */

/**
 * The one way a publish record comes to exist: the Publish screen's first
 * touch of an item (a saved draft, an uploaded thumbnail, a chosen slot).
 * Idempotent against the unique(targetType, targetId) index — a second call
 * hands back the row the first one made, never a duplicate.
 */
export async function ensurePublishRecord(
  db: Database,
  targetType: PublishRecordRow['targetType'],
  targetId: string,
): Promise<PublishRecordRow> {
  const [inserted] = await db
    .insert(publishRecords)
    .values({ targetType, targetId })
    .onConflictDoNothing()
    .returning()
  if (inserted) return inserted

  const existing = await getPublishRecord(db, targetType, targetId)
  if (!existing) throw new Error('The publish record could not be created')
  return existing
}

/**
 * Every record the Publish screen shows for one project: the master's (by
 * projectId) and each Short's (by shortId), in one read.
 */
export async function listPublishRecords(
  db: Database,
  input: { projectId: string; shortIds: readonly string[] },
): Promise<PublishRecordRow[]> {
  const masters = await db
    .select()
    .from(publishRecords)
    .where(
      and(eq(publishRecords.targetType, 'master'), eq(publishRecords.targetId, input.projectId)),
    )
  if (input.shortIds.length === 0) return masters

  const rows = await db
    .select()
    .from(publishRecords)
    .where(
      and(
        eq(publishRecords.targetType, 'short'),
        inArray(publishRecords.targetId, [...input.shortIds]),
      ),
    )
  return [...masters, ...rows]
}

export async function getPublishRecord(
  db: Database,
  targetType: PublishRecordRow['targetType'],
  targetId: string,
): Promise<PublishRecordRow | undefined> {
  const [row] = await db
    .select()
    .from(publishRecords)
    .where(and(eq(publishRecords.targetType, targetType), eq(publishRecords.targetId, targetId)))
    .limit(1)
  return row
}

/**
 * The atomic `draft → uploading` transition (spec section 7.2 item 8:
 * "never uploads without an existing publish_records row transitioning
 * draft→uploading atomically"). Returns the claimed row, or undefined when
 * the record was not in `draft` — a double-fire, refused by the WHERE.
 */
export async function beginUpload(
  db: Database,
  id: string,
  now: Date = new Date(),
): Promise<PublishRecordRow | undefined> {
  const [row] = await db
    .update(publishRecords)
    .set({ status: 'uploading', uploadStartedAt: now, error: null, updatedAt: now })
    .where(and(eq(publishRecords.id, id), eq(publishRecords.status, 'draft')))
    .returning()
  return row
}

export async function updatePublishRecord(
  db: Database,
  id: string,
  patch: Partial<{
    status: PublishRecordRow['status']
    youtubeVideoId: string
    publishAt: Date
    uploadedThumbKeys: string[]
    metadata: Record<string, unknown>
    error: Record<string, unknown> | null
  }>,
): Promise<void> {
  await db
    .update(publishRecords)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(publishRecords.id, id))
}

/** One row on the global Calendar: a slotted target and where it belongs. */
export interface ScheduledPublishItem {
  id: string
  targetType: PublishRecordRow['targetType']
  projectId: string
  projectTitle: string
  /** The project's title for a master, the Short card's title for a Short. */
  label: string
  status: PublishRecordRow['status']
  publishAt: Date
  youtubeVideoId: string | null
}

/**
 * Every slotted publish record across every project — the Calendar rail
 * page's one read. `publish_records` carries no projectId (targetId is the
 * project for a master, the Short for a Short), so masters join `projects`
 * directly and Shorts join through their card. Records never slotted
 * (`publishAt` null) are drafts in progress and stay off the calendar.
 */
export async function scheduledPublishItems(db: Database): Promise<ScheduledPublishItem[]> {
  const masters = await db
    .select({ record: publishRecords, projectTitle: projects.title })
    .from(publishRecords)
    .innerJoin(projects, eq(projects.id, publishRecords.targetId))
    .where(and(eq(publishRecords.targetType, 'master'), isNotNull(publishRecords.publishAt)))

  const shortRows = await db
    .select({ record: publishRecords, projectId: shorts.projectId, label: shorts.title })
    .from(publishRecords)
    .innerJoin(shorts, eq(shorts.id, publishRecords.targetId))
    .where(and(eq(publishRecords.targetType, 'short'), isNotNull(publishRecords.publishAt)))

  const shortProjects =
    shortRows.length > 0
      ? await db
          .select({ id: projects.id, title: projects.title })
          .from(projects)
          .where(inArray(projects.id, [...new Set(shortRows.map((row) => row.projectId))]))
      : []
  const titleOf = new Map(shortProjects.map((project) => [project.id, project.title]))

  const items: ScheduledPublishItem[] = [
    ...masters.map((row) => ({
      id: row.record.id,
      targetType: row.record.targetType,
      projectId: row.record.targetId,
      projectTitle: row.projectTitle,
      label: row.projectTitle,
      status: row.record.status,
      publishAt: row.record.publishAt!,
      youtubeVideoId: row.record.youtubeVideoId,
    })),
    ...shortRows.map((row) => ({
      id: row.record.id,
      targetType: row.record.targetType,
      projectId: row.projectId,
      projectTitle: titleOf.get(row.projectId) ?? row.projectId,
      label: row.label,
      status: row.record.status,
      publishAt: row.record.publishAt!,
      youtubeVideoId: row.record.youtubeVideoId,
    })),
  ]
  return items.sort((a, b) => a.publishAt.getTime() - b.publishAt.getTime())
}

/**
 * Every record with a YouTube video behind it — the analytics cron's worklist
 * (M8): scheduled ones get their privacy reconciled, live ones get snapshots.
 */
export async function videoBackedRecords(
  db: Database,
): Promise<
  Pick<
    PublishRecordRow,
    'id' | 'targetType' | 'targetId' | 'youtubeVideoId' | 'status' | 'publishAt'
  >[]
> {
  return db
    .select({
      id: publishRecords.id,
      targetType: publishRecords.targetType,
      targetId: publishRecords.targetId,
      youtubeVideoId: publishRecords.youtubeVideoId,
      status: publishRecords.status,
      publishAt: publishRecords.publishAt,
    })
    .from(publishRecords)
    .where(isNotNull(publishRecords.youtubeVideoId))
}

/**
 * Upload starts since a moment — the daily-budget question, asked with
 * `quotaDayStartUtc(now)` from schemas as the boundary.
 */
export async function countUploadsSince(db: Database, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(publishRecords)
    .where(gte(publishRecords.uploadStartedAt, since))
  return row?.value ?? 0
}
