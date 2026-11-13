'use server'

import {
  addCaseOwnerKeyword,
  caseSubjectTaken,
  channelForCase,
  channelResearchThresholds,
  chooseCaseAngle,
  costPerMinute,
  createCase,
  createProjectFromCase,
  currentBible,
  deleteCase,
  dropCaseNicheJob,
  getCase,
  getChannelSettings,
  getWorkspace,
  markCaseInProduction,
  saveCaseAngleRating,
  saveCaseFieldCheck,
  saveCaseNicheJob,
  saveCaseNicheTest,
  setCaseFormat,
  setCaseStatus,
  setCaseTargetKeyword,
  setProjectStage,
  updateCase,
  writeCaseResearchJob,
} from '@boom-busters/db'
import type { CaseStatus, TargetChange } from '@boom-busters/db'
import type { ChannelFormat } from '@boom-busters/schemas'
import { RATE_ANGLES_OUTPUT_TOKENS } from '@boom-busters/providers'
import {
  BudgetExceededError,
  canonicalModelId,
  CASE_PEOPLE_MAX,
  CASE_PERSON_MAX,
  CASE_SEED_KEYWORD_MAX,
  CASE_SEED_KEYWORD_MIN,
  CASE_SEED_KEYWORDS_MAX,
  CASE_SOURCE_LINKS_MAX,
  CASE_SUBJECT_MAX,
  CASE_SUBJECT_MIN,
  EXACT_KEYWORD_CREDITS,
  EXAMPLE_SLOT_IDS,
  UlidSchema,
  briefPhrases,
  caseResearchCredits,
  caseResearchJobIsRunning,
  exactPhrases,
  isBibleComplete,
  keywordHasFigure,
  leadKeyword,
  pendingNicheJob,
  phraseKey,
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
import { completeForChannel } from '@/lib/answer-call'
import {
  CapReached,
  awaitNicheTest,
  measureKeyword,
  searchField,
  startNicheTest,
} from '@/lib/case-evidence'
import { rateAngles } from '@/lib/rate-angles'
import { rateAnglesEstimateUsd } from '@/lib/rate-angles-estimate'
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

/** One seed keyword, or one `Add keyword` phrase, with single spaces. A figure is allowed: it only bars the target. */
const SeedKeywordSchema = z
  .string()
  .transform((phrase) => phrase.trim().replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(CASE_SEED_KEYWORD_MIN, `Each keyword needs at least ${CASE_SEED_KEYWORD_MIN} characters`)
      .max(CASE_SEED_KEYWORD_MAX, `Keep each keyword to ${CASE_SEED_KEYWORD_MAX} characters`),
  )

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
  /** Phrases the research run measures as keywords beside what it finds (decision 468). */
  seedKeywords: z
    .array(SeedKeywordSchema)
    .max(CASE_SEED_KEYWORDS_MAX, `Give at most ${CASE_SEED_KEYWORDS_MAX} seed keywords`)
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
      seedKeywords: CaseFormSchema.shape.seedKeywords.unwrap().optional(),
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
  const maxMin = format.runtime.max
  let runtime: number
  if (targetRuntimeMin === undefined) {
    runtime = Math.min(Math.max(format.runtime.default, format.runtime.min), maxMin)
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
    // Always the resolved key: left unset, the column default (`main`) would win over the primary.
    formatKey: format.key,
    // The verdict is frozen with this channel's pillar labels and research thresholds.
    verdictContext: {
      pillarLabels: Object.fromEntries(channel.bible.caseCategories.map((c) => [c.key, c.label])),
      thresholds: await channelResearchThresholds(db, channel.id),
    },
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

/**
 * What a run costs: more when the case's format (against the channel's current
 * bible) has a lead keyword, and 5 for the subject phrase and each seed keyword.
 */
function researchCredits(
  channel: { bible: { formats: readonly ChannelFormat[] } } | null,
  existing: {
    formatKey: string | null
    people: readonly string[]
    subject: string | null
    seedKeywords: readonly string[]
  },
): number {
  const formats = channel?.bible.formats ?? []
  const hasFormatSeed =
    formats.length > 0 && leadKeyword(resolveFormat(formats, existing.formatKey)) !== null
  return caseResearchCredits({
    formatSeed: hasFormatSeed,
    people: existing.people.length,
    exactPhrases: exactPhrases(existing.subject ?? '', existing.seedKeywords).length,
  })
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

export type RateAnglesEstimate =
  { ok: true; usd: number; model: string } | { ok: false; error: string }

/** What `Rate the angles` would cost, for the button's label. Spends nothing. */
export async function rateAnglesEstimate(caseId: string): Promise<RateAnglesEstimate> {
  await requireOwner()
  if (!UlidSchema.safeParse(caseId).success) return { ok: false, error: 'Unknown case' }
  const channel = await channelForCase(db, caseId)
  if (!channel) return { ok: false, error: 'That case no longer exists' }
  const settings = await getChannelSettings(db, channel.id)
  const { settings: workspace } = await getWorkspace(db)
  const route = settings.modelRouting.research
  return {
    ok: true,
    usd: rateAnglesEstimateUsd(settings, workspace),
    model: canonicalModelId(route.provider, route.model),
  }
}

/**
 * `Rate the angles`: ask the model which of the brief's angles to recommend and
 * save the pick. The save refuses, writing nothing, if the options changed
 * while the model was answering.
 */
export async function rateAnglesAction(caseId: string): Promise<ActionResult> {
  await requireOwner()
  const refusal = await writableCase(caseId)
  if (refusal) return refusal
  const existing = await getCase(db, caseId)
  if (!existing) return { ok: false, error: 'That case no longer exists' }
  const brief = existing.searchBrief
  if (!brief || brief.angleOptions.length < 2) {
    return { ok: false, error: 'There are no angles to rate' }
  }
  // The same comparison the brief panel makes: an edited subject orphans the brief.
  if (
    existing.subject === null ||
    brief.subject.trim().toLowerCase() !== existing.subject.trim().toLowerCase()
  ) {
    return { ok: false, error: 'This research is for another subject. Research again first.' }
  }
  if (existing.searchJob && caseResearchJobIsRunning(existing.searchJob)) return RESEARCH_RUNNING

  // The refusal above proved the channel exists.
  const channel = await channelForCase(db, caseId)
  if (!channel) return { ok: false, error: 'That case no longer exists' }
  let result: Awaited<ReturnType<typeof rateAngles>>
  try {
    result = await rateAngles(
      brief,
      await currentBible(db, channel.id),
      completeForChannel(channel.id, { estimateOutputTokens: RATE_ANGLES_OUTPUT_TOKENS }),
    )
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, error: error.message }
    throw error
  }
  if (!result.ok) return { ok: false, error: result.error }

  const saved = await saveCaseAngleRating(db, caseId, {
    // The options the model saw: the save refuses if the brief no longer holds exactly these.
    options: brief.angleOptions.map((option) => option.angle),
    ...result.rating,
  })
  if (!saved) {
    return {
      ok: false,
      error: 'The angles changed while they were being rated. Rate them again.',
    }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

const AngleChoiceSchema = z.union([
  z.object({ option: z.number().int().min(0).max(2) }).strict(),
  z.object({ own: z.string().trim().min(1, 'Write your angle first').max(2000) }).strict(),
])

/**
 * `Use this angle` and `Keep my own angle`: settle the case's angle from its
 * brief. An option can also move the target keyword; `targetChange` says how.
 */
export async function chooseAngleAction(
  caseId: string,
  choice: { option: number } | { own: string },
): Promise<ActionResult & { targetChange?: TargetChange }> {
  await requireOwner()
  const refusal = await writableCase(caseId)
  if (refusal) return refusal
  const parsed = AngleChoiceSchema.safeParse(choice)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'That angle is not valid' }
  }
  let targetChange: TargetChange
  try {
    targetChange = (await chooseCaseAngle(db, caseId, parsed.data)).targetChange
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not set the angle' }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true, targetChange }
}

/** The VidIQ credits each on-demand check costs, for the buttons' labels. */
export type EvidenceEstimate =
  { ok: true; credits: { whoRanks: 5; angleTest: 5 } } | { ok: false; error: string }

/** What `Check who ranks now` and `Test this angle` cost. Spends nothing. */
export async function evidenceEstimate(caseId: string): Promise<EvidenceEstimate> {
  await requireOwner()
  if (!UlidSchema.safeParse(caseId).success) return { ok: false, error: 'Unknown case' }
  if (!(await getCase(db, caseId))) return { ok: false, error: 'That case no longer exists' }
  return { ok: true, credits: { whoRanks: 5, angleTest: 5 } }
}

/** The case and channel an on-demand check runs against, or the refusal. */
async function evidenceCase(caseId: string) {
  const refusal = await writableCase(caseId)
  if (refusal) return { ok: false as const, error: refusal.error ?? 'That case cannot be changed' }
  const existing = await getCase(db, caseId)
  const channel = await channelForCase(db, caseId)
  if (!existing || !channel) return { ok: false as const, error: 'That case no longer exists' }
  return { ok: true as const, existing, channelId: channel.id }
}

/** `Check who ranks now`: buy the top ten for the target keyword and keep it on the brief. */
export async function checkWhoRanksAction(caseId: string): Promise<ActionResult> {
  await requireOwner()
  const checked = await evidenceCase(caseId)
  if (!checked.ok) return checked
  const { existing, channelId } = checked
  const target = existing.searchBrief?.targetKeyword
  if (!target) return { ok: false, error: 'There is no target keyword to check' }
  const wanted = target.keyword.trim().toLowerCase()
  if (
    (existing.searchBrief?.fieldChecks ?? []).some((c) => c.keyword.trim().toLowerCase() === wanted)
  ) {
    return { ok: false, error: 'Who ranks is already checked for this keyword' }
  }
  if (existing.searchJob && caseResearchJobIsRunning(existing.searchJob)) return RESEARCH_RUNNING

  let check: Awaited<ReturnType<typeof searchField>>
  try {
    check = await searchField(target.keyword, channelId)
  } catch (error) {
    if (error instanceof CapReached) return { ok: false, error: error.message }
    throw error
  }
  const saved = await saveCaseFieldCheck(db, caseId, check)
  if (!saved) {
    return { ok: false, error: 'The research changed while this was running. Check again.' }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

const NICHE_STILL_RUNNING =
  'The test is still running at VidIQ and has been paid for. Press Test this angle again in a minute to collect it; that costs nothing.'

/**
 * `Test this angle`: start a niche test for one angle option, wait for it and
 * keep the result. A test that outlasts the wait is paid for, so its job is
 * kept on the brief; the next press only polls that job (free) for thirty
 * minutes instead of buying again.
 */
/**
 * `collect` is set when the owner confirmed "Collect the angle test", whose
 * consequence promised it free. A pending job that expired while the panel
 * sat open must not then be replaced by a paid one: the action refuses, and
 * the refreshed panel offers the paid test with its cost.
 */
export async function testAngleAction(
  caseId: string,
  option: number,
  intent: { collect?: boolean } = {},
): Promise<ActionResult> {
  await requireOwner()
  const checked = await evidenceCase(caseId)
  if (!checked.ok) return checked
  const { existing, channelId } = checked
  const brief = existing.searchBrief
  const chosen = Number.isInteger(option) ? brief?.angleOptions[option] : undefined
  if (!brief || !chosen) return { ok: false, error: 'There is no angle there' }
  if (!brief.niche) {
    return { ok: false, error: 'This brief has no niche to test against. Research again first.' }
  }
  if (existing.searchJob && caseResearchJobIsRunning(existing.searchJob)) return RESEARCH_RUNNING

  const pending = pendingNicheJob(brief, chosen.angle)
  if (intent.collect && !pending) {
    revalidatePath('/c/[slug]', 'layout')
    return {
      ok: false,
      error:
        'The earlier test is more than 30 minutes old, so collecting it is no longer free. Press Test this angle to buy a new one.',
    }
  }
  let jobId: string
  let wait: Awaited<ReturnType<typeof awaitNicheTest>>
  try {
    jobId =
      pending?.jobId ??
      (await startNicheTest(
        {
          niche: brief.niche,
          idea: chosen.angle,
          ...(brief.language ? { language: brief.language } : {}),
        },
        channelId,
      ))
    wait = await awaitNicheTest(jobId, chosen.angle)
  } catch (error) {
    if (error instanceof CapReached) return { ok: false, error: error.message }
    throw error
  }
  if (wait.state === 'running') {
    const kept = await saveCaseNicheJob(db, caseId, {
      angle: chosen.angle,
      jobId,
      startedAt: pending?.startedAt ?? new Date().toISOString(),
    })
    if (!kept) {
      return { ok: false, error: 'The research changed while this was running. Test again.' }
    }
    revalidatePath('/c/[slug]', 'layout')
    return { ok: false, error: NICHE_STILL_RUNNING }
  }
  if (wait.state === 'failed') {
    if (pending) {
      await dropCaseNicheJob(db, caseId, chosen.angle)
      revalidatePath('/c/[slug]', 'layout')
      return {
        ok: false,
        error:
          'The earlier angle test failed at VidIQ. Press Test this angle again to buy a new one.',
      }
    }
    return {
      ok: false,
      error:
        'The angle test did not finish. Try again later; any unused credits are refunded by VidIQ.',
    }
  }
  const saved = await saveCaseNicheTest(db, caseId, wait.test)
  if (!saved) {
    return { ok: false, error: 'The research changed while this was running. Test again.' }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/**
 * `Add keyword` (decision 468): measure one phrase the owner types (one VidIQ
 * keyword call, 5 credits) and put it on the brief's other keywords as theirs,
 * where `Make target` can promote it. It is kept as a seed keyword too, so the
 * next research run measures and judges it with the rest. Every refusal comes
 * before the purchase.
 */
export async function addCaseKeywordAction(caseId: string, phrase: unknown): Promise<ActionResult> {
  await requireOwner()
  const checked = await evidenceCase(caseId)
  if (!checked.ok) return checked
  const { existing, channelId } = checked
  const parsed = SeedKeywordSchema.safeParse(typeof phrase === 'string' ? phrase : '')
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Type a keyword to add' }
  }
  const brief = existing.searchBrief
  if (!brief) return { ok: false, error: 'Research this case first, then add keywords to it' }
  if (briefPhrases(brief).has(phraseKey(parsed.data))) {
    return { ok: false, error: 'That keyword is already on this brief' }
  }
  if (brief.secondaryKeywords.filter((k) => k.owner).length >= CASE_SEED_KEYWORDS_MAX) {
    return {
      ok: false,
      error: `You can add at most ${CASE_SEED_KEYWORDS_MAX} keywords of your own`,
    }
  }
  if (existing.searchJob && caseResearchJobIsRunning(existing.searchJob)) return RESEARCH_RUNNING

  let row: Awaited<ReturnType<typeof measureKeyword>>
  try {
    row = await measureKeyword(parsed.data, channelId)
  } catch (error) {
    if (error instanceof CapReached) return { ok: false, error: error.message }
    throw error
  }
  if (!row) {
    return {
      ok: false,
      error: `VidIQ returned no figures for that phrase. The ${EXACT_KEYWORD_CREDITS} credits were spent.`,
    }
  }
  const added = await addCaseOwnerKeyword(db, caseId, row)
  if (added === 'present') {
    return {
      ok: false,
      error: `VidIQ reads that phrase as "${row.keyword}", already on this brief`,
    }
  }
  if (added !== 'added') {
    return {
      ok: false,
      error: 'The research changed while this was running. Add the keyword again.',
    }
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
