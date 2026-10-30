'use server'

import {
  BibleDraftBlockedError,
  BibleDraftBusyError,
  discardBibleDraft,
  getBibleDraft,
  getWorkspace,
  openBibleDraft,
  saveBibleDraft,
  vidiqCredential,
  vidiqCreditsThisMonth,
  writeBibleDraft,
} from '@boom-busters/db'
import { estimateResearchCredits, vidiqClientFor } from '@boom-busters/providers/vidiq'
import {
  BIBLE_SECTIONS,
  BIBLE_SECTION_ORDER,
  BibleDraftInputsSchema,
  ChannelBibleSchema,
  EXAMPLE_SLOT_IDS,
  UlidSchema,
  bibleDraftUnits,
  jobIsRunning,
} from '@boom-busters/schemas'
import type {
  BibleDraft,
  BibleDraftUnit,
  BibleSection,
  ChannelBible,
  TooCloseFlags,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { BIBLE_ENTRY_LISTS, errorSection, flagSection } from '@/lib/bible-draft-keys'
import { overlapFlag, overlapSources } from '@/lib/bible-overlap-sources'
import { researchPlanFor } from '@/lib/bible-research'
import { channelWriteRefusal } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
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

  const apiKey = await vidiqCredential(db, env.SECRETS_ENCRYPTION_KEY)
  const client = vidiqClientFor(apiKey)
  if (!client) return { ok: false, error: 'Add a VidIQ key in Settings, Connections' }

  try {
    const plan = await researchPlanFor(channelId, parsed.data)
    if ('error' in plan) return { ok: false, error: plan.error }
    const estimate = estimateResearchCredits(plan)

    let balance: number
    try {
      balance = (await client.balance()).totalCredits
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: `VidIQ did not answer: ${message}` }
    }

    const { settings } = await getWorkspace(db)
    const cap = settings.vidiq.monthlyCreditCap
    const capLeft = Math.max(0, cap - (await vidiqCreditsThisMonth(db)))
    if (estimate > capLeft) {
      return {
        ok: false,
        error: `This run needs about ${estimate} credits; ${capLeft} are left of this month's cap of ${cap}.`,
      }
    }
    if (estimate > balance) {
      return {
        ok: false,
        error: `This run needs about ${estimate} credits; the VidIQ balance is ${balance}.`,
      }
    }
    return { ok: true, estimate, balance, capLeft }
  } finally {
    await client.close()
  }
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

  const open = await openBibleDraft(db, channelId)
  if (open.job && jobIsRunning(open.job)) return BUSY

  const checked = await checkResearch(channelId, inputs)
  if (!checked.ok) return checked
  const parsed = BibleDraftInputsSchema.parse(inputs)

  try {
    await writeBibleDraft(db, channelId, (draft) => ({
      ...draft,
      inputs: parsed,
      job: {
        kind: 'research',
        state: 'running',
        current: null,
        error: null,
        startedAt: new Date().toISOString(),
      },
    }))
  } catch (error) {
    if (error instanceof BibleDraftBusyError) return BUSY
    throw error
  }

  try {
    await inngest.send(events.bibleResearchRequested.create({ channelId }))
  } catch (error) {
    console.error('[bible] could not send the research run', error)
    // Nothing is running: say so, or the draft stays locked until the job goes stale.
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        job: {
          kind: 'research',
          state: 'failed',
          current: null,
          error: 'The research run could not be started',
          startedAt: draft.job?.startedAt ?? new Date().toISOString(),
        },
      }),
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

  const open = await openBibleDraft(db, channelId)
  if (open.job && jobIsRunning(open.job)) return BUSY

  let inputs = open.inputs
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

  try {
    await writeBibleDraft(db, channelId, (draft) => ({
      ...draft,
      inputs,
      job: {
        kind: 'draft',
        state: 'running',
        current: null,
        error: null,
        startedAt: new Date().toISOString(),
      },
    }))
  } catch (error) {
    if (error instanceof BibleDraftBusyError) return BUSY
    throw error
  }

  try {
    await inngest.send(
      events.bibleDraftRequested.create({ channelId, units, ...(steer ? { steer } : {}) }),
    )
  } catch (error) {
    console.error('[bible] could not send the drafting run', error)
    // Nothing is running: say so, or the draft stays locked until the job goes stale.
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        job: {
          kind: 'draft',
          state: 'failed',
          current: null,
          error: 'The drafting run could not be started',
          startedAt: draft.job?.startedAt ?? new Date().toISOString(),
        },
      }),
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
      ? Object.entries(bible.examples).map(([id, text]) => [`examples.${id}`, text])
      : BIBLE_ENTRY_LISTS.flatMap((list) =>
          bible[list].map((entry, i): [string, string] => [`${list}.${i}`, entry.text]),
        )
  for (const [path, text] of fields) {
    const found = overlapFlag(path, text, sources)
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

/** Approve a drafted section as it stands; refused while a field in it is too close to its source. */
export async function approveBibleSectionAction(
  channelId: string,
  section: BibleSection,
): Promise<ActionResult & { draft?: BibleDraft }> {
  await requireOwner()
  if (!BIBLE_SECTION_ORDER.includes(section)) return { ok: false, error: 'Unknown section' }
  const open = await openForChange(channelId)
  if (!open.ok) return open
  if (Object.keys(open.draft.tooClose).some((path) => flagSection(path) === section)) {
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
