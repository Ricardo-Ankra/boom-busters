import { and, desc, eq } from 'drizzle-orm'
import type { DerivationState, Technique, TechniqueProgress } from '@boom-busters/schemas'
import type { Database } from './client'
import { motionDerivations } from './schema'
import type { MotionDerivationRow } from './schema'

/**
 * One launch of the derivation (spec 2026-11-04, section 9.1): the row the
 * Derive dialogue creates, the job reads its cap from and writes its
 * progress to, and the Motion tab shows per technique with the spend.
 */

export async function createDerivation(
  db: Database,
  input: { channelId: string; techniques: Technique[]; rounds: number; capUsd: number },
): Promise<MotionDerivationRow> {
  const progress: TechniqueProgress[] = input.techniques.map((technique) => ({
    technique,
    state: 'pending',
    versionId: null,
    reason: null,
    costUsd: 0,
  }))
  const [row] = await db
    .insert(motionDerivations)
    .values({
      channelId: input.channelId,
      techniques: input.techniques,
      rounds: input.rounds,
      capUsd: input.capUsd.toFixed(4),
      progress,
    })
    .returning()
  if (!row) throw new Error('The derivation was not written')
  return row
}

export async function getDerivation(db: Database, id: string): Promise<MotionDerivationRow | null> {
  const [row] = await db
    .select()
    .from(motionDerivations)
    .where(eq(motionDerivations.id, id))
    .limit(1)
  return row ?? null
}

export async function latestDerivation(
  db: Database,
  channelId: string,
): Promise<MotionDerivationRow | null> {
  const [row] = await db
    .select()
    .from(motionDerivations)
    .where(eq(motionDerivations.channelId, channelId))
    .orderBy(desc(motionDerivations.createdAt))
    .limit(1)
  return row ?? null
}

export async function runningDerivation(
  db: Database,
  channelId: string,
): Promise<MotionDerivationRow | null> {
  const [row] = await db
    .select()
    .from(motionDerivations)
    .where(and(eq(motionDerivations.channelId, channelId), eq(motionDerivations.state, 'running')))
    .orderBy(desc(motionDerivations.createdAt))
    .limit(1)
  return row ?? null
}

/** One technique's row in the progress list, the others untouched. */
export async function updateTechniqueProgress(
  db: Database,
  id: string,
  technique: Technique,
  patch: Partial<Omit<TechniqueProgress, 'technique'>>,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ progress: motionDerivations.progress })
      .from(motionDerivations)
      .where(eq(motionDerivations.id, id))
      .for('update')
    if (!row) return
    const progress = row.progress.map((entry) =>
      entry.technique === technique ? { ...entry, ...patch } : entry,
    )
    await tx
      .update(motionDerivations)
      .set({ progress, updatedAt: new Date() })
      .where(eq(motionDerivations.id, id))
  })
}

export async function finishDerivation(
  db: Database,
  id: string,
  outcome: { state: Exclude<DerivationState, 'running'>; spentUsd: number; error?: string },
): Promise<void> {
  await db
    .update(motionDerivations)
    .set({
      state: outcome.state,
      spentUsd: outcome.spentUsd.toFixed(4),
      error: outcome.error ?? null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(motionDerivations.id, id))
}
