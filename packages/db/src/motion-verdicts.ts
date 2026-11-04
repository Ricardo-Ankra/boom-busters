import { desc, eq } from 'drizzle-orm'
import type { VerdictKind } from '@boom-busters/schemas'
import type { Database } from './client'
import { motionVerdicts } from './schema'
import type { MotionVerdictRow } from './schema'

/**
 * The preference ledger (spec 2026-11-04, section 11): every verdict the
 * owner gives on the board or in settings, with what it was given on.
 * Nothing reads it yet; using it is a later decision (spec 3, non-goals).
 */

export async function recordVerdict(
  db: Database,
  input: {
    channelId: string
    kind: VerdictKind
    exemplarId?: string | null
    slotId?: string | null
    comparison?: { a: string; b: string } | null
    steer?: string | null
  },
): Promise<MotionVerdictRow> {
  const [row] = await db
    .insert(motionVerdicts)
    .values({
      channelId: input.channelId,
      kind: input.kind,
      exemplarId: input.exemplarId ?? null,
      slotId: input.slotId ?? null,
      comparison: input.comparison ?? null,
      steer: input.steer ?? null,
    })
    .returning()
  if (!row) throw new Error('The verdict was not written')
  return row
}

export async function listVerdicts(
  db: Database,
  channelId: string,
  limit = 50,
): Promise<MotionVerdictRow[]> {
  return db
    .select()
    .from(motionVerdicts)
    .where(eq(motionVerdicts.channelId, channelId))
    .orderBy(desc(motionVerdicts.createdAt), desc(motionVerdicts.id))
    .limit(limit)
}
