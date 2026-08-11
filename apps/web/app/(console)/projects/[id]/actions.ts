'use server'

import { setClaimQuarantined, updateClaimText, verifyClaim } from '@boom-busters/db'
import { ClaimConfidenceSchema, ClaimSourceTypeSchema, UlidSchema } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'

/**
 * Claim actions on the dossier review screen (build spec section 11.3).
 *
 * Each re-checks the session and validates its own arguments, like every other
 * action in the app: a server action is a POST endpoint, and the screen that
 * rendered the button is not a guarantee about what arrives.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

function badIds(...ids: string[]): ActionResult | null {
  return ids.every((id) => UlidSchema.safeParse(id).success)
    ? null
    : { ok: false, error: 'Unknown claim' }
}

export async function quarantineClaim(
  projectId: string,
  claimId: string,
  quarantined: boolean,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, claimId)
  if (invalid) return invalid

  const updated = await setClaimQuarantined(db, claimId, quarantined)
  if (!updated) return { ok: false, error: 'That claim no longer exists' }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

const ClaimTextSchema = z.string().trim().min(10).max(1000)

export async function editClaim(
  projectId: string,
  claimId: string,
  text: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, claimId)
  if (invalid) return invalid

  const parsed = ClaimTextSchema.safeParse(text)
  if (!parsed.success) {
    return { ok: false, error: 'A claim needs between 10 and 1000 characters' }
  }

  const updated = await updateClaimText(db, claimId, parsed.data)
  if (!updated) return { ok: false, error: 'That claim no longer exists' }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

/**
 * The human has checked a claim and is standing behind it.
 *
 * The URL is required and validated. "I checked this" without a link is a
 * claim nobody can re-check — including the person who checked it, six weeks
 * later, when a subject's lawyer asks where it came from.
 */
const VerifySchema = z.object({
  sourceUrl: z.string().url('Give the URL you checked against'),
  sourceType: ClaimSourceTypeSchema,
  confidence: ClaimConfidenceSchema.exclude(['unverified']),
})

export async function verifyClaimAction(
  projectId: string,
  claimId: string,
  input: unknown,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, claimId)
  if (invalid) return invalid

  const parsed = VerifySchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That source is not valid' }
  }

  const updated = await verifyClaim(db, claimId, parsed.data)
  if (!updated) return { ok: false, error: 'That claim no longer exists' }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}
