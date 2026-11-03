'use server'

import {
  caseSubjectTaken,
  channelForCase,
  chooseCaseAngle,
  costPerMinute,
  createCase,
  createProjectFromCase,
  deleteCase,
  getCase,
  markCaseInProduction,
  setCaseFormat,
  setCaseStatus,
  setCaseTargetKeyword,
  setProjectStage,
  updateCase,
  writeCaseResearchJob,
} from '@boom-busters/db'
import type { CaseStatus } from '@boom-busters/db'
import type { ChannelFormat } from '@boom-busters/schemas'
import {
  CASE_PEOPLE_MAX,
  CASE_PERSON_MAX,
  CASE_SOURCE_LINKS_MAX,
  CASE_SUBJECT_MAX,
  CASE_SUBJECT_MIN,
  EXAMPLE_SLOT_IDS,
  RUNTIME_START_MAX,
  UlidSchema,
  caseResearchCredits,
  caseResearchJobIsRunning,
  isBibleComplete,
  keywordHasFigure,
  leadKeyword,
  resolveFormat,
  serialiseError,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import { BIBLE_INCOMPLETE_MESSAGE } from '@/lib/bible-gate'
import { findChannel, writeRefusalFor } from '@/lib/channel-lookup'
import { caseCategoryKeys } from '@/lib/case-category'
import { checkVidiqBudget } from '@/lib/vidiq-spend'

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
  // Checked against the channel's bible in the action: the schema cannot know it.
  category: z.string().trim().min(1, 'Pick a category'),
  angle: z.string().trim().max(2000).optional(),
  demandNotes: z.string().trim().max(2000).optional(),
  // No longer asked for: a new case writes 0, an edit leaves the stored value alone.
  priorityScore: z.number().int().min(0).max(100).optional(),
  subject: z
    .string()
    .trim()
    .min(CASE_SUBJECT_MIN, 'Give the case a subject: the company, as Wikipedia names it')
    .max(CASE_SUBJECT_MAX),
  people: z
    .array(z.string().trim().min(2).max(CASE_PERSON_MAX))
    .max(CASE_PEOPLE_MAX, `Name at most ${CASE_PEOPLE_MAX} people`)
    .default([]),
  sourceLinks: z
    .array(
      z.object({
        url: z
          .string()
          .url()
          .refine((url) => /^https?:\/\//i.test(url), {
            message: 'Each source link must start with http:// or https://',
          }),
        note: z.string().max(500).optional(),
      }),
    )
    .max(CASE_SOURCE_LINKS_MAX, `Add at most ${CASE_SOURCE_LINKS_MAX} source links`)
    .default([]),
})

const CATEGORY_NOT_IN_BIBLE = "That category is not in this channel's bible"
const SUBJECT_TAKEN = 'A case for this subject already exists'

export async function addCase(channelId: string, input: unknown): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  // A well-formed id that names no channel would otherwise surface a foreign-key error.
  const channel = await findChannel(channelId)
  const refusal = writeRefusalFor(channel)
  if (refusal || !channel) return refusal ?? { ok: false, error: 'Unknown channel' }

  const parsed = CaseFormSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That case is not valid' }
  }
  if (!caseCategoryKeys(channel.bible).includes(parsed.data.category)) {
    return { ok: false, error: CATEGORY_NOT_IN_BIBLE }
  }

  if (await caseSubjectTaken(db, channelId, parsed.data.subject)) {
    return { ok: false, error: SUBJECT_TAKEN }
  }

  await createCase(db, {
    ...parsed.data,
    channelId,
    priorityScore: 0,
    // A case added by hand is one the human has already decided to make, so it
    // skips triage and lands shortlisted.
    status: 'shortlisted',
  })
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

export async function editCase(id: string, input: unknown): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown case' }

  // A partial edit must not fill a field the owner never sent: `.default` would
  // turn a missing list into an empty one and wipe the stored people or links.
  const parsed = CaseFormSchema.partial()
    .extend({
      people: CaseFormSchema.shape.people.unwrap().optional(),
      sourceLinks: CaseFormSchema.shape.sourceLinks.unwrap().optional(),
    })
    .safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That change is not valid' }
  }
  if (parsed.data.category !== undefined || parsed.data.subject !== undefined) {
    const channel = await channelForCase(db, id)
    if (!channel) return { ok: false, error: 'That case no longer exists' }
    if (
      parsed.data.category !== undefined &&
      !caseCategoryKeys(channel.bible).includes(parsed.data.category)
    ) {
      return { ok: false, error: CATEGORY_NOT_IN_BIBLE }
    }
    if (
      parsed.data.subject !== undefined &&
      (await caseSubjectTaken(db, channel.id, parsed.data.subject, id))
    ) {
      return { ok: false, error: SUBJECT_TAKEN }
    }
  }

  const updated = await updateCase(db, id, parsed.data)
  if (!updated) return { ok: false, error: 'That case no longer exists' }

  revalidatePath('/c/[slug]', 'layout')
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

  revalidatePath('/c/[slug]', 'layout')
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

  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

export interface StartProjectResult extends ActionResult {
  projectId?: string
}

/**
 * Start a project from a shortlisted case — the `New project` button.
 *
 * Creates the project row, moves the case into production, and hands
 * `project/created` to Inngest so the dossier-runner picks it up.
 *
 * The project row is written *before* the event is sent, and the row survives
 * a send failure: a queued project with an error toast is recoverable, whereas
 * an event referring to a project that was never inserted is a run that fails
 * on its first step.
 */
export async function startProjectFromCase(
  id: string,
  targetRuntimeMin?: number,
  formatKey?: string,
): Promise<StartProjectResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(id).success) return { ok: false, error: 'Unknown case' }

  const existing = await getCase(db, id)
  if (!existing) return { ok: false, error: 'That case no longer exists' }
  if (existing.status === 'retired') {
    return { ok: false, error: 'That case is retired. Move it back to shortlisted first.' }
  }

  const channel = await channelForCase(db, id)
  if (!channel) return { ok: false, error: 'That case no longer exists' }
  const refusal = writeRefusalFor(channel)
  if (refusal) return refusal
  if (!isBibleComplete(channel.bible, EXAMPLE_SLOT_IDS))
    return { ok: false, error: BIBLE_INCOMPLETE_MESSAGE }

  // The format: the one asked for (it must be in the bible now), else the case's, else the primary.
  const formats = channel.bible.formats
  if (formatKey !== undefined && !formats.some((f) => f.key === formatKey)) {
    return { ok: false, error: "That format is not in the channel's bible" }
  }
  const format = resolveFormat(formats, formatKey ?? existing.formatKey)
  const maxMin = Math.min(format.runtime.max, RUNTIME_START_MAX)
  let runtime: number
  if (format.runtime.min > RUNTIME_START_MAX) {
    // Every length this format allows is beyond the start limit: nothing can start.
    return {
      ok: false,
      error: `Videos longer than ${RUNTIME_START_MAX} minutes are not supported yet`,
    }
  } else if (targetRuntimeMin === undefined) {
    runtime = Math.min(Math.max(format.runtime.default, format.runtime.min), maxMin)
  } else if (Number.isInteger(targetRuntimeMin) && targetRuntimeMin > RUNTIME_START_MAX) {
    return {
      ok: false,
      error: `Videos longer than ${RUNTIME_START_MAX} minutes are not supported yet`,
    }
  } else if (
    !Number.isInteger(targetRuntimeMin) ||
    targetRuntimeMin < format.runtime.min ||
    targetRuntimeMin > maxMin
  ) {
    return {
      ok: false,
      error: `This format runs ${format.runtime.min} to ${format.runtime.max} minutes`,
    }
  } else {
    runtime = targetRuntimeMin
  }

  const project = await createProjectFromCase(db, {
    caseId: id,
    title: existing.title,
    targetRuntimeMin: runtime,
    ...((formatKey ?? existing.formatKey)
      ? { formatKey: (formatKey ?? existing.formatKey) as string }
      : {}),
  })
  await markCaseInProduction(db, id)
  revalidatePath('/c/[slug]', 'layout')

  try {
    await inngest.send(events.projectCreated.create({ projectId: project.id, caseId: id }))
  } catch (error) {
    console.error('[cases] could not start the dossier run', serialiseError(error))

    /**
     * The row stays, but it must not stay `queued`.
     *
     * `queued` means "sent, waiting to be picked up", and the project screen
     * says so — no button, nothing to do but wait. That is the right thing to
     * show when the event is genuinely in flight and a lie when the send just
     * failed in front of us. Marking it failed is what puts the "run it again"
     * button on the screen the human is about to open.
     */
    await setProjectStage(db, project.id, { stageStatus: 'failed' })
    revalidatePath('/c/[slug]', 'layout')

    return {
      ok: false,
      projectId: project.id,
      error:
        'The project was created, but the pipeline could not be reached, so nothing is ' +
        'researching it. Open the project and run the dossier stage again.',
    }
  }

  return { ok: true, projectId: project.id }
}

export interface StartCostEstimate {
  usd: number | null
  /** The whole line the Start control shows. */
  basis: string
}

/**
 * What a project of this length is likely to cost, from what finished projects
 * did cost per minute. Spends nothing.
 */
export async function estimateStartCostAction(
  channelId: string,
  runtimeMin: number,
): Promise<StartCostEstimate> {
  await requireOwner()
  const none = { usd: null, basis: 'No estimate yet: no finished projects' }
  if (!UlidSchema.safeParse(channelId).success || !Number.isFinite(runtimeMin)) return none
  const rate = await costPerMinute(db, channelId)
  if (rate === null) return none
  const usd = Math.round(rate.usdPerMinute * runtimeMin * 100) / 100
  const count = rate.projects === 1 ? '1 finished project' : `${rate.projects} finished projects`
  return { usd, basis: `About $${usd.toFixed(2)}, from ${count}` }
}

const RESEARCH_RUNNING: ActionResult = {
  ok: false,
  error: 'Research is already running for this case',
}

/**
 * The checks the estimate and the run both make, up to the case itself: the
 * case exists, is not retired, belongs to a channel that is not archived and
 * has a subject to search for.
 */
async function researchableCase(id: string) {
  if (!UlidSchema.safeParse(id).success) return { ok: false as const, error: 'Unknown case' }
  const existing = await getCase(db, id)
  if (!existing) return { ok: false as const, error: 'That case no longer exists' }
  if (existing.status === 'retired') {
    return { ok: false as const, error: 'That case is retired. Move it back to shortlisted first.' }
  }
  const channel = (await channelForCase(db, id)) ?? null
  const refusal = writeRefusalFor(channel)
  if (refusal) return refusal
  const subject = existing.subject?.trim() ?? ''
  if (subject === '') {
    return { ok: false as const, error: 'Give the case a subject before researching it' }
  }
  return { ok: true as const, existing, subject, credits: researchCredits(channel, existing) }
}

/** What a run costs: more when the case's format (against the channel's current bible) has a lead keyword. */
function researchCredits(
  channel: { bible: { formats: readonly ChannelFormat[] } } | null,
  existing: { formatKey: string | null },
): number {
  const formats = channel?.bible.formats ?? []
  const hasFormatSeed =
    formats.length > 0 && leadKeyword(resolveFormat(formats, existing.formatKey)) !== null
  return caseResearchCredits(hasFormatSeed)
}

export type CaseResearchEstimate =
  { ok: true; credits: number; capLeft: number; balance: number } | { ok: false; error: string }

/**
 * What `Research with VidIQ` would cost, for the button's label: the credits
 * the run needs, what is left of this month's cap and the VidIQ balance.
 * Spends nothing.
 */
export async function caseResearchEstimate(caseId: string): Promise<CaseResearchEstimate> {
  await requireOwner()
  if (!UlidSchema.safeParse(caseId).success) return { ok: false, error: 'Unknown case' }
  const existing = await getCase(db, caseId)
  if (!existing) return { ok: false, error: 'That case no longer exists' }
  const credits = researchCredits((await channelForCase(db, caseId)) ?? null, existing)
  const budget = await checkVidiqBudget(credits)
  if (!budget.ok) return budget
  return {
    ok: true,
    credits,
    capLeft: budget.capLeft,
    balance: budget.balance,
  }
}

/**
 * `Research with VidIQ`: check everything, stamp the case's research job and
 * send the run. Every refusal comes before the job is stamped, so a refused
 * press leaves no trace; the estimate on screen may be old, so it is checked
 * again here.
 */
export async function researchCaseAction(caseId: string): Promise<ActionResult> {
  await requireOwner()
  const checked = await researchableCase(caseId)
  if (!checked.ok) return checked

  const budget = await checkVidiqBudget(checked.credits)
  if (!budget.ok) return budget

  if (checked.existing.searchJob && caseResearchJobIsRunning(checked.existing.searchJob)) {
    return RESEARCH_RUNNING
  }

  // The read above can be stale: the stamp itself refuses a running job, under the row lock.
  const startedAt = new Date().toISOString()
  const stamped = await writeCaseResearchJob(db, caseId, (job) =>
    job && caseResearchJobIsRunning(job)
      ? job
      : { state: 'running', current: null, error: null, startedAt, subject: checked.subject },
  )
  if (stamped?.startedAt !== startedAt) return RESEARCH_RUNNING
  revalidatePath('/c/[slug]', 'layout')

  try {
    await inngest.send(events.caseResearchRequested.create({ caseId, jobStartedAt: startedAt }))
  } catch (error) {
    console.error('[cases] could not send the research run', serialiseError(error))
    // Nothing is running: say so, or the case stays locked until the job goes stale.
    await writeCaseResearchJob(db, caseId, (job) =>
      job?.startedAt === startedAt
        ? { ...job, state: 'failed', current: null, error: 'The research run could not be started' }
        : job,
    )
    revalidatePath('/c/[slug]', 'layout')
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the research. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  return { ok: true }
}

/** The checks the two brief choices share: a real case on a channel that can be written to. */
async function writableCase(caseId: string): Promise<ActionResult | null> {
  if (!UlidSchema.safeParse(caseId).success) return { ok: false, error: 'Unknown case' }
  const channel = await channelForCase(db, caseId)
  if (!channel) return { ok: false, error: 'That case no longer exists' }
  return writeRefusalFor(channel)
}

const AngleChoiceSchema = z.union([
  z.object({ option: z.number().int().min(0).max(2) }).strict(),
  z.object({ own: z.string().trim().min(1, 'Write your angle first').max(2000) }).strict(),
])

/** `Use this angle` and `Keep my own angle`: settle the case's angle from its brief. */
export async function chooseAngleAction(
  caseId: string,
  choice: { option: number } | { own: string },
): Promise<ActionResult> {
  await requireOwner()
  const refusal = await writableCase(caseId)
  if (refusal) return refusal
  const parsed = AngleChoiceSchema.safeParse(choice)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That angle is not valid' }
  }
  try {
    await chooseCaseAngle(db, caseId, parsed.data)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not set the angle' }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/** `Make target`: promote one of the brief's secondary keywords. A keyword with a figure never is. */
export async function setTargetKeywordAction(
  caseId: string,
  keyword: string,
): Promise<ActionResult> {
  await requireOwner()
  const refusal = await writableCase(caseId)
  if (refusal) return refusal
  if (typeof keyword !== 'string' || keyword.trim() === '') {
    return { ok: false, error: 'Pick a keyword' }
  }
  if (keywordHasFigure(keyword)) {
    return { ok: false, error: 'A keyword with a figure cannot be the target keyword' }
  }
  try {
    await setCaseTargetKeyword(db, caseId, keyword)
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not set the target keyword',
    }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/** The format picker: which of the channel's formats this case is made as. */
export async function setCaseFormatAction(
  caseId: string,
  formatKey: string | null,
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(caseId).success) return { ok: false, error: 'Unknown case' }
  const channel = (await channelForCase(db, caseId)) ?? null
  if (!channel) return { ok: false, error: 'That case no longer exists' }
  const refusal = writeRefusalFor(channel)
  if (refusal) return refusal
  if (formatKey !== null && !channel.bible.formats.some((f) => f.key === formatKey)) {
    return { ok: false, error: "That format is not in the channel's bible" }
  }
  await setCaseFormat(db, caseId, formatKey)
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}
