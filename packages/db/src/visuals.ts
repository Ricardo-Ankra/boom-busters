import { and, asc, eq, sql } from 'drizzle-orm'
import type { ShotBrief, ShotSlotStatus, ShotSlotType, SlotCandidate } from '@boom-busters/schemas'
import type { Database } from './client'
import { assets, chapters, shotSlots } from './schema'
import type { AssetRow, ShotSlotRow } from './schema'

/**
 * Shot-slot and asset queries (build spec sections 5 and 7.4).
 *
 * Two rules this module holds:
 *
 * **The board is replaced, never patched, by a re-run.** A shot list is one
 * coherent plan over one script; `replaceShotList` swaps the whole board in a
 * transaction so a failed re-run can never leave half of yesterday's plan
 * interleaved with half of today's.
 *
 * **Which candidate is chosen lives in the candidates jsonb.** A chosen stock
 * candidate has no bytes in our storage yet — media never streams through the
 * app layer, so stock is materialised by the render side in M6 — and
 * `chosenAssetId` therefore points at an `assets` row only when the choice
 * already holds bytes (generated stills, uploads). One writer,
 * `chooseSlotCandidate`, keeps the flag, the status and the asset pointer in
 * step.
 */

export interface NewShotSlot {
  chapterId: string
  index: number
  type: ShotSlotType
  brief: ShotBrief
  startMs: number
  durationMs: number
}

/** A slot with the chapter facts every screen needs alongside it. */
export interface ShotSlotWithChapter extends ShotSlotRow {
  chapterIndex: number
  chapterTitle: string
}

export async function replaceShotList(
  db: Database,
  projectId: string,
  slots: readonly NewShotSlot[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(shotSlots).where(eq(shotSlots.projectId, projectId))
    if (slots.length === 0) return
    await tx.insert(shotSlots).values(
      slots.map((slot) => ({
        projectId,
        chapterId: slot.chapterId,
        index: slot.index,
        type: slot.type,
        brief: slot.brief as unknown as Record<string, unknown>,
        startMs: slot.startMs,
        durationMs: slot.durationMs,
      })),
    )
  })
}

/** The whole board, in script order. */
export async function listShotSlots(
  db: Database,
  projectId: string,
): Promise<ShotSlotWithChapter[]> {
  const rows = await db
    .select({
      slot: shotSlots,
      chapterIndex: chapters.index,
      chapterTitle: chapters.title,
    })
    .from(shotSlots)
    .innerJoin(chapters, eq(shotSlots.chapterId, chapters.id))
    .where(eq(shotSlots.projectId, projectId))
    .orderBy(asc(chapters.index), asc(shotSlots.index))

  return rows.map((row) => ({
    ...row.slot,
    chapterIndex: row.chapterIndex,
    chapterTitle: row.chapterTitle,
  }))
}

export async function getShotSlot(db: Database, id: string): Promise<ShotSlotRow | undefined> {
  const [row] = await db.select().from(shotSlots).where(eq(shotSlots.id, id)).limit(1)
  return row
}

/**
 * A brief edit re-opens the slot: whatever was fetched was fetched for the
 * OLD brief, so the status drops back to `unresolved` until a re-fetch
 * resolves it again. The stale candidates stay visible in the meantime —
 * a board that blanks while re-fetching reads as data loss.
 */
export async function updateSlotBrief(
  db: Database,
  slotId: string,
  brief: ShotBrief,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      brief: brief as unknown as Record<string, unknown>,
      status: 'unresolved',
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}

/**
 * What a resolution pass concluded for one slot — candidates (already scored
 * and ordered), the status that follows, and the chosen asset when the top
 * candidate already holds bytes.
 */
export async function setSlotResolution(
  db: Database,
  slotId: string,
  outcome: {
    candidates: readonly SlotCandidate[]
    status: ShotSlotStatus
    chosenAssetId?: string | null
  },
): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      candidates: outcome.candidates as unknown as Record<string, unknown>[],
      status: outcome.status,
      chosenAssetId: outcome.chosenAssetId ?? null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}

/**
 * The human swaps the choice on the board. One statement over the jsonb:
 * the named candidate gains `chosen`, every other loses it, and the slot is
 * resolved. `chosenAssetId` follows the candidate's `assetId` when it has
 * one and clears when it does not.
 */
export async function chooseSlotCandidate(
  db: Database,
  slotId: string,
  candidateId: string,
): Promise<ShotSlotRow | undefined> {
  const slot = await getShotSlot(db, slotId)
  if (!slot) return undefined

  const candidates = slot.candidates as unknown as SlotCandidate[]
  if (!candidates.some((candidate) => candidate.id === candidateId)) return undefined

  const updated = candidates.map((candidate) => {
    const { chosen: _chosen, ...rest } = candidate
    return candidate.id === candidateId ? { ...rest, chosen: true } : rest
  })
  const chosenAssetId =
    candidates.find((candidate) => candidate.id === candidateId)?.assetId ?? null

  const [row] = await db
    .update(shotSlots)
    .set({
      candidates: updated as unknown as Record<string, unknown>[],
      status: 'resolved',
      chosenAssetId,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
    .returning()

  return row
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface UpsertAssetInput {
  kind: 'image' | 'video'
  r2Key: string
  sourceUrl?: string
  licence: string
  contentHash: string
  width?: number
  height?: number
  durationMs?: number
  attributionText?: string
}

/**
 * Insert an asset, or hand back the one already holding these bytes.
 * `contentHash` is the dedupe key (spec section 5): the same generated frame
 * stored twice would be two R2 objects claiming to be the source of truth.
 */
export async function upsertAssetByHash(db: Database, input: UpsertAssetInput): Promise<AssetRow> {
  const [row] = await db
    .insert(assets)
    .values({
      kind: input.kind,
      r2Key: input.r2Key,
      sourceUrl: input.sourceUrl ?? null,
      licence: input.licence,
      contentHash: input.contentHash,
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: input.durationMs ?? null,
      attributionText: input.attributionText ?? null,
    })
    .onConflictDoUpdate({
      target: assets.contentHash,
      // The bytes are identical by definition; the metadata may have improved.
      set: {
        licence: input.licence,
        attributionText: input.attributionText ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning()

  return row!
}

export async function getAsset(db: Database, id: string): Promise<AssetRow | undefined> {
  const [row] = await db.select().from(assets).where(eq(assets.id, id)).limit(1)
  return row
}

/** The counts behind the gate card, without loading every brief. */
export async function shotSlotStatuses(
  db: Database,
  projectId: string,
): Promise<{ status: ShotSlotStatus }[]> {
  return db
    .select({ status: shotSlots.status })
    .from(shotSlots)
    .where(eq(shotSlots.projectId, projectId))
}

/** Slots a resolution pass still owes work — unresolved only, board order. */
export async function unresolvedSlots(db: Database, projectId: string): Promise<ShotSlotRow[]> {
  return db
    .select()
    .from(shotSlots)
    .where(and(eq(shotSlots.projectId, projectId), eq(shotSlots.status, 'unresolved')))
    .orderBy(asc(shotSlots.chapterId), asc(shotSlots.index))
}
