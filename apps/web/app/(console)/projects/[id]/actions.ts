'use server'

import {
  blockingClaims,
  editChapter,
  getChapter,
  getLatestScript,
  reorderChapters,
  projectIdForChapter,
  scriptableClaims,
  setClaimQuarantined,
  updateClaimText,
  verifyClaim,
} from '@boom-busters/db'
import {
  buildRegenerateRequest,
  mockRegeneratedSection,
  mockProvidersEnabled,
} from '@boom-busters/providers'
import {
  ClaimConfidenceSchema,
  ClaimSourceTypeSchema,
  UlidSchema,
  estimateRuntimeSec,
  serialiseError,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'

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

/**
 * Quarantine every claim still blocking approval, in one press.
 *
 * Triaging one by one is right when the claims deserve different verdicts;
 * when the verdict is "none of these made the cut", a twelve-claim dossier
 * was twelve clicks of the same button. The set is computed server-side by
 * the same `blockingClaims` predicate the approve action enforces, so this
 * can only ever quarantine exactly what was blocking.
 */
export async function quarantineAllBlocking(projectId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid

  const blocking = await blockingClaims(db, projectId)
  if (blocking.length === 0) {
    return { ok: false, error: 'Nothing is blocking approval.' }
  }

  for (const claim of blocking) {
    await setClaimQuarantined(db, claim.id, true)
  }

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

// ---------------------------------------------------------------------------
// Script Studio
// ---------------------------------------------------------------------------

/**
 * Authorise a chapter edit against the project in the URL.
 *
 * A chapter id alone is not authorisation: without this check, any chapter in
 * the database could be edited through any project's page.
 */
async function chapterBelongsTo(projectId: string, chapterId: string): Promise<boolean> {
  return (await projectIdForChapter(db, chapterId)) === projectId
}

const ChapterTextSchema = z.string().max(200_000)

/**
 * Autosave, and the record of what it replaced.
 *
 * Spec section 5 calls `script_edits` "the human-curation evidence trail", so
 * the write and the trail entry happen together in `editChapter` — there is no
 * path that updates the text without recording the change.
 */
export async function saveChapterText(
  projectId: string,
  chapterId: string,
  text: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, chapterId)
  if (invalid) return invalid

  const parsed = ChapterTextSchema.safeParse(text)
  if (!parsed.success) return { ok: false, error: 'That chapter is too long to save' }
  if (!(await chapterBelongsTo(projectId, chapterId))) {
    return { ok: false, error: 'That chapter is not part of this project' }
  }

  const updated = await editChapter(db, {
    chapterId,
    afterText: parsed.data,
    editType: 'human',
    estRuntimeSec: estimateRuntimeSec(parsed.data),
  })
  if (!updated) return { ok: false, error: 'That chapter no longer exists' }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export interface RegenerateResult extends ActionResult {
  /** The proposed replacement, for the diff view. Never written directly. */
  proposal?: string
}

/**
 * Regenerate a selected passage.
 *
 * It returns the proposal rather than writing it. The human accepts or rejects
 * each hunk in the diff view, and only the result of that decision is saved —
 * so a regenerate can never quietly replace text somebody wrote.
 */
export async function regenerateSection(
  projectId: string,
  chapterId: string,
  selection: string,
  note: string,
): Promise<RegenerateResult> {
  await requireOwner()
  const invalid = badIds(projectId, chapterId)
  if (invalid) return invalid

  if (selection.trim().length < 20) {
    return { ok: false, error: 'Select at least a sentence to regenerate' }
  }
  if (!(await chapterBelongsTo(projectId, chapterId))) {
    return { ok: false, error: 'That chapter is not part of this project' }
  }

  const chapter = await getChapter(db, chapterId)
  if (!chapter) return { ok: false, error: 'That chapter no longer exists' }

  const claims = (await scriptableClaims(db, projectId)).map((claim) => ({
    id: claim.id,
    text: claim.text,
    sourceUrl: claim.sourceUrl,
    confidence: claim.confidence,
  }))

  try {
    const proposal = mockProvidersEnabled()
      ? mockRegeneratedSection(selection, note)
      : (
          await callLlm(
            buildRegenerateRequest({
              chapterTitle: chapter.title,
              contentMd: chapter.contentMd,
              selection,
              note,
              claims,
            }),
            { projectId },
          )
        ).text.trim()

    return { ok: true, proposal }
  } catch (error) {
    console.error('[script] regenerate failed', serialiseError(error))
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The regenerate call failed',
    }
  }
}

/**
 * Save the result of accepting hunks in the diff view.
 *
 * Recorded as a `regenerate` edit with the note, so the trail distinguishes
 * "a human rewrote this" from "a human asked a model to rewrite this and
 * approved the result".
 */
export async function applyRegeneratedText(
  projectId: string,
  chapterId: string,
  text: string,
  note: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, chapterId)
  if (invalid) return invalid

  const parsed = ChapterTextSchema.safeParse(text)
  if (!parsed.success) return { ok: false, error: 'That chapter is too long to save' }
  if (!(await chapterBelongsTo(projectId, chapterId))) {
    return { ok: false, error: 'That chapter is not part of this project' }
  }

  const updated = await editChapter(db, {
    chapterId,
    afterText: parsed.data,
    editType: 'regenerate',
    note: note.trim() || null,
    estRuntimeSec: estimateRuntimeSec(parsed.data),
  })
  if (!updated) return { ok: false, error: 'That chapter no longer exists' }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

/**
 * Reorder a script's chapters (spec section 11.3, "drag-reorder").
 *
 * Reordering does not rewrite the prose. Chapters were drafted sequentially,
 * each seamed onto the tail of the one before, so the caller is told which
 * chapters now open in the wrong place rather than being left to discover it
 * while reading.
 */
export async function reorderScriptChapters(
  projectId: string,
  scriptId: string,
  orderedChapterIds: string[],
): Promise<ActionResult & { reseamNeeded?: number[] }> {
  await requireOwner()
  const invalid = badIds(projectId, scriptId, ...orderedChapterIds)
  if (invalid) return invalid

  const script = await getLatestScript(db, projectId)
  if (!script || script.script.id !== scriptId) {
    return { ok: false, error: 'That script is not the current one for this project' }
  }

  const before = script.chapters.map((chapter) => chapter.id)
  const result = await reorderChapters(db, scriptId, orderedChapterIds)
  if (!result.ok) return { ok: false, error: result.error }

  // Which positions changed hands — those are the chapters whose opening
  // sentences now follow a different chapter than they were written to follow.
  const reseamNeeded = orderedChapterIds
    .map((id, position) => (before[position] === id ? -1 : position))
    .filter((position) => position >= 0)

  revalidatePath(`/projects/${projectId}`)
  return { ok: true, reseamNeeded }
}
