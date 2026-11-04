import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { ValidationError } from '@boom-busters/schemas'
import type { ExemplarPlan, ExemplarStatus, GraphicCode, Technique } from '@boom-busters/schemas'
import type { Database } from './client'
import { channelExemplars, motionReferences } from './schema'
import type { ChannelExemplarRow } from './schema'

/**
 * A channel's exemplar versions (spec 2026-11-04, sections 9.2 to 9.4):
 * numbered per technique from one, one approved at a time, a draft the
 * loop edits and an approved version nothing edits. Approving retires the
 * version approved before it; a retired version is restored by approving
 * it again. Copy forks another channel's pack and approved versions.
 */

const toUsd = (value: number | null | undefined) =>
  value === null || value === undefined ? null : value.toFixed(4)

export async function insertExemplarVersion(
  db: Database,
  input: {
    channelId: string
    technique: Technique
    plan: ExemplarPlan
    code: GraphicCode
    parentId?: string | null
    steer?: string | null
    derivationId?: string | null
    copiedFrom?: string | null
    status?: ExemplarStatus
  },
): Promise<ChannelExemplarRow> {
  return db.transaction(async (tx) => {
    const [top] = await tx
      .select({ version: sql<number>`coalesce(max(${channelExemplars.version}), 0)::int` })
      .from(channelExemplars)
      .where(
        and(
          eq(channelExemplars.channelId, input.channelId),
          eq(channelExemplars.technique, input.technique),
        ),
      )
    const [row] = await tx
      .insert(channelExemplars)
      .values({
        channelId: input.channelId,
        technique: input.technique,
        version: (top?.version ?? 0) + 1,
        plan: input.plan,
        code: input.code,
        parentId: input.parentId ?? null,
        steer: input.steer ?? null,
        derivationId: input.derivationId ?? null,
        copiedFrom: input.copiedFrom ?? null,
        status: input.status ?? 'draft',
        ...(input.status === 'approved' ? { approvedAt: new Date() } : {}),
      })
      .returning()
    if (!row) throw new Error('The exemplar version was not written')
    return row
  })
}

/** What the loop writes onto a draft; an approved or retired version is never edited (spec 3). */
export async function updateExemplarDraft(
  db: Database,
  id: string,
  patch: Partial<
    Pick<ChannelExemplarRow, 'code' | 'critique' | 'verify' | 'pairwise' | 'metrics' | 'frames'>
  > & { costUsd?: number | null },
): Promise<ChannelExemplarRow> {
  const current = await exemplarVersionById(db, id)
  if (!current) throw new ValidationError('That version is gone', { field: 'version' })
  if (current.status !== 'draft') {
    throw new ValidationError('An approved version is never edited', { field: 'version' })
  }
  const { costUsd, ...rest } = patch
  const [row] = await db
    .update(channelExemplars)
    .set({
      ...rest,
      ...(costUsd !== undefined ? { costUsd: toUsd(costUsd) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(channelExemplars.id, id))
    .returning()
  if (!row) throw new Error('The exemplar version was not updated')
  return row
}

export async function exemplarVersionById(
  db: Database,
  id: string,
): Promise<ChannelExemplarRow | null> {
  const [row] = await db.select().from(channelExemplars).where(eq(channelExemplars.id, id)).limit(1)
  return row ?? null
}

/** Every version the channel holds, technique by name then newest first. */
export async function listChannelExemplars(
  db: Database,
  channelId: string,
): Promise<ChannelExemplarRow[]> {
  return db
    .select()
    .from(channelExemplars)
    .where(eq(channelExemplars.channelId, channelId))
    .orderBy(asc(channelExemplars.technique), desc(channelExemplars.version))
}

export async function approvedExemplar(
  db: Database,
  channelId: string,
  technique: Technique,
): Promise<ChannelExemplarRow | null> {
  const [row] = await db
    .select()
    .from(channelExemplars)
    .where(
      and(
        eq(channelExemplars.channelId, channelId),
        eq(channelExemplars.technique, technique),
        eq(channelExemplars.status, 'approved'),
      ),
    )
    .limit(1)
  return row ?? null
}

/**
 * The version becomes approved and the channel's approved version of the
 * same technique, when another, retires. A draft or a retired version may
 * be approved; the one approved now is a no-op.
 */
export async function approveExemplarVersion(
  db: Database,
  id: string,
): Promise<{ approved: ChannelExemplarRow; retired: ChannelExemplarRow | null }> {
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(channelExemplars)
      .where(eq(channelExemplars.id, id))
      .limit(1)
    if (!target) throw new ValidationError('That version is gone', { field: 'version' })
    if (target.status === 'approved') return { approved: target, retired: null }
    const [retired] = await tx
      .update(channelExemplars)
      .set({ status: 'retired', updatedAt: new Date() })
      .where(
        and(
          eq(channelExemplars.channelId, target.channelId),
          eq(channelExemplars.technique, target.technique),
          eq(channelExemplars.status, 'approved'),
        ),
      )
      .returning()
    const [approved] = await tx
      .update(channelExemplars)
      .set({ status: 'approved', approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(channelExemplars.id, id))
      .returning()
    if (!approved) throw new Error('The exemplar version was not approved')
    return { approved, retired: retired ?? null }
  })
}

export async function retireExemplarVersion(db: Database, id: string): Promise<ChannelExemplarRow> {
  const [row] = await db
    .update(channelExemplars)
    .set({ status: 'retired', updatedAt: new Date() })
    .where(eq(channelExemplars.id, id))
    .returning()
  if (!row) throw new ValidationError('That version is gone', { field: 'version' })
  return row
}

/**
 * Copy from another channel (spec 9.4): the source's live references
 * duplicated in position order over the same `assets` rows, with their
 * frames, readings and sheets; the source's approved exemplars inserted as
 * approved versions with `copiedFrom`, retiring any the target had for the
 * technique. A fork: nothing links the two channels afterwards. The
 * identity is the action's to copy (it lives in settings).
 */
export async function copyMotionFromChannel(
  db: Database,
  targetId: string,
  sourceId: string,
): Promise<{ references: number; exemplars: number }> {
  return db.transaction(async (tx) => {
    const [live] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(motionReferences)
      .where(and(eq(motionReferences.channelId, targetId), isNull(motionReferences.archivedAt)))
    if ((live?.n ?? 0) > 0) {
      throw new ValidationError("Archive this channel's references first", {
        field: 'references',
      })
    }
    const references = await tx
      .select()
      .from(motionReferences)
      .where(and(eq(motionReferences.channelId, sourceId), isNull(motionReferences.archivedAt)))
      .orderBy(asc(motionReferences.position))
    let position = 0
    for (const row of references) {
      position += 1
      await tx.insert(motionReferences).values({
        channelId: targetId,
        assetId: row.assetId,
        kind: row.kind,
        title: row.title,
        sourceUrl: row.sourceUrl,
        rights: row.rights,
        purpose: row.purpose,
        negative: row.negative,
        windowStartMs: row.windowStartMs,
        windowEndMs: row.windowEndMs,
        carryOver: row.carryOver,
        avoid: row.avoid,
        frames: row.frames,
        reading: row.reading,
        contactSheetKey: row.contactSheetKey,
        denseSheetKey: row.denseSheetKey,
        readState: row.readState,
        readError: row.readError,
        position,
      })
    }

    const approved = await tx
      .select()
      .from(channelExemplars)
      .where(and(eq(channelExemplars.channelId, sourceId), eq(channelExemplars.status, 'approved')))
      .orderBy(asc(channelExemplars.technique))
    for (const row of approved) {
      await tx
        .update(channelExemplars)
        .set({ status: 'retired', updatedAt: new Date() })
        .where(
          and(
            eq(channelExemplars.channelId, targetId),
            eq(channelExemplars.technique, row.technique),
            eq(channelExemplars.status, 'approved'),
          ),
        )
      const [top] = await tx
        .select({ version: sql<number>`coalesce(max(${channelExemplars.version}), 0)::int` })
        .from(channelExemplars)
        .where(
          and(
            eq(channelExemplars.channelId, targetId),
            eq(channelExemplars.technique, row.technique),
          ),
        )
      await tx.insert(channelExemplars).values({
        channelId: targetId,
        technique: row.technique,
        version: (top?.version ?? 0) + 1,
        status: 'approved',
        approvedAt: new Date(),
        plan: row.plan,
        code: row.code,
        critique: row.critique,
        verify: row.verify,
        pairwise: row.pairwise,
        metrics: row.metrics,
        frames: row.frames,
        copiedFrom: row.id,
        costUsd: row.costUsd,
      })
    }
    return { references: references.length, exemplars: approved.length }
  })
}
