import { and, desc, eq, gt } from 'drizzle-orm'
import type {
  DerivationProposal,
  DerivationState,
  TechniqueKey,
  TechniqueProgress,
} from '@boom-busters/schemas'
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
  input: {
    channelId: string
    techniques: TechniqueKey[]
    rounds: number
    capUsd: number
    /** "Propose a technique from the mechanism references" (spec 8.5). */
    propose?: boolean
  },
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
      propose: input.propose ?? false,
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

/**
 * A running row nobody has touched for this long is dead (final review,
 * issue 1): a run cancelled outside the app fires no failure handler, and
 * the job touches its row before every paid step, none of which outlasts a
 * Vercel invocation. Without this the channel would wait forever.
 */
export const DERIVATION_STALE_MS = 15 * 60_000

/** The job's heartbeat: before every paid step. */
export async function touchDerivation(db: Database, id: string): Promise<void> {
  await db
    .update(motionDerivations)
    .set({ updatedAt: new Date() })
    .where(eq(motionDerivations.id, id))
}

export async function runningDerivation(
  db: Database,
  channelId: string,
): Promise<MotionDerivationRow | null> {
  const [row] = await db
    .select()
    .from(motionDerivations)
    .where(
      and(
        eq(motionDerivations.channelId, channelId),
        eq(motionDerivations.state, 'running'),
        gt(motionDerivations.updatedAt, new Date(Date.now() - DERIVATION_STALE_MS)),
      ),
    )
    .orderBy(desc(motionDerivations.createdAt))
    .limit(1)
  return row ?? null
}

/** One technique's row in the progress list, the others untouched. */
export async function updateTechniqueProgress(
  db: Database,
  id: string,
  technique: TechniqueKey,
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

/** What the propose step did (spec 8.5), written once it ran. */
export async function setDerivationProposal(
  db: Database,
  id: string,
  proposal: DerivationProposal,
): Promise<void> {
  await db
    .update(motionDerivations)
    .set({ proposal, updatedAt: new Date() })
    .where(eq(motionDerivations.id, id))
}

/** A proposed technique joins the progress as pending, once. */
export async function appendTechniqueProgress(
  db: Database,
  id: string,
  technique: TechniqueKey,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ progress: motionDerivations.progress })
      .from(motionDerivations)
      .where(eq(motionDerivations.id, id))
      .for('update')
    if (!row || row.progress.some((entry) => entry.technique === technique)) return
    const entry: TechniqueProgress = {
      technique,
      state: 'pending',
      versionId: null,
      reason: null,
      costUsd: 0,
    }
    await tx
      .update(motionDerivations)
      .set({ progress: [...row.progress, entry], updatedAt: new Date() })
      .where(eq(motionDerivations.id, id))
  })
}
