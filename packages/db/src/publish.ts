import { and, count, eq, gte } from 'drizzle-orm'
import type { Database } from './client'
import { publishRecords } from './schema'
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
