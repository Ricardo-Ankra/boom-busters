'use server'

import {
  BibleDraftBlockedError,
  BibleDraftBusyError,
  BibleDraftExistsError,
  BibleDraftStaleError,
  bibleVersionById,
  currentBible,
  discardBibleDraft,
  getBibleDraft,
  keywordsToMeasure,
  latestKeywordMeasurements,
  latestSearchSpace,
  openBibleDraft,
  restoreBibleVersion,
  saveBibleDraft,
  searchSpaceKeywords,
  writeBibleDraft,
} from '@boom-busters/db'
import { composeStagePrompt } from '@boom-busters/providers/preview'
import { VIDIQ_CREDIT_COST, estimateResearchCredits } from '@boom-busters/providers/vidiq'
import {
  BIBLE_SECTIONS,
  BIBLE_SECTION_ORDER,
  BibleDraftInputsSchema,
  ChannelBibleSchema,
  EXAMPLE_SLOT_IDS,
  EXAMPLE_SLOTS,
  PREVIEW_STAGES,
  SEARCH_BRIEF_STALE_DAYS,
  UlidSchema,
  bibleDraftUnits,
  jobIsRunning,
  liveFlags,
} from '@boom-busters/schemas'
import type {
  BibleDraft,
  BibleDraftUnit,
  BibleSection,
  ChannelBible,
  PreviewStage,
  TooCloseFlags,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { BIBLE_ENTRY_LISTS, errorSection, flagSection } from '@/lib/bible-draft-keys'
import { overlapFlag, overlapSources } from '@/lib/bible-overlap-sources'
import { researchPlanFor } from '@/lib/bible-research'
import { channelWriteRefusal, findChannel } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import { checkVidiqBudget } from '@/lib/vidiq-spend'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import type { ActionResult } from './actions'

/**
 * The bible drafting actions: research first (this file), drafting after. Each
 * is a POST endpoint of its own, so each re-checks the session.
 */

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

const BUSY: ActionResult = {
  ok: false,
  error: "A run is already working on this channel's draft.",
}

type Estimate =
  { ok: true; estimate: number; balance: number; capLeft: number } | { ok: false; error: string }

/** The checks both actions make: the key, the inputs, the plan, the balance and the monthly cap. */
async function checkResearch(channelId: string, input: unknown): Promise<Estimate> {
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  const parsed = BibleDraftInputsSchema.safeParse(input)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid input',
    }
  }

  const plan = await researchPlanFor(channelId, parsed.data)
  if ('error' in plan) return { ok: false, error: plan.error }
  const estimate = estimateResearchCredits(plan)

  const budget = await checkVidiqBudget(estimate)
  if (!budget.ok) return budget
  return { ok: true, estimate, balance: budget.balance, capLeft: budget.capLeft }
}

/** What the research would cost, before the owner commits to it. Spends nothing. */
export async function estimateBibleResearchAction(
  channelId: string,
  inputs: unknown,
): Promise<Estimate> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  return checkResearch(channelId, inputs)
}

/**
 * Save the inputs on the channel's draft, mark the research running and send
 * the run. Every check is made again here: the estimate on screen may be old.
 */
export async function startBibleResearchAction(
  channelId: string,
  inputs: unknown,
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  // Every refusal comes before the draft is opened, so a refused action leaves none behind.
  const existing = await getBibleDraft(db, channelId)
  if (existing?.job && jobIsRunning(existing.job)) return BUSY

  const checked = await checkResearch(channelId, inputs)
  if (!checked.ok) return checked
  const parsed = BibleDraftInputsSchema.parse(inputs)

  await openBibleDraft(db, channelId)
  const startedAt = new Date().toISOString()
  try {
    await writeBibleDraft(db, channelId, (draft) => ({
      ...draft,
      inputs: parsed,
      job: { kind: 'research', state: 'running', current: null, error: null, startedAt },
    }))
  } catch (error) {
    if (error instanceof BibleDraftBusyError) return BUSY
    throw error
  }

  try {
    await inngest.send(events.bibleResearchRequested.create({ channelId, jobStartedAt: startedAt }))
  } catch (error) {
    console.error('[bible] could not send the research run', error)
    // Nothing is running: say so, or the draft stays locked until the job goes stale.
    await writeBibleDraft(
      db,
      channelId,
      (draft) =>
        draft.job?.startedAt === startedAt
          ? {
              ...draft,
              job: {
                ...draft.job,
                state: 'failed',
                current: null,
                error: 'The research run could not be started',
              },
            }
          : draft,
      { allowWhileRunning: true },
    )
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the research. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  return { ok: true }
}

/**
 * Draft the bible without VidIQ (inputs, every section), redraft one or more
 * sections with an optional steer, or draft one example slot. Saves `inputs`
 * when given, marks the draft's job running (refused while one runs) and sends
 * the run.
 */
export async function draftBibleAction(
  channelId: string,
  request: {
    inputs?: unknown
    sections?: BibleSection[]
    slotId?: string
    steer?: string
  },
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  const steer = request.steer?.trim() || undefined
  if (steer && steer.length > 1000) return { ok: false, error: 'The steer is over 1000 characters' }

  let units: BibleDraftUnit[]
  if (request.slotId !== undefined) {
    if (!(EXAMPLE_SLOT_IDS as readonly string[]).includes(request.slotId)) {
      return { ok: false, error: 'Unknown example' }
    }
    units = [{ section: 'examples', slotId: request.slotId }]
  } else {
    const sections = request.sections ?? BIBLE_SECTION_ORDER
    if (sections.some((section) => !BIBLE_SECTION_ORDER.includes(section))) {
      return { ok: false, error: 'Unknown section' }
    }
    units = bibleDraftUnits(sections)
    if (units.length === 0) return { ok: false, error: 'Choose a section to draft' }
  }

  // Every refusal comes before the draft is opened, so a refused action leaves none behind.
  const existing = await getBibleDraft(db, channelId)
  if (existing?.job && jobIsRunning(existing.job)) return BUSY

  let inputs = existing?.inputs ?? null
  if (request.inputs !== undefined) {
    const parsed = BibleDraftInputsSchema.safeParse(request.inputs)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return {
        ok: false,
        error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid input',
      }
    }
    inputs = parsed.data
  }
  if (!inputs) return { ok: false, error: 'Describe the channel first' }

  await openBibleDraft(db, channelId)
  const startedAt = new Date().toISOString()
  try {
    await writeBibleDraft(db, channelId, (draft) => ({
      ...draft,
      inputs,
      // The units and steer stay on the job, so Try again resends exactly them.
      job: {
        kind: 'draft',
        state: 'running',
        current: null,
        error: null,
        startedAt,
        heartbeatAt: startedAt,
        units,
        ...(steer ? { steer } : {}),
      },
    }))
  } catch (error) {
    if (error instanceof BibleDraftBusyError) return BUSY
    throw error
  }

  try {
    await inngest.send(
      events.bibleDraftRequested.create({
        channelId,
        units,
        jobStartedAt: startedAt,
        ...(steer ? { steer } : {}),
      }),
    )
  } catch (error) {
    console.error('[bible] could not send the drafting run', error)
    // Nothing is running: say so, or the draft stays locked until the job goes stale.
    await writeBibleDraft(
      db,
      channelId,
      (draft) =>
        draft.job?.startedAt === startedAt
          ? {
              ...draft,
              job: {
                ...draft.job,
                state: 'failed',
                current: null,
                error: 'The drafting run could not be started',
              },
            }
          : draft,
      { allowWhileRunning: true },
    )
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the drafting. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  return { ok: true }
}

const WAIT = { ok: false as const, error: 'Wait for the draft to finish' }

/** The draft, or the reason an owner's change to it must not go ahead. */
type Opened = { ok: true; draft: BibleDraft } | { ok: false; error: string }

/**
 * The checks every owner change makes: the id, the archived guard and a job
 * running. The first change opens the draft; `needDraft` refuses to make one.
 */
async function openForChange(channelId: string, needDraft = false): Promise<Opened> {
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal
  const draft = needDraft ? await getBibleDraft(db, channelId) : await openBibleDraft(db, channelId)
  if (!draft) return { ok: false, error: 'There is no draft to change' }
  if (draft.job && jobIsRunning(draft.job)) return WAIT
  return { ok: true, draft }
}

/** Runs a draft change, turning a job that started meanwhile into the refusal. */
async function writeChange(
  channelId: string,
  change: (draft: BibleDraft) => BibleDraft,
): Promise<ActionResult & { draft?: BibleDraft }> {
  try {
    return { ok: true, draft: await writeBibleDraft(db, channelId, change) }
  } catch (error) {
    if (error instanceof BibleDraftBusyError) return WAIT
    throw error
  }
}

/** The section's flags, recomputed from the text it now holds: a field that still overlaps keeps its flag. */
async function recheckedFlags(
  channelId: string,
  draft: BibleDraft,
  section: BibleSection,
  bible: ChannelBible,
): Promise<TooCloseFlags> {
  const flags: TooCloseFlags = Object.fromEntries(
    Object.entries(draft.tooClose).filter(([path]) => flagSection(path) !== section),
  )
  if (section !== 'examples' && section !== 'hooks') return flags

  const sources = await overlapSources(channelId, draft)
  const fields: [string, string][] =
    section === 'examples'
      ? EXAMPLE_SLOTS.filter((slot) => slot.id in bible.examples).map((slot): [string, string] => [
          `examples.${slot.id}`,
          bible.examples[slot.id]!,
        ])
      : BIBLE_ENTRY_LISTS.flatMap((list) =>
          bible[list].map((entry, i): [string, string] => [`${list}.${i}`, entry.text]),
        )
  for (const [path, text] of fields) {
    const found = overlapFlag(text, sources)
    if (found) flags[path] = found
  }
  return flags
}

/**
 * Save the owner's edit of one section. The patch holds only that section's
 * keys, is checked against the bible's own schema, replaces those fields and
 * counts as the owner's approval. The overlap check runs again on the examples
 * and entries, so pasting a source back in does not pass.
 */
export async function editBibleSectionAction(
  channelId: string,
  section: BibleSection,
  patch: unknown,
): Promise<ActionResult & { draft?: BibleDraft }> {
  await requireOwner()
  if (!BIBLE_SECTION_ORDER.includes(section)) return { ok: false, error: 'Unknown section' }
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return { ok: false, error: 'That change is not valid' }
  }
  const keys = BIBLE_SECTIONS[section]
  const stray = Object.keys(patch).find((key) => !(keys as readonly string[]).includes(key))
  if (stray) return { ok: false, error: `${stray} is not part of this section` }

  // Checked before the draft is opened, so a refused first edit leaves none behind.
  const mask = Object.fromEntries(Object.keys(patch).map((key) => [key, true])) as {
    [K in keyof ChannelBible]?: true
  }
  const parsed = ChannelBibleSchema.pick(mask).strict().safeParse(patch)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'That change is not valid',
    }
  }

  const open = await openForChange(channelId)
  if (!open.ok) return open
  const tooClose = await recheckedFlags(channelId, open.draft, section, {
    ...open.draft.bible,
    ...parsed.data,
  })

  return writeChange(channelId, (draft) => {
    const errors = Object.fromEntries(
      Object.entries(draft.errors).filter(([key]) => errorSection(key) !== section),
    )
    return {
      ...draft,
      bible: { ...draft.bible, ...parsed.data },
      statuses: { ...draft.statuses, [section]: 'approved' },
      tooClose,
      errors,
    }
  })
}

/**
 * Replace the chosen sections of the working draft with the source channel's
 * current saved version of those keys. Nothing is saved as a version: each
 * copied section is marked drafted, so it needs the owner's Approve (or an
 * edit) first. The source may be archived; the target may not.
 */
export async function copyBibleFromChannelAction(
  channelId: string,
  sourceChannelId: string,
  sections: unknown,
): Promise<ActionResult & { draft?: BibleDraft; note?: string }> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  if (!UlidSchema.safeParse(sourceChannelId).success) {
    return { ok: false, error: 'Unknown channel' }
  }
  if (sourceChannelId === channelId) return { ok: false, error: 'Choose another channel' }

  const ticked = Array.isArray(sections) ? sections : []
  if (ticked.length === 0) return { ok: false, error: 'Tick at least one section' }
  if (ticked.some((section) => !BIBLE_SECTION_ORDER.includes(section as BibleSection))) {
    return { ok: false, error: 'Unknown section' }
  }
  const chosen = BIBLE_SECTION_ORDER.filter((section) => ticked.includes(section))

  // Every refusal comes before the draft is opened, so a refused copy leaves none behind.
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal
  const source = await findChannel(sourceChannelId)
  if (!source) return { ok: false, error: 'Unknown channel' }
  const existing = await getBibleDraft(db, channelId)
  if (existing?.job && jobIsRunning(existing.job)) return WAIT
  const version = await currentBible(db, sourceChannelId)

  const open = await openForChange(channelId)
  if (!open.ok) return open

  const copied: Partial<Record<keyof ChannelBible, unknown>> = {}
  for (const section of chosen) {
    for (const key of BIBLE_SECTIONS[section]) copied[key] = version.bible[key]
  }
  const next = { ...open.draft.bible, ...copied } as ChannelBible

  let tooClose = open.draft.tooClose
  for (const section of chosen) {
    tooClose = await recheckedFlags(channelId, { ...open.draft, tooClose }, section, next)
  }

  const result = await writeChange(channelId, (draft) => ({
    ...draft,
    bible: { ...draft.bible, ...copied } as ChannelBible,
    statuses: {
      ...draft.statuses,
      ...Object.fromEntries(chosen.map((section) => [section, 'drafted' as const])),
    },
    tooClose,
    errors: Object.fromEntries(
      Object.entries(draft.errors).filter(([key]) => {
        const section = errorSection(key)
        return !section || !chosen.includes(section)
      }),
    ),
  }))
  if (!result.ok) return result
  revalidatePath('/c/[slug]', 'layout')
  return { ...result, note: `Copied from ${source.name} version ${version.version}` }
}

/** Approve a drafted section as it stands; refused while a field in it is too close to its source. */
export async function approveBibleSectionAction(
  channelId: string,
  section: BibleSection,
): Promise<ActionResult & { draft?: BibleDraft }> {
  await requireOwner()
  if (!BIBLE_SECTION_ORDER.includes(section)) return { ok: false, error: 'Unknown section' }
  const open = await openForChange(channelId)
  if (!open.ok) return open
  if (Object.keys(liveFlags(open.draft.tooClose)).some((path) => flagSection(path) === section)) {
    return { ok: false, error: 'Change the lines that are too close to their source first' }
  }
  return writeChange(channelId, (draft) => ({
    ...draft,
    statuses: { ...draft.statuses, [section]: 'approved' },
  }))
}

/**
 * Turn the approved draft into the channel's next version. The note defaults
 * to how the draft was made: by AI when it holds research, the inputs it was
 * drafted from or a section still marked drafted.
 */
export async function saveBibleAction(
  channelId: string,
  note: string,
): Promise<ActionResult & { blockers?: string[] }> {
  await requireOwner()
  const open = await openForChange(channelId, true)
  if (!open.ok) return open

  const { draft } = open
  const byAi =
    draft.research !== null ||
    draft.inputs !== null ||
    Object.values(draft.statuses).some((status) => status === 'drafted')
  const text = note.trim().slice(0, 300) || (byAi ? 'Drafted with AI' : 'Edited in the Bible tab')

  try {
    await saveBibleDraft(db, channelId, text)
  } catch (error) {
    if (error instanceof BibleDraftBlockedError) {
      return { ok: false, error: 'The draft cannot be saved yet', blockers: error.blockers }
    }
    if (error instanceof BibleDraftStaleError) return { ok: false, error: error.message }
    if (error instanceof BibleDraftBusyError) return WAIT
    throw error
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/** Throw the working draft away; the channel keeps its current version. */
export async function discardBibleDraftAction(channelId: string): Promise<ActionResult> {
  await requireOwner()
  const open = await openForChange(channelId, true)
  if (!open.ok) return open
  try {
    await discardBibleDraft(db, channelId)
  } catch (error) {
    if (error instanceof BibleDraftBusyError) return WAIT
    throw error
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/**
 * Append an earlier version as the channel's next one. Refused while a draft
 * is open: the draft's base would go stale under the restore.
 */
export async function restoreBibleVersionAction(
  channelId: string,
  versionId: string,
): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  if (!UlidSchema.safeParse(versionId).success) return { ok: false, error: 'Unknown version' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal
  try {
    await restoreBibleVersion(db, channelId, versionId)
  } catch (error) {
    if (error instanceof BibleDraftExistsError) {
      return { ok: false, error: 'Save or discard the draft first' }
    }
    return { ok: false, error: error instanceof Error ? error.message : 'Could not restore' }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/** One saved version's bible, for the read-only view in the history. */
export async function viewBibleVersionAction(
  channelId: string,
  versionId: string,
): Promise<{ ok: true; bible: ChannelBible } | { ok: false; error: string }> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  if (!UlidSchema.safeParse(versionId).success) return { ok: false, error: 'Unknown version' }
  try {
    const version = await bibleVersionById(db, versionId)
    if (version.channelId !== channelId) return { ok: false, error: 'Unknown version' }
    return { ok: true, bible: version.bible }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not load' }
  }
}

/**
 * The system prompt a stage sends for this bible, composed from the draft as
 * it stands. Spends nothing: it only fills the builder's template.
 */
export async function previewStagePromptAction(
  channelId: string,
  stage: string,
  bible: unknown,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  if (!(PREVIEW_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: 'Unknown stage' }
  }
  const parsed = ChannelBibleSchema.strict().safeParse(bible)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'The bible is not valid',
    }
  }
  const channel = await findChannel(channelId)
  if (!channel) return { ok: false, error: 'Unknown channel' }
  try {
    return { ok: true, text: composeStagePrompt(stage as PreviewStage, parsed.data, channel.name) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not compose' }
  }
}

/**
 * Measure the bible's format and pillar keywords in VidIQ: the draft's when one
 * is open, else the current version's, leaving out any keyword read within the
 * stale window. The cap and the balance are checked first; the readings arrive
 * as the run finishes. Returns the credits the run is expected to cost.
 */
export async function measureKeywordsAction(
  channelId: string,
): Promise<{ ok: true; credits: number } | { ok: false; error: string }> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  const draft = await getBibleDraft(db, channelId)
  const bible = draft?.bible ?? (await currentBible(db, channelId)).bible
  const keywords = keywordsToMeasure(
    bible,
    await latestKeywordMeasurements(db, channelId),
    new Date(),
  )
  if (keywords.length === 0) {
    return {
      ok: false,
      error: `Every keyword was measured in the last ${SEARCH_BRIEF_STALE_DAYS} days`,
    }
  }

  const credits = keywords.length * VIDIQ_CREDIT_COST.keywordResearch
  const budget = await checkVidiqBudget(credits)
  if (!budget.ok) return budget

  try {
    await inngest.send(events.keywordsMeasure.create({ channelId, keywords }))
  } catch (error) {
    console.error('[bible] could not send the keyword measurement', error)
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the measurement. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true, credits }
}

/**
 * Analyse one format's search space in VidIQ: outliers for each of its
 * keywords (the draft's when one is open, else the current version's), leaving
 * out any analysed within the stale window. The cap and the balance are
 * checked first; the results arrive as the run finishes. Returns the credits
 * the run is expected to cost.
 */
export async function analyseSearchSpaceAction(
  channelId: string,
  formatKey: string,
): Promise<{ ok: true; credits: number } | { ok: false; error: string }> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return { ok: false, error: 'Unknown channel' }
  const refusal = await channelWriteRefusal(channelId)
  if (refusal) return refusal

  const draft = await getBibleDraft(db, channelId)
  const bible = draft?.bible ?? (await currentBible(db, channelId)).bible
  const format = bible.formats.find((candidate) => candidate.key === formatKey)
  if (!format) return { ok: false, error: 'Unknown format' }

  const keywords = searchSpaceKeywords(
    format.keywords,
    await latestSearchSpace(db, channelId),
    new Date(),
  )
  if (keywords.length === 0) {
    return {
      ok: false,
      error:
        format.keywords.length === 0
          ? 'This format has no keywords to analyse'
          : `Every keyword of this format was analysed in the last ${SEARCH_BRIEF_STALE_DAYS} days`,
    }
  }

  // Outliers, then the top ten's details.
  const credits = keywords.length * (VIDIQ_CREDIT_COST.outliers + VIDIQ_CREDIT_COST.getVideosByIds)
  const budget = await checkVidiqBudget(credits)
  if (!budget.ok) return budget

  try {
    await inngest.send(events.searchSpaceAnalyse.create({ channelId, keywords }))
  } catch (error) {
    console.error('[bible] could not send the search-space analysis', error)
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the analysis. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true, credits }
}
