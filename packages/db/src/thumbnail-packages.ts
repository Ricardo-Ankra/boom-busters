import { PACKAGES_MAX } from '@boom-busters/schemas'
import type { PlannedPackage } from '@boom-busters/schemas'
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import type { Database } from './client'
import { publishRecords, thumbnailPackages } from './schema'
import type { PublishRecordRow, ThumbnailPackageRow } from './schema'

/**
 * A master's thumbnail packages (generated thumbnails and title sets). Two
 * rules with teeth:
 *
 * 1. **`publish_records.uploaded_thumb_keys` stays the only thing the upload
 *    runner reads.** Approving, re-ordering or removing an approved package
 *    rewrites that array in the same transaction, so the runner never sees a
 *    set the screen does not show.
 * 2. **At most three packages are approved.** Approval checks the count under
 *    a row lock on the publish record, so two simultaneous approvals cannot
 *    both pass.
 */

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]
type Executor = Database | Tx

export type ThumbnailPackagePatch = Partial<
  Omit<typeof thumbnailPackages.$inferInsert, 'id' | 'publishRecordId' | 'createdAt'>
>

/** Every package of one record, in the order the owner arranged them. */
export async function listThumbnailPackages(
  db: Executor,
  publishRecordId: string,
): Promise<ThumbnailPackageRow[]> {
  return db
    .select()
    .from(thumbnailPackages)
    .where(eq(thumbnailPackages.publishRecordId, publishRecordId))
    .orderBy(asc(thumbnailPackages.position), asc(thumbnailPackages.createdAt))
}

export async function getThumbnailPackage(
  db: Executor,
  id: string,
): Promise<ThumbnailPackageRow | undefined> {
  const [row] = await db.select().from(thumbnailPackages).where(eq(thumbnailPackages.id, id))
  return row
}

/** Serialise writers of one record's packages: the lock is held to the end of the transaction. */
async function lockRecord(tx: Tx, publishRecordId: string): Promise<void> {
  await tx
    .select({ id: publishRecords.id })
    .from(publishRecords)
    .where(eq(publishRecords.id, publishRecordId))
    .for('update')
}

async function nextPosition(tx: Tx, publishRecordId: string): Promise<number> {
  const [row] = await tx
    .select({ highest: sql<number | null>`max(${thumbnailPackages.position})` })
    .from(thumbnailPackages)
    .where(eq(thumbnailPackages.publishRecordId, publishRecordId))
  return row?.highest === null || row?.highest === undefined ? 0 : row.highest + 1
}

/**
 * Brings the legacy `uploaded_thumb_keys` into the table: one uploaded,
 * approved, ready package for each key no package's composed image holds.
 * Idempotent, so the Publish screen can call it on every load.
 */
export async function ensureUploadedPackages(
  db: Database,
  record: PublishRecordRow,
): Promise<void> {
  if (record.uploadedThumbKeys.length === 0) return
  await db.transaction(async (tx) => {
    await lockRecord(tx, record.id)
    await backfillStoredKeys(tx, record.id)
  })
}

/**
 * The backfill itself, inside a transaction that already holds the record's
 * lock: reads the stored keys fresh and adds a package for each no package
 * holds. Every writer that rebuilds `uploaded_thumb_keys` from rows runs this
 * first, so a key stored before the table existed is never dropped.
 */
async function backfillStoredKeys(tx: Tx, publishRecordId: string): Promise<void> {
  const [record] = await tx
    .select({ keys: publishRecords.uploadedThumbKeys })
    .from(publishRecords)
    .where(eq(publishRecords.id, publishRecordId))
  if (!record || record.keys.length === 0) return
  const held = new Set(
    (await listThumbnailPackages(tx, publishRecordId)).flatMap((row) =>
      row.composedKey === null ? [] : [row.composedKey],
    ),
  )
  const missing = record.keys.filter((key) => !held.has(key))
  if (missing.length === 0) return
  const first = await nextPosition(tx, publishRecordId)
  const approvedAt = new Date()
  await tx.insert(thumbnailPackages).values(
    missing.map((key, index) => ({
      publishRecordId,
      position: first + index,
      source: 'uploaded' as const,
      state: 'ready' as const,
      composedKey: key,
      approvedAt,
    })),
  )
}

/**
 * A fresh plan replaces the old one, but never what the owner kept: approved
 * packages and uploaded ones stay. `orphanedKeys` are the images of the rows
 * deleted, for the caller to remove from storage.
 */
export async function replaceUnapprovedGenerated(
  db: Database,
  publishRecordId: string,
  planned: PlannedPackage[],
): Promise<{ inserted: ThumbnailPackageRow[]; orphanedKeys: string[] }> {
  return db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    const deleted = await tx
      .delete(thumbnailPackages)
      .where(
        and(
          eq(thumbnailPackages.publishRecordId, publishRecordId),
          eq(thumbnailPackages.source, 'generated'),
          isNull(thumbnailPackages.approvedAt),
        ),
      )
      .returning({
        pictureKey: thumbnailPackages.pictureKey,
        composedKey: thumbnailPackages.composedKey,
      })
    const orphanedKeys = deleted.flatMap((row) =>
      [row.pictureKey, row.composedKey].filter((key): key is string => key !== null),
    )
    if (planned.length === 0) return { inserted: [], orphanedKeys }

    const first = await nextPosition(tx, publishRecordId)
    const inserted = await tx
      .insert(thumbnailPackages)
      .values(
        planned.map((item, index) => ({
          publishRecordId,
          position: first + index,
          source: 'generated' as const,
          state: 'planned' as const,
          idea: item.idea,
          angle: item.angle,
          title: item.title,
          headline: item.headline,
          picture: item.picture,
          claimIds: item.claimIds,
          depicts: item.picture.depicts,
          textSide: item.picture.textSide,
        })),
      )
      .returning()
    inserted.sort((a, b) => a.position - b.position)
    return { inserted, orphanedKeys }
  })
}

export async function updateThumbnailPackage(
  db: Executor,
  id: string,
  patch: ThumbnailPackagePatch,
): Promise<ThumbnailPackageRow | undefined> {
  const [row] = await db
    .update(thumbnailPackages)
    .set(patch)
    .where(eq(thumbnailPackages.id, id))
    .returning()
  return row
}

/** The owner's own picture, as a ready package after the last one. Not approved yet. */
export async function addUploadedPackage(
  db: Database,
  publishRecordId: string,
  key: string,
): Promise<ThumbnailPackageRow> {
  return db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    const [row] = await tx
      .insert(thumbnailPackages)
      .values({
        publishRecordId,
        position: await nextPosition(tx, publishRecordId),
        source: 'uploaded',
        state: 'ready',
        composedKey: key,
      })
      .returning()
    if (!row) throw new Error('The uploaded package could not be created')
    return row
  })
}

/**
 * Writes the approved packages' images to `uploaded_thumb_keys` in position
 * order and the first approved package's title to `metadata.title` (merged
 * over the rest of the metadata, never replacing it). The first approved
 * package with an image is the one whose image is `keys[0]`, the default the
 * runner uploads, so the title always belongs to that picture. A blank title,
 * or no approved package, leaves `metadata.title` alone. Callers hold the
 * record's lock and have backfilled stored keys.
 */
async function writeApprovedToRecord(
  tx: Tx,
  publishRecordId: string,
): Promise<{ keys: string[]; title: string | null }> {
  const approved = (await listThumbnailPackages(tx, publishRecordId)).filter(
    (row) => row.approvedAt !== null && row.composedKey !== null,
  )
  const keys = approved.flatMap((row) => (row.composedKey === null ? [] : [row.composedKey]))
  const first = approved[0]
  const title = first?.title.trim() ? first.title : null
  await tx
    .update(publishRecords)
    .set(
      title !== null
        ? {
            uploadedThumbKeys: keys,
            metadata: sql`${publishRecords.metadata} || ${JSON.stringify({ title })}::jsonb`,
          }
        : { uploadedThumbKeys: keys },
    )
    .where(eq(publishRecords.id, publishRecordId))
  return { keys, title }
}

/**
 * Re-derives `uploaded_thumb_keys` and `metadata.title` from the approved
 * packages, for a caller that changed a package's title in place. The same
 * derivation approving runs, under the record's lock.
 */
export async function syncApprovedToRecord(db: Database, publishRecordId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    await backfillStoredKeys(tx, publishRecordId)
    await writeApprovedToRecord(tx, publishRecordId)
  })
}

/**
 * That package becomes the first; the rest keep their order. Only an approved
 * package changes the upload: then the keys and the title follow the new first
 * approved package. Making an unapproved one the default changes neither.
 */
export async function makeDefaultPackage(
  db: Database,
  publishRecordId: string,
  packageId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    await backfillStoredKeys(tx, publishRecordId)
    const rows = await listThumbnailPackages(tx, publishRecordId)
    const chosen = rows.find((row) => row.id === packageId)
    if (!chosen) return
    const ordered = [chosen, ...rows.filter((row) => row.id !== packageId)]
    for (const [position, row] of ordered.entries()) {
      if (row.position !== position) {
        await tx.update(thumbnailPackages).set({ position }).where(eq(thumbnailPackages.id, row.id))
      }
    }
    if (chosen.approvedAt !== null) await writeApprovedToRecord(tx, publishRecordId)
  })
}

/**
 * Approves every ready, composed package not yet approved, unless that would
 * leave more than three approved: then nothing changes and `over` says by how
 * many. The first approved package's title becomes the video's title.
 */
export async function approvePackages(
  db: Database,
  publishRecordId: string,
): Promise<{ ok: true; keys: string[]; title: string | null } | { ok: false; over: number }> {
  return db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    await backfillStoredKeys(tx, publishRecordId)
    const rows = await listThumbnailPackages(tx, publishRecordId)
    const approvedCount = rows.filter((row) => row.approvedAt !== null).length
    const candidates = rows.filter(
      (row) => row.approvedAt === null && row.composedKey !== null && row.state === 'ready',
    )
    const over = approvedCount + candidates.length - PACKAGES_MAX
    if (over > 0) return { ok: false as const, over }

    if (candidates.length > 0) {
      await tx
        .update(thumbnailPackages)
        .set({ approvedAt: new Date() })
        .where(
          inArray(
            thumbnailPackages.id,
            candidates.map((row) => row.id),
          ),
        )
    }
    const written = await writeApprovedToRecord(tx, publishRecordId)
    return { ok: true as const, ...written }
  })
}

/**
 * Deletes a package. When it was approved its image leaves
 * `uploaded_thumb_keys` too, and the title follows the new first approved
 * package (none left: the title stays). `orphanedKeys` are its images, for the caller to
 * remove from storage.
 */
export async function removeThumbnailPackage(
  db: Database,
  id: string,
): Promise<{ orphanedKeys: string[] } | undefined> {
  return db.transaction(async (tx) => {
    const found = await getThumbnailPackage(tx, id)
    if (!found) return undefined
    await lockRecord(tx, found.publishRecordId)
    await backfillStoredKeys(tx, found.publishRecordId)
    const [removed] = await tx
      .delete(thumbnailPackages)
      .where(eq(thumbnailPackages.id, id))
      .returning()
    if (!removed) return undefined
    if (removed.approvedAt !== null && removed.composedKey !== null) {
      await writeApprovedToRecord(tx, removed.publishRecordId)
    }
    return {
      orphanedKeys: [removed.pictureKey, removed.composedKey].filter(
        (key): key is string => key !== null,
      ),
    }
  })
}

/**
 * Replaces one approved image with another at the same place in
 * `uploaded_thumb_keys`. A key not in the array changes nothing.
 */
export async function swapApprovedKey(
  db: Database,
  publishRecordId: string,
  oldKey: string,
  newKey: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [record] = await tx
      .select({ keys: publishRecords.uploadedThumbKeys })
      .from(publishRecords)
      .where(eq(publishRecords.id, publishRecordId))
      .for('update')
    if (!record) return
    const index = record.keys.indexOf(oldKey)
    if (index === -1) return
    const keys = [...record.keys]
    keys[index] = newKey
    await tx
      .update(publishRecords)
      .set({ uploadedThumbKeys: keys })
      .where(eq(publishRecords.id, publishRecordId))
  })
}

/** The names the approved generated pictures show, so a new plan can avoid repeating them. */
export async function approvedDepicts(db: Executor, publishRecordId: string): Promise<string[]> {
  const rows = await db
    .select({ depicts: thumbnailPackages.depicts })
    .from(thumbnailPackages)
    .where(
      and(
        eq(thumbnailPackages.publishRecordId, publishRecordId),
        eq(thumbnailPackages.source, 'generated'),
        isNotNull(thumbnailPackages.approvedAt),
      ),
    )
  return [...new Set(rows.flatMap((row) => row.depicts))]
}

/**
 * Live masters whose test is ready to start: a video on YouTube, two or more
 * approved packages to compare, and no reminder sent yet.
 */
export async function recordsAwaitingTestReminder(
  db: Executor,
  channelId: string,
): Promise<{ id: string; targetId: string; youtubeVideoId: string }[]> {
  const rows = await db
    .select({
      id: publishRecords.id,
      targetId: publishRecords.targetId,
      youtubeVideoId: publishRecords.youtubeVideoId,
    })
    .from(publishRecords)
    .where(
      and(
        eq(publishRecords.channelId, channelId),
        eq(publishRecords.targetType, 'master'),
        eq(publishRecords.status, 'live'),
        isNull(publishRecords.testReminderSentAt),
        isNotNull(publishRecords.youtubeVideoId),
        sql`(select count(*) from ${thumbnailPackages} where ${thumbnailPackages.publishRecordId} = ${publishRecords.id} and ${thumbnailPackages.approvedAt} is not null) >= 2`,
      ),
    )
  return rows.flatMap((row) =>
    row.youtubeVideoId === null
      ? []
      : [{ id: row.id, targetId: row.targetId, youtubeVideoId: row.youtubeVideoId }],
  )
}
