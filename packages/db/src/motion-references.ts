import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { REFERENCE_PACK_MAX, ValidationError } from '@boom-busters/schemas'
import type { ReferenceFrames, ReferencePurpose, ReferenceReading } from '@boom-busters/schemas'
import type { Database } from './client'
import { assets, motionReferences } from './schema'
import type { AssetRow, MotionReferenceRow, ReferenceReadState } from './schema'

/**
 * The reference pack's queries (spec 2026-11-04, section 7.1). A reference's
 * bytes are an `assets` row of kind image or video that belongs to the
 * channel, deduped on content hash per channel as a logo is; the reference
 * row holds what the owner wrote and marked, the frames, the reading and the
 * sheets. Live rows are ordered by `position`; archiving keeps everything.
 */

const REFERENCE_LICENCE = 'Uploaded by owner, reference only'

/**
 * The channel's copy of an uploaded still or clip. The same bytes uploaded
 * twice refresh the title and the measurements rather than storing a second
 * row; the conflict target is the per-channel partial index, as `insertLogo`.
 * Only a row that is itself a still or a clip is updated: the same bytes as
 * one of the channel's marks come back null and nothing is touched, so a
 * reference can never rename a logo or point at its row (final review, issue 3).
 */
export async function upsertChannelAsset(
  db: Database,
  channelId: string,
  input: {
    kind: 'image' | 'video'
    r2Key: string
    contentHash: string
    width: number
    height: number
    durationMs?: number | null
    title: string
  },
): Promise<AssetRow | null> {
  const title = input.title.trim()
  const [row] = await db
    .insert(assets)
    .values({
      channelId,
      kind: input.kind,
      r2Key: input.r2Key,
      contentHash: input.contentHash,
      title,
      licence: REFERENCE_LICENCE,
      width: input.width,
      height: input.height,
      durationMs: input.durationMs ?? null,
    })
    .onConflictDoUpdate({
      target: [assets.contentHash, assets.channelId],
      targetWhere: sql`channel_id is not null`,
      set: {
        title,
        width: input.width,
        height: input.height,
        durationMs: input.durationMs ?? null,
        updatedAt: new Date(),
      },
      setWhere: inArray(assets.kind, ['image', 'video']),
    })
    .returning()
  return row ?? null
}

/** How many references, archived ones included, hold this asset: its bytes are theirs too. */
export async function referencesUsingAsset(db: Database, assetId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(motionReferences)
    .where(eq(motionReferences.assetId, assetId))
  return row?.count ?? 0
}

/** The live pack, in order. */
export async function listMotionReferences(
  db: Database,
  channelId: string,
): Promise<MotionReferenceRow[]> {
  return db
    .select()
    .from(motionReferences)
    .where(and(eq(motionReferences.channelId, channelId), isNull(motionReferences.archivedAt)))
    .orderBy(asc(motionReferences.position))
}

export async function motionReferenceById(
  db: Database,
  id: string,
): Promise<MotionReferenceRow | null> {
  const [row] = await db.select().from(motionReferences).where(eq(motionReferences.id, id)).limit(1)
  return row ?? null
}

/**
 * A new reference at the end of the pack. Refused at twelve live rows: the
 * guideline says more dilutes, and the derivation weighs every reference.
 */
export async function insertMotionReference(
  db: Database,
  channelId: string,
  input: {
    assetId: string
    kind: 'image' | 'video'
    title: string
    sourceUrl: string | null
    rights: string
    purpose: ReferencePurpose
    negative: boolean
    windowStartMs: number | null
    windowEndMs: number | null
    carryOver: string
    avoid: string
    frames: ReferenceFrames
  },
): Promise<MotionReferenceRow> {
  return db.transaction(async (tx) => {
    const [stats] = await tx
      .select({
        live: sql<number>`count(*)::int`,
        top: sql<number>`coalesce(max(${motionReferences.position}), 0)::int`,
      })
      .from(motionReferences)
      .where(and(eq(motionReferences.channelId, channelId), isNull(motionReferences.archivedAt)))
    if ((stats?.live ?? 0) >= REFERENCE_PACK_MAX) {
      throw new ValidationError(
        'This channel already holds twelve references. Archive one first.',
        { field: 'references' },
      )
    }
    const [row] = await tx
      .insert(motionReferences)
      .values({ channelId, ...input, position: (stats?.top ?? 0) + 1 })
      .returning()
    if (!row) throw new Error('The reference row was not written')
    return row
  })
}

/** The text fields the owner edits on the card. */
export async function updateMotionReference(
  db: Database,
  id: string,
  patch: Partial<
    Pick<
      MotionReferenceRow,
      'title' | 'sourceUrl' | 'rights' | 'purpose' | 'negative' | 'carryOver' | 'avoid'
    >
  >,
): Promise<MotionReferenceRow | null> {
  const [row] = await db
    .update(motionReferences)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(motionReferences.id, id))
    .returning()
  return row ?? null
}

/**
 * A new window and its frames. The reading and the sheets were of the old
 * window, so they go with it; the card reads "unread" until the next read.
 */
export async function remarkMotionReference(
  db: Database,
  id: string,
  input: { windowStartMs: number; windowEndMs: number; frames: ReferenceFrames },
): Promise<MotionReferenceRow | null> {
  const [row] = await db
    .update(motionReferences)
    .set({
      ...input,
      reading: null,
      contactSheetKey: null,
      denseSheetKey: null,
      readState: 'unread',
      readError: null,
      updatedAt: new Date(),
    })
    .where(eq(motionReferences.id, id))
    .returning()
  return row ?? null
}

export async function setReferenceReadState(
  db: Database,
  id: string,
  state: ReferenceReadState,
  error: string | null = null,
  /** When the state was set; the actions read a stale "reading" from it. */
  at: Date = new Date(),
): Promise<MotionReferenceRow | null> {
  const [row] = await db
    .update(motionReferences)
    .set({ readState: state, readError: error, updatedAt: at })
    .where(eq(motionReferences.id, id))
    .returning()
  return row ?? null
}

export async function setReferenceSheets(
  db: Database,
  id: string,
  keys: { contactSheetKey: string | null; denseSheetKey: string | null },
): Promise<MotionReferenceRow | null> {
  const [row] = await db
    .update(motionReferences)
    .set({ ...keys, updatedAt: new Date() })
    .where(eq(motionReferences.id, id))
    .returning()
  return row ?? null
}

/** The reading, from the model or the owner's edit; the state is read either way. */
export async function setReferenceReading(
  db: Database,
  id: string,
  reading: ReferenceReading,
): Promise<MotionReferenceRow | null> {
  const [row] = await db
    .update(motionReferences)
    .set({ reading, readState: 'read', readError: null, updatedAt: new Date() })
    .where(eq(motionReferences.id, id))
    .returning()
  return row ?? null
}

/** Archiving keeps the row and its files; a derivation ignores archived references. */
export async function archiveMotionReference(
  db: Database,
  id: string,
): Promise<MotionReferenceRow | null> {
  const [row] = await db
    .update(motionReferences)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(motionReferences.id, id), isNull(motionReferences.archivedAt)))
    .returning()
  return row ?? null
}
