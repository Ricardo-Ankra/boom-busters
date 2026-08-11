import { and, asc, eq, sql } from 'drizzle-orm'
import type { Database } from './client'
import { claims, dossiers } from './schema'
import type { ClaimConfidence, ClaimRow, ClaimSourceType } from './schema'

/**
 * Dossier and claims queries (build spec sections 5, 7.1 and 11.3).
 *
 * The rule that matters most in this file is the approval blocker: a dossier
 * cannot be approved while any claim is still `unverified` and not
 * quarantined. That is not a UI nicety — it is the mechanism that stops
 * unsourced assertions reaching a script, and it is enforced here, server-side,
 * so a disabled button is never the only thing preventing it.
 */

export interface DraftClaimInput {
  text: string
  sourceUrl?: string | undefined
  sourceType: ClaimSourceType
  confidence: ClaimConfidence
}

export interface DossierWithClaims {
  id: string
  projectId: string
  contentMd: string
  approvedAt: Date | null
  claims: ClaimRow[]
  createdAt: Date
  updatedAt: Date
}

/**
 * Write the dossier and its claims, replacing anything already there.
 *
 * `dossiers` is unique per project, so a re-run after a change request updates
 * in place rather than accumulating drafts. The claims are replaced wholesale
 * because a claim's identity is its text, and a revised research pass produces
 * a different set — trying to merge them would silently keep a claim the new
 * research dropped.
 */
export async function saveDossier(
  db: Database,
  input: { projectId: string; contentMd: string; claims: readonly DraftClaimInput[] },
): Promise<DossierWithClaims> {
  const [dossier] = await db
    .insert(dossiers)
    .values({ projectId: input.projectId, contentMd: input.contentMd })
    .onConflictDoUpdate({
      target: dossiers.projectId,
      set: { contentMd: input.contentMd, updatedAt: new Date() },
    })
    .returning()

  await db.delete(claims).where(eq(claims.dossierId, dossier!.id))

  if (input.claims.length > 0) {
    await db.insert(claims).values(
      input.claims.map((claim) => ({
        dossierId: dossier!.id,
        text: claim.text,
        sourceUrl: claim.sourceUrl ?? null,
        sourceType: claim.sourceType,
        confidence: claim.confidence,
      })),
    )
  }

  return (await getDossier(db, input.projectId))!
}

export async function getDossier(
  db: Database,
  projectId: string,
): Promise<DossierWithClaims | undefined> {
  const [dossier] = await db
    .select()
    .from(dossiers)
    .where(eq(dossiers.projectId, projectId))
    .limit(1)

  if (!dossier) return undefined

  const rows = await db
    .select()
    .from(claims)
    .where(eq(claims.dossierId, dossier.id))
    // Unverified first — spec section 11.3 floats them to the top, because
    // they are the only rows that block approval.
    .orderBy(
      sql`case ${claims.confidence} when 'unverified' then 0 when 'single_source' then 1 else 2 end`,
      asc(claims.createdAt),
    )

  return { ...dossier, claims: rows }
}

export async function setClaimQuarantined(
  db: Database,
  claimId: string,
  quarantined: boolean,
): Promise<ClaimRow | undefined> {
  const [row] = await db
    .update(claims)
    .set({ quarantined, updatedAt: new Date() })
    .where(eq(claims.id, claimId))
    .returning()

  return row
}

/**
 * The human has checked a claim against its source and is standing behind it.
 *
 * Requires a source URL, because "verified" without one is just a stronger way
 * of saying unverified. The UI collects the URL when it is missing.
 */
export async function verifyClaim(
  db: Database,
  claimId: string,
  input: { sourceUrl: string; sourceType: ClaimSourceType; confidence: ClaimConfidence },
): Promise<ClaimRow | undefined> {
  const [row] = await db
    .update(claims)
    .set({
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      confidence: input.confidence,
      updatedAt: new Date(),
    })
    .where(eq(claims.id, claimId))
    .returning()

  return row
}

export async function updateClaimText(
  db: Database,
  claimId: string,
  text: string,
): Promise<ClaimRow | undefined> {
  const [row] = await db
    .update(claims)
    .set({ text, updatedAt: new Date() })
    .where(eq(claims.id, claimId))
    .returning()

  return row
}

/**
 * Claims that still block approval: unverified and not quarantined.
 *
 * Spec section 11.3: "Approve blocked while any `unverified` claim is neither
 * verified (user flips it to sourced after checking) nor quarantined."
 */
export async function blockingClaims(db: Database, projectId: string): Promise<ClaimRow[]> {
  const [dossier] = await db
    .select({ id: dossiers.id })
    .from(dossiers)
    .where(eq(dossiers.projectId, projectId))
    .limit(1)

  if (!dossier) return []

  return db
    .select()
    .from(claims)
    .where(
      and(
        eq(claims.dossierId, dossier.id),
        eq(claims.confidence, 'unverified'),
        eq(claims.quarantined, false),
      ),
    )
}

/**
 * The claims the script may be written from: everything not quarantined.
 *
 * Spec section 7.2 feeds the scripting steps "only non-quarantined claims".
 * Enforced here rather than in the prompt builder, so there is exactly one
 * place a quarantined claim could leak from and it is this query.
 */
export async function scriptableClaims(db: Database, projectId: string): Promise<ClaimRow[]> {
  const [dossier] = await db
    .select({ id: dossiers.id })
    .from(dossiers)
    .where(eq(dossiers.projectId, projectId))
    .limit(1)

  if (!dossier) return []

  return db
    .select()
    .from(claims)
    .where(and(eq(claims.dossierId, dossier.id), eq(claims.quarantined, false)))
    .orderBy(asc(claims.createdAt))
}

export async function markDossierApproved(db: Database, projectId: string): Promise<void> {
  await db
    .update(dossiers)
    .set({ approvedAt: new Date(), updatedAt: new Date() })
    .where(eq(dossiers.projectId, projectId))
}

/** Counts for the gate card: "18 claims · 3 unsourced · 2 quarantined". */
export interface ClaimCounts {
  total: number
  unverified: number
  quarantined: number
  blocking: number
}

export function countClaims(rows: readonly ClaimRow[]): ClaimCounts {
  return {
    total: rows.length,
    unverified: rows.filter((c) => c.confidence === 'unverified').length,
    quarantined: rows.filter((c) => c.quarantined).length,
    blocking: rows.filter((c) => c.confidence === 'unverified' && !c.quarantined).length,
  }
}

export async function truncateDossiers(db: Database): Promise<void> {
  await db.execute(sql`truncate table ${dossiers} restart identity cascade`)
}

/** Increment and return the revision count — the reviser's round number. */
export async function bumpDossierRevisions(db: Database, projectId: string): Promise<number> {
  const [row] = await db
    .update(dossiers)
    .set({ revisions: sql`${dossiers.revisions} + 1`, updatedAt: new Date() })
    .where(eq(dossiers.projectId, projectId))
    .returning({ revisions: dossiers.revisions })

  return row?.revisions ?? 1
}
