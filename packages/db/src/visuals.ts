import { createHash } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import type {
  ShotBrief,
  ShotSlotStatus,
  ShotSlotType,
  SlotCandidate,
  SlotRefusal,
  SlotDraftState,
  StillRoute,
} from '@boom-busters/schemas'
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

/**
 * The no-waste guard's fingerprint (staged-visuals design 2026-08-26), over
 * the brief AND the route it generates on (decision 264).
 *
 * The route is in here because changing the model is a reason to re-buy a
 * shot, and it is the only such reason that does not touch the brief. Left
 * out, the owner picks a different model on the board, presses Fetch
 * visuals, and the pass skips the slot as already resolved.
 *
 * A slot with no route hashes exactly as it did before this existed, so
 * every stamp already in the database stays valid and no live board
 * suddenly owes work for every slot it holds.
 */
export function shotBriefHash(brief: unknown, route?: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(route ? { brief, route } : brief))
    .digest('hex')
}

/**
 * Whether a fetch pass owes this slot work: not resolved, or resolved for an
 * older brief or route. A linked slot (decision 261) shows another slot's
 * shot and is never owed one, whatever its status or hash say.
 */
export function slotNeedsResolution(slot: {
  status: ShotSlotStatus
  brief: unknown
  resolvedBriefHash: string | null
  reuseOfSlotId?: string | null | undefined
  route?: unknown
}): boolean {
  if (slot.reuseOfSlotId) return false
  return (
    slot.status !== 'resolved' || slot.resolvedBriefHash !== shotBriefHash(slot.brief, slot.route)
  )
}

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
 * resolves it again. The stale candidates stay visible in the meantime (a
 * board that blanks while re-fetching reads as data loss). A linked slot
 * keeps its status (decision 261): the words changed, the picture is another
 * slot's and did not.
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
      status: sql`CASE WHEN ${shotSlots.reuseOfSlotId} IS NULL THEN 'unresolved' ELSE ${shotSlots.status} END`,
      // A new brief is a new question; an old refusal no longer applies.
      refusal: null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}

/**
 * Set or clear the route one slot generates on (decision 264). It does not
 * touch status: the hash covers the route, so the next pass sees that the
 * slot owes work without anything else being written.
 */
export async function setSlotRoute(
  db: Database,
  slotId: string,
  route: StillRoute | null,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({ route: route as Record<string, unknown> | null, updatedAt: new Date() })
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
  /**
   * The stamp is derived here rather than taken from the caller (decision
   * 264), because it now has to cover the route as well as the brief and a
   * caller would have to re-read the row to know it.
   *
   * Deriving it also closed two leaks. `slot-refetcher` and `stock-ingest`
   * passed no hash at all, so the first left a slot it had just paid for
   * still owing work, and the second wiped the stamp the fan-out had
   * written; in both cases the next Fetch pass re-bought what was already
   * bought. A caller cannot forget an argument that no longer exists.
   *
   * The cost is a narrow race: if the brief is edited between the resolver
   * reading it and this write, the stamp names the new brief while the
   * candidates answer the old one. The slot then looks resolved until
   * someone regenerates it. A stale picture the owner can see beats a
   * silent re-purchase of every slot on every pass.
   */
  const slot = await getShotSlot(db, slotId)
  const resolvedBriefHash =
    outcome.status === 'resolved' && slot ? shotBriefHash(slot.brief, slot.route) : null
  await db
    .update(shotSlots)
    .set({
      candidates: outcome.candidates as unknown as Record<string, unknown>[],
      status: outcome.status,
      chosenAssetId: outcome.chosenAssetId ?? null,
      resolvedBriefHash,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}

/**
 * Re-type a slot (staged-visuals design): the type column and the brief move
 * together, the old type's candidates clear — they were fetched for a
 * different kind of shot — and the slot returns to `unresolved` with no
 * resolution fingerprint, so the next fetch pass owes it work.
 */
export async function retypeShotSlot(
  db: Database,
  slotId: string,
  type: ShotSlotType,
  brief: ShotBrief,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      type,
      brief: brief as unknown as Record<string, unknown>,
      candidates: [] as unknown as Record<string, unknown>[],
      status: 'unresolved',
      chosenAssetId: null,
      resolvedBriefHash: null,
      // Whatever re-type was pending, this write is its answer.
      retype: null,
      refusal: null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}

/**
 * Stamp or clear an image model's refusal (decision 252). Written by the
 * resolvers when a generator declines the prompt; cleared by any brief write
 * (`updateSlotBrief`, `retypeShotSlot`), because the refusal was of a prompt
 * that no longer exists.
 */
export async function setSlotRefusal(
  db: Database,
  slotId: string,
  refusal: SlotRefusal | null,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      refusal: refusal as unknown as Record<string, unknown> | null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
}

/**
 * Stamp or clear a model-assisted re-type's visible state. `drafting` goes on
 * when the button sends the event; the slot-retyper replaces it with the
 * outcome — cleared by `retypeShotSlot` on success, `refused` (with the
 * model's reason) when the conversion cannot honestly happen.
 */
export async function setSlotRetype(
  db: Database,
  slotId: string,
  state: SlotDraftState | null,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      retype: state as unknown as Record<string, unknown> | null,
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
// Reusing a shot (decision 261)
// ---------------------------------------------------------------------------

/**
 * The copy a dependant holds: the source's candidate, chosen, stamped with
 * where it came from and who it depicts. Its id is kept, so the strip and the
 * lightbox treat it like any other candidate; its score is dropped, because
 * it was judged against the source's brief, not this one's.
 */
function reusedCandidate(source: ShotSlotRow, candidate: SlotCandidate): SlotCandidate {
  const brief = source.brief as { type?: string; depicts?: string[] }
  const depicts =
    (brief.type === 'still' || brief.type === 'hero') && brief.depicts && brief.depicts.length > 0
      ? brief.depicts
      : undefined
  const { chosen: _chosen, score: _score, scoreReason: _reason, ...rest } = candidate
  return {
    ...rest,
    chosen: true,
    reusedFrom: { slotId: source.id, ...(depicts ? { depicts } : {}) },
  }
}

export interface LinkOutcome {
  copied: boolean
}

/**
 * Point a slot at another slot's shot. When `candidateId` names a candidate
 * the source holds, it is copied now and the slot is resolved for its own
 * brief; otherwise the link alone is recorded and `copyReusedShots` fills it
 * after the fetch pass. Callers check the rules (types, chains, same project)
 * first; this only writes. Null when the slot, the source or the named
 * candidate no longer exists.
 */
export async function linkSlotReuse(
  db: Database,
  slotId: string,
  sourceId: string,
  candidateId?: string,
): Promise<LinkOutcome | null> {
  const [slot, source] = await Promise.all([getShotSlot(db, slotId), getShotSlot(db, sourceId)])
  if (!slot || !source) return null
  const held = source.candidates as unknown as SlotCandidate[]
  const picked =
    candidateId === undefined ? undefined : held.find((candidate) => candidate.id === candidateId)
  if (candidateId !== undefined && !picked) return null

  await db
    .update(shotSlots)
    .set({
      reuseOfSlotId: sourceId,
      ...(picked
        ? {
            candidates: [reusedCandidate(source, picked)] as unknown as Record<string, unknown>[],
            status: 'resolved' as const,
            chosenAssetId: picked.assetId ?? null,
            resolvedBriefHash: shotBriefHash(slot.brief, slot.route),
          }
        : {
            candidates: [] as unknown as Record<string, unknown>[],
            status: 'unresolved' as const,
            chosenAssetId: null,
            resolvedBriefHash: null,
          }),
      refusal: null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))

  return { copied: picked !== undefined }
}

/**
 * After the fetch pass: every linked slot that holds no copy yet takes its
 * source's chosen candidate, or becomes a placeholder when the source has
 * none. Idempotent: a dependant already copied from its source is left
 * alone, so a re-run of the pass never overwrites a choice made since.
 *
 * Passes repeat while a fill makes another possible: the action layer
 * refuses chains, but the write must be right whatever order rows arrive
 * in, so a dependant whose source was itself filled this pass is filled on
 * the next. Only when a pass copies nothing do the unfilled rows become
 * placeholders.
 */
export async function copyReusedShots(
  db: Database,
  projectId: string,
): Promise<{ copied: number; placeholders: number }> {
  let copied = 0
  let placeholders = 0

  for (;;) {
    const rows = await db.select().from(shotSlots).where(eq(shotSlots.projectId, projectId))
    const byId = new Map(rows.map((row) => [row.id, row]))
    const pending = rows.filter((row) => {
      if (!row.reuseOfSlotId) return false
      const held = row.candidates as unknown as SlotCandidate[]
      return !held.some((candidate) => candidate.reusedFrom?.slotId === row.reuseOfSlotId)
    })
    if (pending.length === 0) break

    let filled = 0
    for (const row of pending) {
      const source = byId.get(row.reuseOfSlotId!)
      const chosen = source
        ? (source.candidates as unknown as SlotCandidate[]).find((candidate) => candidate.chosen)
        : undefined
      if (!source || !chosen) continue
      await db
        .update(shotSlots)
        .set({
          candidates: [reusedCandidate(source, chosen)] as unknown as Record<string, unknown>[],
          status: 'resolved',
          chosenAssetId: chosen.assetId ?? null,
          resolvedBriefHash: shotBriefHash(row.brief, row.route),
          updatedAt: sql`now()`,
        })
        .where(eq(shotSlots.id, row.id))
      copied += 1
      filled += 1
    }

    if (filled === 0) {
      for (const row of pending) {
        await db
          .update(shotSlots)
          .set({
            candidates: [] as unknown as Record<string, unknown>[],
            status: 'placeholder',
            chosenAssetId: null,
            resolvedBriefHash: null,
            updatedAt: sql`now()`,
          })
          .where(eq(shotSlots.id, row.id))
        placeholders += 1
      }
      break
    }
  }

  return { copied, placeholders }
}

/** The slots that show this slot's shot (decision 261): its dependants, in any order. */
export async function listSlotDependants(db: Database, slotId: string): Promise<ShotSlotRow[]> {
  return db.select().from(shotSlots).where(eq(shotSlots.reuseOfSlotId, slotId))
}

/**
 * Give a linked slot its own shot again: the link, the copy, the chosen
 * asset and the fingerprint all go, and the next fetch pass owes it work.
 */
export async function unlinkSlotReuse(db: Database, slotId: string): Promise<void> {
  await db
    .update(shotSlots)
    .set({
      reuseOfSlotId: null,
      candidates: [] as unknown as Record<string, unknown>[],
      status: 'unresolved',
      chosenAssetId: null,
      resolvedBriefHash: null,
      updatedAt: sql`now()`,
    })
    .where(eq(shotSlots.id, slotId))
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
