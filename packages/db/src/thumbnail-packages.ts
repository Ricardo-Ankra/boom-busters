import {
  PACKAGES_MAX,
  PACKAGE_STALE_MS,
  THUMBNAIL_IDEAS,
  packageInFlight,
} from '@boom-busters/schemas'
import type { PlannedPackage, TestResult, ThumbnailIdea } from '@boom-busters/schemas'
import { and, asc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { Database } from './client'
import { projects, publishRecords, thumbnailPackages } from './schema'
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

/**
 * Merges a patch into the record's `metadata` in SQL (`metadata || patch`), so
 * the owner's draft fields saved a moment ago are never overwritten by a stale
 * read. Never read the metadata and write the whole object back.
 */
export async function mergePublishMetadata(
  db: Executor,
  publishRecordId: string,
  patch: Record<string, unknown>,
  removeKeys: readonly string[] = [],
): Promise<void> {
  let merged = sql`(${publishRecords.metadata} || ${JSON.stringify(patch)}::jsonb)`
  for (const key of removeKeys) merged = sql`(${merged} - ${key}::text)`
  await db
    .update(publishRecords)
    .set({ metadata: merged, updatedAt: new Date() })
    .where(eq(publishRecords.id, publishRecordId))
}

const SET_REQUESTED_KEY = 'thumbnailSetRequestedAt'

/**
 * Takes the right to plan a set, so a second "Generate a set" before the first
 * plan has written its rows cannot buy the set twice. Under the record's lock:
 * refused when a claim younger than `PACKAGE_STALE_MS` stands or any package is
 * in flight; otherwise stamps `metadata.thumbnailSetRequestedAt` (merged in
 * SQL) and returns true.
 */
export async function claimThumbnailSetRequest(
  db: Database,
  publishRecordId: string,
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    const [record] = await tx
      .select({
        claimed: sql<string | null>`${publishRecords.metadata}->>'thumbnailSetRequestedAt'`,
      })
      .from(publishRecords)
      .where(eq(publishRecords.id, publishRecordId))
    if (!record) return false
    const claimedAt = record.claimed === null ? Number.NaN : Date.parse(record.claimed)
    if (!Number.isNaN(claimedAt) && now.getTime() - claimedAt <= PACKAGE_STALE_MS) return false
    const rows = await listThumbnailPackages(tx, publishRecordId)
    if (rows.some((row) => packageInFlight(row, now))) return false
    await mergePublishMetadata(tx, publishRecordId, { [SET_REQUESTED_KEY]: now.toISOString() })
    return true
  })
}

/** Gives the claim back: the plan finished, the send failed or the run died. */
export async function clearThumbnailSetRequest(
  db: Executor,
  publishRecordId: string,
): Promise<void> {
  await mergePublishMetadata(db, publishRecordId, {}, [SET_REQUESTED_KEY])
}

/**
 * A stopped project's thumbnail work ends with it: the master record's claim is
 * given back and every package still planned or painting is failed with the
 * reason, so Generate is not blocked for fifteen minutes by a run that was
 * cancelled and will never report. Finished packages are left as they are.
 */
export async function releaseThumbnailWork(
  db: Database,
  projectId: string,
  reason: string,
): Promise<void> {
  const [record] = await db
    .select({
      id: publishRecords.id,
      claimed: sql<string | null>`${publishRecords.metadata}->>'thumbnailSetRequestedAt'`,
    })
    .from(publishRecords)
    .where(and(eq(publishRecords.targetType, 'master'), eq(publishRecords.targetId, projectId)))
  if (!record) return
  // Only a record that holds a claim is written: the clear stamps `updatedAt`,
  // which a live video's "went public" date can fall back to.
  if (record.claimed !== null) await clearThumbnailSetRequest(db, record.id)
  await db
    .update(thumbnailPackages)
    .set({ state: 'failed', error: reason, updatedAt: new Date() })
    .where(
      and(
        eq(thumbnailPackages.publishRecordId, record.id),
        inArray(thumbnailPackages.state, ['planned', 'painting']),
      ),
    )
}

/** Serialise writers of one record's packages: the lock is held to the end of the transaction. */
async function lockRecord(tx: Tx, publishRecordId: string): Promise<void> {
  await tx
    .select({ id: publishRecords.id })
    .from(publishRecords)
    .where(eq(publishRecords.id, publishRecordId))
    .for('update')
}

const UPLOADED_TITLE_MAX = 100

/**
 * The title a new uploaded package carries: the record's saved video title,
 * else the project's working title (a master's `targetId` is its project id).
 * With it, making an uploaded thumbnail the default again writes a title that
 * belongs to it, and its hand-off never offers an empty one.
 */
async function titleForUploaded(tx: Tx, publishRecordId: string): Promise<string> {
  const [record] = await tx
    .select({
      targetType: publishRecords.targetType,
      targetId: publishRecords.targetId,
      saved: sql<string | null>`${publishRecords.metadata}->>'title'`,
    })
    .from(publishRecords)
    .where(eq(publishRecords.id, publishRecordId))
  if (!record) return ''
  let title = record.saved?.trim() ?? ''
  if (title === '' && record.targetType === 'master') {
    const [project] = await tx
      .select({ title: projects.title })
      .from(projects)
      .where(eq(projects.id, record.targetId))
    title = project?.title.trim() ?? ''
  }
  return title.slice(0, UPLOADED_TITLE_MAX)
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
  const title = await titleForUploaded(tx, publishRecordId)
  await tx.insert(thumbnailPackages).values(
    missing.map((key, index) => ({
      publishRecordId,
      position: first + index,
      source: 'uploaded' as const,
      state: 'ready' as const,
      title,
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
        previousPictureKey: thumbnailPackages.previousPictureKey,
        composedKey: thumbnailPackages.composedKey,
      })
    const orphanedKeys = deleted.flatMap((row) =>
      [row.pictureKey, row.previousPictureKey, row.composedKey].filter(
        (key): key is string => key !== null,
      ),
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
        title: await titleForUploaded(tx, publishRecordId),
        composedKey: key,
      })
      .returning()
    if (!row) throw new Error('The uploaded package could not be created')
    return row
  })
}

/** The package whose image is `keys[0]`: the first approved one with an image, in position order. */
async function firstGoingUp(tx: Tx, publishRecordId: string): Promise<ThumbnailPackageRow | null> {
  const rows = await listThumbnailPackages(tx, publishRecordId)
  return rows.find((row) => row.approvedAt !== null && row.composedKey !== null) ?? null
}

/**
 * Writes the approved packages' images to `uploaded_thumb_keys` in position
 * order. `metadata.title` is written (merged over the rest of the metadata,
 * never replacing it) only when the package that goes up CHANGED: the first
 * approved package with an image is not the one it was before (`beforeId`,
 * read under the same lock before the change), and its title is not blank.
 * Otherwise the owner's saved title, hand-edited or not, stays. `forceTitle`
 * is the explicit title edit of the package that is going up. Callers hold the
 * record's lock and have backfilled stored keys.
 */
async function writeApprovedToRecord(
  tx: Tx,
  publishRecordId: string,
  beforeId: string | null,
  forceTitle = false,
): Promise<{ keys: string[]; title: string | null }> {
  const approved = (await listThumbnailPackages(tx, publishRecordId)).filter(
    (row) => row.approvedAt !== null && row.composedKey !== null,
  )
  const keys = approved.flatMap((row) => (row.composedKey === null ? [] : [row.composedKey]))
  const first = approved[0]
  const changed = (first?.id ?? null) !== beforeId || forceTitle
  const title = changed && first?.title.trim() ? first.title : null
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
 * Re-derives `uploaded_thumb_keys` from the approved packages, for a caller
 * that changed the approved set in place. The title is written only when
 * `titleChanged` says the owner just edited the going-up package's title.
 */
export async function syncApprovedToRecord(
  db: Database,
  publishRecordId: string,
  options: { titleChanged?: boolean } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    await backfillStoredKeys(tx, publishRecordId)
    const before = await firstGoingUp(tx, publishRecordId)
    await writeApprovedToRecord(tx, publishRecordId, before?.id ?? null, options.titleChanged)
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
    const before = await firstGoingUp(tx, publishRecordId)
    const ordered = [chosen, ...rows.filter((row) => row.id !== packageId)]
    for (const [position, row] of ordered.entries()) {
      if (row.position !== position) {
        await tx.update(thumbnailPackages).set({ position }).where(eq(thumbnailPackages.id, row.id))
      }
    }
    if (chosen.approvedAt !== null) {
      await writeApprovedToRecord(tx, publishRecordId, before?.id ?? null)
    }
  })
}

/**
 * Approves every ready, composed package not yet approved, unless that would
 * leave more than three approved: then nothing changes and `over` says by how
 * many. The video's title follows only when the first approved package changes.
 */
export async function approvePackages(
  db: Database,
  publishRecordId: string,
): Promise<{ ok: true; keys: string[]; title: string | null } | { ok: false; over: number }> {
  return db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    await backfillStoredKeys(tx, publishRecordId)
    const before = await firstGoingUp(tx, publishRecordId)
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
    const written = await writeApprovedToRecord(tx, publishRecordId, before?.id ?? null)
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
    const before = await firstGoingUp(tx, found.publishRecordId)
    const [removed] = await tx
      .delete(thumbnailPackages)
      .where(eq(thumbnailPackages.id, id))
      .returning()
    if (!removed) return undefined
    if (removed.approvedAt !== null && removed.composedKey !== null) {
      await writeApprovedToRecord(tx, removed.publishRecordId, before?.id ?? null)
    }
    return {
      orphanedKeys: [removed.pictureKey, removed.previousPictureKey, removed.composedKey].filter(
        (key): key is string => key !== null,
      ),
    }
  })
}

/**
 * Lands a finished composite, the one write a compose makes. Under the record's
 * lock it re-reads the package and the record, so an approval that happened
 * while the browser worked is seen:
 * - the package is gone: nothing lands, the new object is for deletion;
 * - the package is approved and the video is already uploading or on YouTube:
 *   nothing changes (a late composite never alters what was uploaded), the
 *   new object is for deletion, and a `painting` row goes back to `ready`;
 * - otherwise the composite lands (`composedKey`, `warnings`, `ready`), and
 *   for an approved package its key replaces the old one in
 *   `uploaded_thumb_keys` at the same index.
 * `deleteKeys` are the objects to remove from storage afterwards: the old
 * composite only when the record no longer lists it.
 */
export async function landComposedThumbnail(
  db: Database,
  packageId: string,
  input: { composedKey: string; warnings: string[] },
): Promise<{ landed: boolean; deleteKeys: string[] }> {
  return db.transaction(async (tx) => {
    const found = await getThumbnailPackage(tx, packageId)
    if (!found) return { landed: false, deleteKeys: [input.composedKey] }
    await lockRecord(tx, found.publishRecordId)
    const row = await getThumbnailPackage(tx, packageId)
    if (!row) return { landed: false, deleteKeys: [input.composedKey] }
    const [record] = await tx
      .select({ status: publishRecords.status, keys: publishRecords.uploadedThumbKeys })
      .from(publishRecords)
      .where(eq(publishRecords.id, row.publishRecordId))
    if (!record) return { landed: false, deleteKeys: [input.composedKey] }

    const old = row.composedKey
    const sameObject = old === input.composedKey
    if (row.approvedAt !== null && record.status !== 'draft' && record.status !== 'failed') {
      if (row.state === 'painting' && old !== null) {
        await tx
          .update(thumbnailPackages)
          .set({ state: 'ready', error: null })
          .where(eq(thumbnailPackages.id, packageId))
      }
      return { landed: false, deleteKeys: sameObject ? [] : [input.composedKey] }
    }

    await tx
      .update(thumbnailPackages)
      .set({
        composedKey: input.composedKey,
        warnings: input.warnings,
        state: 'ready',
        error: null,
      })
      .where(eq(thumbnailPackages.id, packageId))
    let keys = record.keys
    if (row.approvedAt !== null && old !== null && !sameObject) {
      const index = keys.indexOf(old)
      if (index !== -1) {
        keys = [...keys]
        keys[index] = input.composedKey
        await tx
          .update(publishRecords)
          .set({ uploadedThumbKeys: keys })
          .where(eq(publishRecords.id, row.publishRecordId))
      }
    }
    return {
      landed: true,
      deleteKeys: old !== null && !sameObject && !keys.includes(old) ? [old] : [],
    }
  })
}

/**
 * Lands a newly painted picture. Under a lock on the package row, the picture
 * it replaces becomes `previousPictureKey` and the state goes to `painting`
 * (the composite follows). The same key rotates nothing. `deleteKeys` are the
 * objects to remove from storage afterwards: the old previous picture when
 * neither key of the row names it now, or the new object when the package is gone.
 *
 * `depicts` is who the new picture shows. The row's `depicts` describes the
 * stored picture, so it changes here and nowhere earlier, and the people of the
 * picture it replaces go to `previousDepicts` with that picture. Left out, the
 * new picture shows who the old one did.
 */
export async function landPaintedPicture(
  db: Database,
  packageId: string,
  pictureKey: string,
  options: { depicts?: string[] } = {},
): Promise<{ landed: boolean; deleteKeys: string[] }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(thumbnailPackages)
      .where(eq(thumbnailPackages.id, packageId))
      .for('update')
    if (!row) return { landed: false, deleteKeys: [pictureKey] }
    const depicts = options.depicts ?? row.depicts

    if (row.pictureKey === pictureKey) {
      await tx
        .update(thumbnailPackages)
        .set({ state: 'painting', error: null, depicts })
        .where(eq(thumbnailPackages.id, packageId))
      return { landed: true, deleteKeys: [] }
    }

    await tx
      .update(thumbnailPackages)
      .set({
        pictureKey,
        previousPictureKey: row.pictureKey,
        depicts,
        // A first picture replaces none, so there are no people to keep.
        previousDepicts: row.pictureKey === null ? [] : row.depicts,
        state: 'painting',
        error: null,
      })
      .where(eq(thumbnailPackages.id, packageId))
    const older = row.previousPictureKey
    const stillNamed = older === pictureKey || older === row.pictureKey
    return { landed: true, deleteKeys: older !== null && !stillNamed ? [older] : [] }
  })
}

/**
 * Swaps the picture and the previous picture, and the people each shows, in one
 * statement (Postgres reads every `SET` expression from the old row). Undefined
 * when there is no previous picture, or no such package.
 */
export async function swapThumbnailPictures(
  db: Executor,
  packageId: string,
  patch: Pick<ThumbnailPackagePatch, 'state' | 'error'> = {},
): Promise<ThumbnailPackageRow | undefined> {
  const [row] = await db
    .update(thumbnailPackages)
    .set({
      pictureKey: thumbnailPackages.previousPictureKey,
      previousPictureKey: thumbnailPackages.pictureKey,
      depicts: thumbnailPackages.previousDepicts,
      previousDepicts: thumbnailPackages.depicts,
      ...patch,
    })
    .where(
      and(eq(thumbnailPackages.id, packageId), isNotNull(thumbnailPackages.previousPictureKey)),
    )
    .returning()
  return row
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
 * What a finished Test & Compare wrote, all in one transaction: each given
 * package's result, its watch time share (null when none was given) and the
 * record's end stamp. The caller decides the results; this only writes.
 */
export async function recordTestOutcome(
  db: Database,
  publishRecordId: string,
  input: {
    results: Record<string, TestResult>
    shares: Record<string, number | null>
    endedAt: Date
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockRecord(tx, publishRecordId)
    for (const [id, result] of Object.entries(input.results)) {
      await tx
        .update(thumbnailPackages)
        .set({ result, watchTimeShare: input.shares[id] ?? null })
        .where(
          and(eq(thumbnailPackages.id, id), eq(thumbnailPackages.publishRecordId, publishRecordId)),
        )
    }
    await tx
      .update(publishRecords)
      .set({ testEndedAt: input.endedAt, updatedAt: new Date() })
      .where(eq(publishRecords.id, publishRecordId))
  })
}

/**
 * Every approved package of the channel's masters that carries a recorded
 * result. A record whose video was later unlinked keeps its results, so this
 * does not look at `test_ended_at`.
 */
async function recordedResults(
  db: Executor,
  channelId: string,
): Promise<{ recordId: string; idea: ThumbnailIdea | null; result: TestResult }[]> {
  const rows = await db
    .select({
      recordId: thumbnailPackages.publishRecordId,
      idea: thumbnailPackages.idea,
      result: thumbnailPackages.result,
    })
    .from(thumbnailPackages)
    .innerJoin(publishRecords, eq(publishRecords.id, thumbnailPackages.publishRecordId))
    .where(
      and(
        eq(publishRecords.channelId, channelId),
        eq(publishRecords.targetType, 'master'),
        isNotNull(thumbnailPackages.approvedAt),
        isNotNull(thumbnailPackages.result),
      ),
    )
  return rows.flatMap((row) =>
    row.result === null ? [] : [{ recordId: row.recordId, idea: row.idea, result: row.result }],
  )
}

/**
 * Per idea, in the order of `THUMBNAIL_IDEAS`: the videos in which a package
 * of that idea took part in a recorded test (`tests`) and those in which one
 * won (`wins`). A video counts once per idea however many of its packages
 * share it; a package with no idea counts for none.
 */
export async function ideaResults(
  db: Executor,
  channelId: string,
): Promise<{ idea: ThumbnailIdea; tests: number; wins: number }[]> {
  const tested = new Map<ThumbnailIdea, Set<string>>()
  const won = new Map<ThumbnailIdea, Set<string>>()
  const note = (map: Map<ThumbnailIdea, Set<string>>, idea: ThumbnailIdea, recordId: string) => {
    const records = map.get(idea) ?? new Set<string>()
    records.add(recordId)
    map.set(idea, records)
  }
  for (const row of await recordedResults(db, channelId)) {
    if (row.idea === null) continue
    note(tested, row.idea, row.recordId)
    if (row.result === 'won') note(won, row.idea, row.recordId)
  }
  return THUMBNAIL_IDEAS.map((idea) => ({
    idea,
    tests: tested.get(idea)?.size ?? 0,
    wins: won.get(idea)?.size ?? 0,
  }))
}

/**
 * The channel's videos with recorded results, each counted once: with a
 * winner when any approved package won, else the same, else inconclusive.
 */
export async function finishedTests(
  db: Executor,
  channelId: string,
): Promise<{ withWinner: number; same: number; inconclusive: number }> {
  const byRecord = new Map<string, Set<TestResult>>()
  for (const row of await recordedResults(db, channelId)) {
    const seen = byRecord.get(row.recordId) ?? new Set<TestResult>()
    seen.add(row.result)
    byRecord.set(row.recordId, seen)
  }
  const totals = { withWinner: 0, same: 0, inconclusive: 0 }
  for (const results of byRecord.values()) {
    if (results.has('won')) totals.withWinner += 1
    else if (results.has('same')) totals.same += 1
    else totals.inconclusive += 1
  }
  return totals
}

/** A video older than this is not reminded about: its first days, when a test is worth running, are gone. */
export const TEST_REMINDER_MAX_AGE_DAYS = 14

/**
 * Live masters whose test is ready to start: a video on YouTube that went out
 * within `TEST_REMINDER_MAX_AGE_DAYS` (by its publish time, else its upload
 * start; a record with neither counts as recent), two or more approved
 * packages to compare, no test already marked started and no reminder sent yet.
 */
export async function recordsAwaitingTestReminder(
  db: Executor,
  channelId: string,
): Promise<{ id: string; targetId: string; youtubeVideoId: string }[]> {
  const cutoff = new Date(Date.now() - TEST_REMINDER_MAX_AGE_DAYS * 24 * 60 * 60_000)
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
        isNull(publishRecords.testStartedAt),
        isNotNull(publishRecords.youtubeVideoId),
        or(
          and(isNull(publishRecords.publishAt), isNull(publishRecords.uploadStartedAt)),
          gte(
            sql`coalesce(${publishRecords.publishAt}, ${publishRecords.uploadStartedAt})`,
            cutoff.toISOString(),
          ),
        ),
        sql`(select count(*) from ${thumbnailPackages} where ${thumbnailPackages.publishRecordId} = ${publishRecords.id} and ${thumbnailPackages.approvedAt} is not null) >= 2`,
      ),
    )
  return rows.flatMap((row) =>
    row.youtubeVideoId === null
      ? []
      : [{ id: row.id, targetId: row.targetId, youtubeVideoId: row.youtubeVideoId }],
  )
}
