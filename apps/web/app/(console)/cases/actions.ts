'use server'

import {
  createCase,
  createProjectFromCase,
  createSuggestedCases,
  deleteCase,
  existingCaseTitles,
  getCase,
  markCaseInProduction,
  setCaseStatus,
  updateCase,
} from '@boom-busters/db'
import type { CaseCategory, CaseStatus } from '@boom-busters/db'
import {
  buildSuggestCasesRequest,
  mockSuggestedCases,
  parseSuggestedCases,
  useMockProviders,
} from '@boom-busters/providers'
import { CaseCategorySchema, UlidSchema, serialiseError } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'

/**
 * Case Library actions (build spec section 11.3).
 *
 * Every one is a POST endpoint in its own right, so each re-checks the session
 * rather than trusting `proxy.ts`, and each validates its own arguments.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

const CaseFormSchema = z.object({
  title: z.string().trim().min(3, 'Give the case a title of at least 3 characters').max(200),
  category: CaseCategorySchema,
  angle: z.string().trim().max(2000).optional(),
  demandNotes: z.string().trim().max(2000).optional(),
  priorityScore: z.number().int().min(0).max(100),
})

export async function addCase(input: unknown): Promise<ActionResult> {
  await requireOwner()

  const parsed = CaseFormSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That case is not valid' }
  }

  await createCase(db, {
    ...parsed.data,
    // A case added by hand is one the human has already decided to make, so it
    // skips triage and lands shortlisted.
    status: 'shortlisted',
  })
  revalidatePath('/cases')
  return { ok: true }
}

export async function editCase(id: string, input: unknown): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown case' }

  const parsed = CaseFormSchema.partial().safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That change is not valid' }
  }

  const updated = await updateCase(db, id, parsed.data)
  if (!updated) return { ok: false, error: 'That case no longer exists' }

  revalidatePath('/cases')
  return { ok: true }
}

const STATUSES: readonly CaseStatus[] = [
  'idea',
  'shortlisted',
  'in_production',
  'published',
  'retired',
]

export async function setStatus(id: string, status: string): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown case' }
  if (!STATUSES.includes(status as CaseStatus)) return { ok: false, error: 'Unknown status' }

  const updated = await setCaseStatus(db, id, status as CaseStatus)
  if (!updated) return { ok: false, error: 'That case no longer exists' }

  revalidatePath('/cases')
  return { ok: true }
}

/** Accept a suggestion: it becomes a real, shortlisted case. */
export async function acceptCase(id: string): Promise<ActionResult> {
  return setStatus(id, 'shortlisted')
}

/**
 * Dismiss a suggestion.
 *
 * A case that has never been produced is deleted outright — it was a proposal
 * and the answer was no. One with projects behind it is retired instead, since
 * deleting it would orphan the record of why those projects exist.
 */
export async function dismissCase(id: string): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown case' }

  const existing = await getCase(db, id)
  if (!existing) return { ok: false, error: 'That case no longer exists' }

  if (existing.projectCount === 0) {
    await deleteCase(db, id)
  } else {
    await setCaseStatus(db, id, 'retired')
  }

  revalidatePath('/cases')
  return { ok: true }
}

export interface SuggestResult extends ActionResult {
  created?: number
  skipped?: number
  /** True when the rows came from the mock adapter and researched nothing. */
  mocked?: boolean
}

const SuggestInputSchema = z.object({
  count: z.number().int().min(1).max(20),
  steer: z.string().trim().max(500).optional(),
})

/**
 * `Suggest cases` — proposals land as `idea` rows for triage, never as
 * shortlisted work.
 *
 * The spend goes through `callLlm`, so it is capped by the same budget guard
 * as the pipeline and shows up on the Costs screen attributed to no project.
 */
export async function suggestCases(input: unknown): Promise<SuggestResult> {
  await requireOwner()

  const parsed = SuggestInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Ask for between 1 and 20 cases' }

  const mocked = useMockProviders()

  try {
    const suggestions = mocked
      ? mockSuggestedCases(parsed.data.count)
      : parseSuggestedCases(
          (
            await callLlm(
              buildSuggestCasesRequest({
                existingTitles: await existingCaseTitles(db),
                count: parsed.data.count,
                ...(parsed.data.steer ? { steer: parsed.data.steer } : {}),
              }),
            )
          ).text,
        )

    const { created, skippedTitles } = await createSuggestedCases(
      db,
      suggestions.map((suggestion) => ({
        title: suggestion.title,
        category: suggestion.category as CaseCategory,
        angle: suggestion.angle,
        demandNotes: suggestion.demandNotes ?? null,
        competitorLinks: suggestion.competitorLinks ?? [],
        priorityScore: suggestion.priorityScore,
        status: 'idea' as const,
      })),
    )

    revalidatePath('/cases')
    return { ok: true, created: created.length, skipped: skippedTitles.length, mocked }
  } catch (error) {
    console.error('[cases] suggestion failed', serialiseError(error))
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The suggestion run failed',
    }
  }
}

export interface StartProjectResult extends ActionResult {
  projectId?: string
}

/**
 * Start a project from a shortlisted case — the `New project` button.
 *
 * Creates the project row and moves the case into production. The project
 * lands at `dossier`/`queued`; emitting `project/created` so the dossier-runner
 * picks it up is wired in M3.4, and until then the row sits queued rather than
 * claiming work that is not happening.
 */
export async function startProjectFromCase(
  id: string,
  targetRuntimeMin?: number,
): Promise<StartProjectResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown case' }

  const existing = await getCase(db, id)
  if (!existing) return { ok: false, error: 'That case no longer exists' }
  if (existing.status === 'retired') {
    return { ok: false, error: 'That case is retired. Move it back to shortlisted first.' }
  }

  const runtime = z.number().int().min(3).max(60).safeParse(targetRuntimeMin ?? 15)
  if (!runtime.success) return { ok: false, error: 'Target runtime must be 3-60 minutes' }

  const project = await createProjectFromCase(db, {
    caseId: id,
    title: existing.title,
    targetRuntimeMin: runtime.data,
  })
  await markCaseInProduction(db, id)

  revalidatePath('/cases')
  revalidatePath('/projects')
  return { ok: true, projectId: project.id }
}
