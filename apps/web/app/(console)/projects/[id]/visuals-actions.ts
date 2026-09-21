'use server'

import {
  chooseSlotCandidate,
  getArticleSource,
  getClaim,
  getProject,
  getSettings,
  getShotSlot,
  linkSlotReuse,
  listSlotDependants,
  scriptableClaims,
  setArticleSourceManual,
  retypeShotSlot,
  setProjectDirection,
  setSlotResolution,
  setSlotRetype,
  setSlotRoute,
  unlinkSlotReuse,
  updateSlotBrief,
  upsertAssetByHash,
} from '@boom-busters/db'
import { imageGenModel, LIVE_IMAGE_GEN_ADAPTERS, stillStyleAnchors } from '@boom-busters/providers'
import {
  articleIsRenderable,
  claimCarriesArticle,
  convertBrief,
  DirectorsBookSchema,
  emphasisFits,
  HERO_SLOTS_ENABLED,
  normaliseArticleUrl,
  REUSABLE_SLOT_TYPES,
  ShotBriefSchema,
  ShotSlotTypeSchema,
  SlotCandidateSchema,
  StillRouteSchema,
  UlidSchema,
} from '@boom-busters/schemas'
import type { ShotSlotRow } from '@boom-busters/db'
import type { HeadlineBrief, ShotBrief, SlotCandidate, StillRoute } from '@boom-busters/schemas'
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { events } from '@/inngest/events'
import { inngest } from '@/inngest/client'
import { articleFromRow, refetchArticle } from '@/lib/article-source'
import { db } from '@/lib/db'
import { fetchRemoteImage } from '@/lib/remote-image'
import {
  deleteObject,
  headObject,
  presignPut,
  putObject,
  R2_PREFIX,
  storageConfigured,
} from '@/lib/storage'
import { timecode } from '@/lib/visuals-reuse'

/**
 * The visual board's buttons (build spec section 11.3): select a candidate,
 * edit the brief and re-fetch, regenerate, upload your own.
 *
 * Selection and brief edits apply directly — they move no money. Re-fetch and
 * regenerate go through `visuals/refetch.requested`, so the work happens in
 * the slot-refetcher with the cost guard around it, never in a request
 * handler racing a timeout.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<string> {
  const session = await auth()
  const email = session?.user?.email
  if (!email) throw new Error('Not signed in')
  return email
}

function badIds(...ids: string[]): ActionResult | null {
  return ids.every((id) => UlidSchema.safeParse(id).success)
    ? null
    : { ok: false, error: 'Unknown id' }
}

function refresh(projectId: string): void {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
}

/**
 * The refusal every fetch-shaped action gives a linked slot (decision 261).
 * The board hides those buttons; this is for a screen that went stale.
 */
async function linkedSlotRefusal(slot: ShotSlotRow): Promise<ActionResult | null> {
  if (!slot.reuseOfSlotId) return null
  const source = await getShotSlot(db, slot.reuseOfSlotId)
  const at = source ? ` at ${timecode(source.startMs)}` : ''
  return { ok: false, error: `This slot reuses the shot${at}. Choose its own shot first.` }
}

/**
 * The rules of a reuse link (decision 261), in one place: the slot and the
 * shot it picked, or the refusal. A pick that is itself a dependant
 * re-points to the original, so the chip always names the shot that was
 * paid for and no chain can form.
 */
async function reuseSource(
  projectId: string,
  slotId: string,
  sourceSlotId: string,
): Promise<{ slot: ShotSlotRow; source: ShotSlotRow } | { error: string }> {
  if (slotId === sourceSlotId) return { error: 'A slot cannot reuse its own shot.' }
  const [slot, picked] = await Promise.all([getShotSlot(db, slotId), getShotSlot(db, sourceSlotId)])
  if (!slot) return { error: 'This slot no longer exists.' }
  if (!picked) return { error: 'The shot you picked no longer exists.' }
  if (slot.projectId !== projectId || picked.projectId !== projectId) {
    return { error: 'Shots can only be reused within the same film.' }
  }
  if (!REUSABLE_SLOT_TYPES.includes(slot.type) || !REUSABLE_SLOT_TYPES.includes(picked.type)) {
    return {
      error: 'Only stock, AI image and real-footage slots can reuse a shot or be reused.',
    }
  }
  // No chains from the target side either: a slot other slots show cannot
  // itself point elsewhere, or a two-step link forms that the copy pass has
  // to chase. Its dependants get their own shots first.
  if ((await listSlotDependants(db, slotId)).length > 0) {
    return { error: "Other slots show this slot's shot. Give them their own shot first." }
  }
  const source = picked.reuseOfSlotId ? await getShotSlot(db, picked.reuseOfSlotId) : picked
  if (!source) return { error: 'The shot you picked no longer exists.' }
  if (source.id === slotId) return { error: 'A slot cannot reuse its own shot.' }
  return { slot, source }
}

/**
 * "Use an existing shot" (decision 261). Before Fetch the link is recorded
 * and the fan-out's copy step fills it; on the board the named candidate,
 * or the source's chosen one, is copied at once. A board-phase source with
 * nothing to copy is not offered by the picker; a stale screen that asks
 * anyway gets words, not a link nothing will fill.
 */
export async function reuseSlotShotAction(
  projectId: string,
  slotId: string,
  sourceSlotId: string,
  candidateId?: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId, sourceSlotId)
  if (invalid) return invalid

  const checked = await reuseSource(projectId, slotId, sourceSlotId)
  if ('error' in checked) return { ok: false, error: checked.error }

  const held = checked.source.candidates as unknown as SlotCandidate[]
  const chosen = candidateId ?? held.find((candidate) => candidate.chosen)?.id
  const project = await getProject(db, projectId)
  if (project?.visualsPhase === 'board' && chosen === undefined) {
    return {
      ok: false,
      error: 'That slot has no shot to reuse yet. Fetch or regenerate it first.',
    }
  }

  const linked = await linkSlotReuse(db, slotId, checked.source.id, chosen)
  if (!linked) return { ok: false, error: 'The shot you picked no longer exists.' }
  refresh(projectId)
  return { ok: true }
}

/** "Choose its own shot": the link goes and the next fetch pass owes the slot work again. */
export async function unlinkSlotReuseAction(
  projectId: string,
  slotId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  if (!slot.reuseOfSlotId) return { ok: true }

  await unlinkSlotReuse(db, slotId)
  refresh(projectId)
  return { ok: true }
}

export async function chooseCandidateAction(
  projectId: string,
  slotId: string,
  candidateId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid
  if (candidateId.trim() === '') return { ok: false, error: 'Unknown candidate' }

  const updated = await chooseSlotCandidate(db, slotId, candidateId)
  if (!updated) return { ok: false, error: 'That candidate is no longer on this slot.' }

  refresh(projectId)
  return { ok: true }
}

/** The editable half of each brief type — creative direction, not structure. */
const BriefPatchSchema = z.object({
  description: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  negativePrompt: z.string().optional(),
  mustShow: z.string().min(1).optional(),
})

export async function editBriefAction(
  projectId: string,
  slotId: string,
  patch: unknown,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const parsedPatch = BriefPatchSchema.safeParse(patch)
  if (!parsedPatch.success) return { ok: false, error: 'That edit is not valid.' }

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }

  const current = ShotBriefSchema.safeParse(slot.brief)
  if (!current.success) {
    return { ok: false, error: 'This brief is broken and cannot be edited — regenerate the board.' }
  }

  // Merge only the fields this type actually has; then the WHOLE brief must
  // re-validate, so an edit can never store a shape the schema forbids.
  const merged = ShotBriefSchema.safeParse({ ...current.data, ...cleanPatch(parsedPatch.data) })
  if (!merged.success) return { ok: false, error: 'That edit does not fit this slot type.' }

  await updateSlotBrief(db, slotId, merged.data)

  // Phase-aware (staged-visuals design): during plan review an edit just
  // saves — nothing is fetched until "Fetch visuals". On the board it
  // refetches, because the owner is looking at candidates for the old words.
  // Archival never refetches (decision 214): its brief is guidance for the
  // human's own search, and there is nothing on the other end to call.
  const project = await getProject(db, projectId)
  // A linked slot's picture is another slot's (decision 261): its words save
  // and nothing is fetched, in either phase.
  if (project?.visualsPhase !== 'board' || merged.data.type === 'archival' || slot.reuseOfSlotId) {
    refresh(projectId)
    return { ok: true }
  }

  const sent = await sendRefetch(projectId, slotId, 'Brief edited')
  refresh(projectId)
  return sent
}

/**
 * Store or clear the model one still or hero slot generates on (decision
 * 264). No event goes out: the route is part of the resolution hash, so the
 * slot simply owes work again, and re-buying it is the owner's own Regenerate
 * button to press, not something this action decides for them.
 */
export async function setSlotRouteAction(
  projectId: string,
  slotId: string,
  route: { provider: string; model: string } | null,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  let parsedRoute: StillRoute | null = null
  if (route !== null) {
    const parsed = StillRouteSchema.safeParse(route)
    if (!parsed.success) return { ok: false, error: 'That is not a model this app offers.' }
    parsedRoute = parsed.data
  }

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  if (slot.projectId !== projectId)
    return { ok: false, error: 'This slot belongs to another film.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked

  const current = ShotBriefSchema.safeParse(slot.brief)
  if (!current.success || (current.data.type !== 'still' && current.data.type !== 'hero')) {
    return { ok: false, error: 'Only a still or AI-video slot generates on a chosen model.' }
  }

  if (parsedRoute) {
    try {
      imageGenModel(LIVE_IMAGE_GEN_ADAPTERS[parsedRoute.provider], parsedRoute.model)
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'That model is not offered.',
      }
    }
  }

  await setSlotRoute(db, slotId, parsedRoute)
  refresh(projectId)
  return { ok: true }
}

/**
 * "Fetch visuals" — the plan checkpoint's one primary button. Wakes the
 * visuals-runner parked on `visuals/plan.approved`; the runner fetches only
 * the slots the no-waste guard says are owed.
 */
export async function approvePlanAction(projectId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'This project no longer exists.' }
  if (project.visualsPhase !== 'plan') {
    return { ok: false, error: 'The plan checkpoint is not open on this project.' }
  }

  try {
    await inngest.send(events.visualsPlanApproved.create({ projectId }))
  } catch (error) {
    console.error('[visuals] could not send plan approval', error)
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the fetch. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  refresh(projectId)
  return { ok: true }
}

/**
 * The format picker: still → stock, stock → map, … The suggested type is a
 * suggestion, not a lock.
 *
 * Two speeds, honestly split (fixed 2026-08-26 — the event-for-everything
 * version made every switch look broken, because the button returned before
 * the retyper had written anything):
 *
 * - **Text-driven targets convert right here.** `convertBrief` is pure and
 *   moves no money — the same class of write as a brief edit, which this file
 *   already applies directly. The badge changes on the click that asked.
 * - **Chart and map need a model draft**, which belongs in the slot-retyper
 *   behind the cost guard, never in a request handler racing a timeout. The
 *   slot is stamped `drafting` before the event goes, so the card can say
 *   what is happening — and say why, if the model refuses.
 */
export async function retypeSlotAction(
  projectId: string,
  slotId: string,
  targetType: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const parsedType = ShotSlotTypeSchema.safeParse(targetType)
  if (!parsedType.success) return { ok: false, error: 'That is not a slot type.' }
  if (parsedType.data === 'hero' && !HERO_SLOTS_ENABLED) {
    return { ok: false, error: 'AI-video slots are disabled.' }
  }
  if (parsedType.data === 'headline') {
    /**
     * Which article a card quotes is not derivable from the old brief, and no
     * model may choose one (decision 257). The board opens its chooser and
     * calls `retypeToHeadlineAction` with the answer; a call that arrives here
     * anyway is a stale client, and gets words rather than a `drafting` stamp
     * no model call will ever clear.
     */
    return { ok: false, error: 'Pick which article this card quotes.' }
  }

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked
  if (slot.type === parsedType.data) return { ok: true }

  const current = ShotBriefSchema.safeParse(slot.brief)
  if (!current.success) {
    return {
      ok: false,
      error: 'This brief is broken and cannot be re-typed — regenerate the board.',
    }
  }

  const settings = await getSettings(db)
  const mechanical = convertBrief(current.data, parsedType.data, {
    stillStyleAnchors: stillStyleAnchors(settings.brandKit),
  })

  if (mechanical) {
    await retypeShotSlot(db, slotId, parsedType.data, mechanical)

    // Phase-aware, like a brief edit: on the board the owner is looking at
    // candidates for the old kind of shot, so fetch new ones now; during
    // plan review nothing is fetched until "Fetch visuals".
    const project = await getProject(db, projectId)
    if (project?.visualsPhase === 'board') {
      const sent = await sendRefetch(projectId, slotId, `Format changed to ${parsedType.data}`)
      refresh(projectId)
      return sent
    }
    refresh(projectId)
    return { ok: true }
  }

  // Chart or map: stamp the visible state FIRST, so the board the button's
  // own refresh renders already says "drafting".
  await setSlotRetype(db, slotId, { state: 'drafting', target: parsedType.data })
  try {
    await inngest.send(
      events.visualsRetypeRequested.create({ projectId, slotId, targetType: parsedType.data }),
    )
  } catch (error) {
    console.error('[visuals] could not send retype', error)
    await setSlotRetype(db, slotId, null)
    return {
      ok: false,
      error:
        'Could not reach Inngest to re-type this slot. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  refresh(projectId)
  return { ok: true }
}

/**
 * Re-type a slot into a headline card quoting the article the owner picked
 * (decision 257).
 *
 * Its own action rather than an argument to `retypeSlotAction`, because this
 * is the one conversion that carries a decision: which claim. Past that it is
 * as mechanical as still → stock, so it applies inside the button press and
 * never stamps `drafting` — there is no model call to wait for, and none to
 * pay for. The claim is looked up among THIS project's un-quarantined claims,
 * which checks in one read that it exists, belongs here, and carries an
 * article the card is allowed to quote.
 */
export async function retypeToHeadlineAction(
  projectId: string,
  slotId: string,
  claimId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId, claimId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked

  const current = ShotBriefSchema.safeParse(slot.brief)
  if (!current.success) {
    return {
      ok: false,
      error: 'This brief is broken and cannot be re-typed — regenerate the board.',
    }
  }

  // Already quoting it: the board marks that row rather than offering it, and
  // rewriting the brief would clear the resolution and read the article again
  // for nothing.
  if (current.data.type === 'headline' && current.data.sourceClaimId === claimId) {
    return { ok: true }
  }

  const claim = (await scriptableClaims(db, projectId)).find((row) => row.id === claimId)
  if (!claimCarriesArticle(claim)) {
    return {
      ok: false,
      error: 'That claim has no news article behind it, so a card cannot quote it.',
    }
  }

  const brief = convertBrief(current.data, 'headline', { headlineClaimId: claimId })
  if (!brief) return { ok: false, error: 'This slot cannot become a headline card.' }

  await retypeShotSlot(db, slotId, 'headline', brief)

  // Phase-aware, exactly as the mechanical conversions are: on the board the
  // article is read now, during plan review nothing is fetched until the
  // owner presses "Fetch visuals".
  const project = await getProject(db, projectId)
  if (project?.visualsPhase === 'board') {
    const sent = await sendRefetch(projectId, slotId, 'Re-typed to a headline card')
    refresh(projectId)
    return sent
  }
  refresh(projectId)
  return { ok: true }
}

/** What the owner may type into the steer, repeated server-side. */
const GuidanceSchema = z.string().trim().max(600).optional()

/**
 * "Draft a different brief" (decision 258): the owner has rejected this
 * slot's idea and wants another, optionally saying what they are picturing.
 *
 * Always an event, never a write here: this is a model call, so it belongs in
 * the slot-rebriefer behind the cost guard, not in a request handler racing a
 * timeout. The slot is stamped before the event goes, so the board the
 * button's own refresh renders already says what is happening.
 */
export async function rebriefSlotAction(
  projectId: string,
  slotId: string,
  guidance: unknown,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const parsedGuidance = GuidanceSchema.safeParse(guidance)
  if (!parsedGuidance.success) {
    return { ok: false, error: 'Keep the steer under 600 characters.' }
  }
  const steer = parsedGuidance.data === '' ? undefined : parsedGuidance.data

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked

  const current = ShotBriefSchema.safeParse(slot.brief)
  if (!current.success) {
    return {
      ok: false,
      error: 'This brief is broken and cannot be re-drafted — regenerate the board.',
    }
  }
  if (current.data.type === 'headline') {
    return {
      ok: false,
      error:
        'Every word on a headline card is read from the article. Change which article it quotes instead.',
    }
  }
  if (current.data.type === 'hero') {
    return { ok: false, error: 'An AI-video slot cannot be re-drafted.' }
  }

  await setSlotRetype(db, slotId, { state: 'rebriefing' })
  try {
    await inngest.send(
      events.visualsRebriefRequested.create({
        projectId,
        slotId,
        ...(steer === undefined ? {} : { guidance: steer }),
      }),
    )
  } catch (error) {
    console.error('[visuals] could not send rebrief', error)
    await setSlotRetype(db, slotId, null)
    return {
      ok: false,
      error:
        'Could not reach Inngest to draft a new brief. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  refresh(projectId)
  return { ok: true }
}

/** Dismiss a refused re-type — the slot keeps its old brief, the note goes. */
export async function dismissRetypeAction(
  projectId: string,
  slotId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }

  await setSlotRetype(db, slotId, null)
  refresh(projectId)
  return { ok: true }
}

function cleanPatch(patch: z.infer<typeof BriefPatchSchema>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined && value !== ''),
  ) as Record<string, string>
}

/**
 * The headline card's own fields (decision 257).
 *
 * Two stores in one save, because it is one card to the owner: the article's
 * facts go to the article record (shared by every shot citing that piece), and
 * the marker phrase and standfirst toggle go to the brief (this shot's own
 * editorial choices). An empty string clears a field.
 */
const HeadlineEditSchema = z.object({
  outlet: z.string().trim().max(120),
  headline: z.string().trim().max(400),
  author: z.string().trim().max(200),
  /** YYYY-MM-DD, or empty. The PUBLICATION date, never the date you read it. */
  publishedAt: z.string().trim().max(10),
  description: z.string().trim().max(400),
  emphasis: z.string().trim().max(120),
  showDeck: z.boolean(),
})

/** The claim a headline slot cites, and the article URL behind it. */
async function headlineSource(
  slotId: string,
): Promise<
  | { brief: HeadlineBrief; url: string; slot: { brief: unknown; route: unknown } }
  | { error: string }
> {
  const slot = await getShotSlot(db, slotId)
  if (!slot) return { error: 'This slot no longer exists.' }

  const parsed = ShotBriefSchema.safeParse(slot.brief)
  if (!parsed.success || parsed.data.type !== 'headline') {
    return { error: 'This is not a headline slot.' }
  }

  const claim = await getClaim(db, parsed.data.sourceClaimId)
  const url =
    claim?.sourceUrl === null || claim === undefined ? null : normaliseArticleUrl(claim.sourceUrl)
  if (url === null) {
    return { error: 'The claim this card cites no longer has a source to read.' }
  }
  // The row itself travels too: the resolution stamp is taken over the
  // stored brief and route, never over the parsed copy (decision 264).
  return { brief: parsed.data, url, slot: { brief: slot.brief, route: slot.route } }
}

export async function saveHeadlineAction(
  projectId: string,
  slotId: string,
  input: unknown,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const parsed = HeadlineEditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'That edit is not valid.' }
  const fields = parsed.data

  if (fields.publishedAt !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(fields.publishedAt)) {
    return { ok: false, error: 'The publication date must be written as YYYY-MM-DD.' }
  }
  // The marker draws under words the card is showing, so a phrase that is not
  // in the headline is refused rather than silently dropped: the owner typed
  // it and deserves to know it did not take.
  if (fields.emphasis !== '' && !emphasisFits(fields.headline, fields.emphasis)) {
    return {
      ok: false,
      error: 'The highlighted phrase has to appear in the headline, word for word.',
    }
  }

  const source = await headlineSource(slotId)
  if ('error' in source) return { ok: false, error: source.error }

  const blank = (value: string): string | null => (value === '' ? null : value)
  const record = await setArticleSourceManual(db, source.url, {
    outlet: blank(fields.outlet),
    headline: blank(fields.headline),
    author: blank(fields.author),
    publishedAt: blank(fields.publishedAt),
    description: blank(fields.description),
  })

  const brief: ShotBrief = {
    ...source.brief,
    ...(fields.emphasis === '' ? {} : { emphasis: fields.emphasis }),
    ...(fields.showDeck ? { showDeck: true } : {}),
  }
  if (fields.emphasis === '') delete (brief as { emphasis?: string }).emphasis
  if (!fields.showDeck) delete (brief as { showDeck?: boolean }).showDeck
  await updateSlotBrief(db, slotId, brief)

  // A card with its facts filled in is resolved, whatever the fetch said.
  // The stamp answers the row as the database now holds it, which is the
  // brief just written (decision 264).
  const written = await getShotSlot(db, slotId)
  await setSlotResolution(
    db,
    slotId,
    articleIsRenderable(articleFromRow(record))
      ? {
          candidates: [],
          status: 'resolved',
          answered: { brief: written?.brief ?? brief, route: written?.route ?? null },
        }
      : { candidates: [], status: 'placeholder' },
  )

  refresh(projectId)
  return { ok: true }
}

/**
 * Read the article again. Refuses a record the owner has corrected, because a
 * fetch would throw away the one version of these facts somebody checked.
 */
export async function refetchArticleAction(
  projectId: string,
  slotId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const source = await headlineSource(slotId)
  if ('error' in source) return { ok: false, error: source.error }

  const before = await getArticleSource(db, source.url)
  if (before?.status === 'manual') {
    return {
      ok: false,
      error: 'You have already corrected this article by hand, so a re-fetch would undo your work.',
    }
  }

  const article = await refetchArticle(source.url)
  await setSlotResolution(
    db,
    slotId,
    articleIsRenderable(article)
      ? {
          candidates: [],
          status: 'resolved',
          answered: { brief: source.slot.brief, route: source.slot.route },
        }
      : { candidates: [], status: 'placeholder' },
  )

  refresh(projectId)
  return article.status === 'failed'
    ? { ok: false, error: article.failureReason ?? 'The article could not be read.' }
    : { ok: true }
}

export async function refetchSlotAction(
  projectId: string,
  slotId: string,
  note: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked

  // Real footage has nothing to fetch (decision 214). The board hides the
  // button, but an action is a POST endpoint of its own.
  if ((slot.brief as { type?: string } | null)?.type === 'archival') {
    return {
      ok: false,
      error:
        'Real-footage slots are not fetched — the brief guides your own search. Upload the ' +
        'image or clip instead.',
    }
  }

  const sent = await sendRefetch(projectId, slotId, note.trim() || 'Another pass')
  refresh(projectId)
  return sent
}

async function sendRefetch(projectId: string, slotId: string, note: string): Promise<ActionResult> {
  try {
    await inngest.send(events.visualsRefetchRequested.create({ projectId, slotId, note }))
    return { ok: true }
  } catch (error) {
    console.error('[visuals] could not send refetch', error)
    return {
      ok: false,
      error:
        'Could not reach Inngest to re-fetch this slot. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
}

/** Client-side limits repeated server-side. */
const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024
// Not exported: a 'use server' module may only export async functions.
const MAX_UPLOAD_VIDEO_BYTES = 200 * 1024 * 1024

const UPLOAD_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** Video is legal ONLY on archival slots — real footage is their point. */
const UPLOAD_VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
}

/**
 * What one slot may receive, given its brief. Archival slots take real
 * footage — image or video (decision 214); every other visual slot takes a
 * poster image only. Video through the app layer would have violated the
 * architecture ("the web layer never touches a video byte"), but the
 * presigned browser → R2 path (decision 213) means the app never touches
 * these bytes at all — the rule survives, the capability arrives.
 */
function uploadRules(
  slotBrief: unknown,
  fileType: string,
): { extension: string; kind: 'image' | 'video'; maxBytes: number } | { error: string } {
  const briefType = (slotBrief as { type?: string } | null)?.type
  const archival = briefType === 'archival'

  const imageExt = UPLOAD_IMAGE_TYPES[fileType]
  if (imageExt) return { extension: imageExt, kind: 'image', maxBytes: MAX_UPLOAD_IMAGE_BYTES }

  const videoExt = UPLOAD_VIDEO_TYPES[fileType]
  if (videoExt && archival) {
    return { extension: videoExt, kind: 'video', maxBytes: MAX_UPLOAD_VIDEO_BYTES }
  }
  if (videoExt) {
    return {
      error:
        'Video uploads belong to real-footage (archival) slots. This slot takes PNG, JPEG or ' +
        'WebP images.',
    }
  }
  return {
    error: archival
      ? 'Only PNG, JPEG or WebP images, or MP4, MOV or WebM video, can be uploaded here.'
      : 'Only PNG, JPEG or WebP images can be uploaded here.',
  }
}

/**
 * `Upload own` — the bytes go browser → R2 directly, in two actions
 * (decision 213, the exact decision-205 shape): a single action carrying the
 * file dies at Vercel's ~4.5 MB edge cap (Next refuses over 1 MB) before any
 * validation runs. The browser asks for a presigned PUT URL, uploads to R2
 * itself, then asks for the row; the server recomputes the key from the
 * fingerprint and verifies the object landed at a legal size before
 * anything is recorded.
 */
export async function createOwnUploadAction(input: {
  projectId: string
  slotId: string
  fileType: string
  fileSize: number
  contentHash: string
}): Promise<ActionResult & { url?: string; key?: string }> {
  await requireOwner()

  const invalid = badIds(input.projectId, input.slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, input.slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked

  const rules = uploadRules(slot.brief, input.fileType)
  if ('error' in rules) return { ok: false, error: rules.error }

  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: 'That file looks empty.' }
  }
  if (input.fileSize > rules.maxBytes) {
    return {
      ok: false,
      error: `That file is over the ${Math.round(rules.maxBytes / 1024 / 1024)} MB limit.`,
    }
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (!storageConfigured()) {
    return {
      ok: false,
      error: 'Uploads need R2 configured — there is nowhere to store the file.',
    }
  }

  const key = `${R2_PREFIX}/uploads/${input.projectId}/${input.contentHash}.${rules.extension}`
  return { ok: true, url: await presignPut(key, input.fileType), key }
}

export async function finaliseOwnUploadAction(input: {
  projectId: string
  slotId: string
  fileType: string
  fileName: string
  contentHash: string
  /**
   * Video metadata, read by the browser from the file it uploaded. Trusted
   * for what it is used for (timeline maths in a single-owner console);
   * existence and size are verified against the bucket regardless.
   */
  durationMs?: number
  width?: number
  height?: number
}): Promise<ActionResult> {
  await requireOwner()

  const invalid = badIds(input.projectId, input.slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, input.slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked

  const rules = uploadRules(slot.brief, input.fileType)
  if ('error' in rules) return { ok: false, error: rules.error }

  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (!storageConfigured()) {
    return {
      ok: false,
      error: 'Uploads need R2 configured — there is nowhere to store the file.',
    }
  }

  // The key is recomputed, never taken from the caller — this flow can only
  // ever record an object it issued the URL for. Verified against the
  // bucket: the row is a promise the board can display this file.
  const contentHash = input.contentHash
  const key = `${R2_PREFIX}/uploads/${input.projectId}/${contentHash}.${rules.extension}`
  const head = await headObject(key)
  if (!head) {
    return { ok: false, error: 'The upload never arrived in storage. Try again.' }
  }
  if (head.size > rules.maxBytes) {
    await deleteObject(key)
    return {
      ok: false,
      error: `That file is over the ${Math.round(rules.maxBytes / 1024 / 1024)} MB limit.`,
    }
  }
  const dims = {
    ...(input.width && input.width > 0 ? { width: Math.round(input.width) } : {}),
    ...(input.height && input.height > 0 ? { height: Math.round(input.height) } : {}),
    ...(rules.kind === 'video' && input.durationMs && input.durationMs > 0
      ? { durationMs: Math.round(input.durationMs) }
      : {}),
  }
  return attachOwnFile({
    projectId: input.projectId,
    slot,
    key,
    contentHash,
    kind: rules.kind,
    summary: input.fileName,
    dims,
  })
}

/**
 * Record an object in the bucket as this slot's chosen candidate.
 *
 * Shared by the two ways a file arrives — the browser's presigned upload and
 * a pasted web address (decision 214, amended) — because everything from the
 * asset row onwards is identical and two copies of it would drift.
 */
async function attachOwnFile(input: {
  projectId: string
  slot: Awaited<ReturnType<typeof getShotSlot>> & object
  key: string
  contentHash: string
  kind: 'image' | 'video'
  summary: string
  dims: { width?: number; height?: number; durationMs?: number }
  /** Where a pasted image came from; absent for a file off the producer's disk. */
  sourceUrl?: string
}): Promise<ActionResult> {
  const asset = await upsertAssetByHash(db, {
    kind: input.kind,
    r2Key: input.key,
    licence: 'Uploaded by owner',
    contentHash: input.contentHash,
    ...input.dims,
  })

  const candidate: SlotCandidate = SlotCandidateSchema.parse({
    id: `upload-${input.contentHash.slice(0, 12)}`,
    provider: 'upload',
    kind: input.kind,
    // The address is kept as provenance where there is one; the bytes in R2
    // are what the render reads either way.
    sourceUrl: input.sourceUrl ?? `upload://${input.contentHash}`,
    assetId: asset.id,
    r2Key: input.key,
    licence: asset.licence,
    summary: input.summary,
    chosen: true,
    ...input.dims,
  })

  // The upload joins the strip and wins the choice; fetched candidates stay
  // for comparison, un-chosen.
  const existing = Array.isArray(input.slot.candidates) ? input.slot.candidates : []
  const others = existing
    .map((entry) => SlotCandidateSchema.safeParse(entry))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter((entry) => entry.id !== candidate.id)
    .map(({ chosen: _chosen, ...rest }) => rest)

  await setSlotResolution(db, input.slot.id, {
    candidates: [candidate, ...others],
    status: 'resolved',
    chosenAssetId: asset.id,
    // An upload answers the brief the slot already carries; nothing here
    // rewrites it.
    answered: { brief: input.slot.brief, route: input.slot.route },
  })

  refresh(input.projectId)
  return { ok: true }
}

/**
 * The same thing by web address rather than by file (decision 214, amended):
 * real footage is usually found online, and saving it first only to upload it
 * is a step for nothing.
 *
 * Images only. Video is legal on archival slots by file, but pulling 200 MB
 * through the server is exactly the byte handling decision 213 removed, and
 * the presigned path exists for it.
 */
export async function addSlotImageFromUrlAction(input: {
  projectId: string
  slotId: string
  url: string
}): Promise<ActionResult> {
  await requireOwner()

  const invalid = badIds(input.projectId, input.slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, input.slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked
  if (!storageConfigured()) {
    return { ok: false, error: 'Uploads need R2 configured — there is nowhere to store the file.' }
  }

  const fetched = await fetchRemoteImage(input.url, { maxBytes: MAX_UPLOAD_IMAGE_BYTES })
  if (!fetched.ok) return { ok: false, error: fetched.error }
  const { bytes, mimeType, width, height, resolvedUrl } = fetched.image

  // Run it past the slot's own rules, so an address cannot put an image
  // somewhere a file of the same type could not go.
  const rules = uploadRules(slot.brief, mimeType)
  if ('error' in rules) return { ok: false, error: rules.error }

  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const key = `${R2_PREFIX}/uploads/${input.projectId}/${contentHash}.${rules.extension}`
  try {
    await putObject(key, bytes, mimeType)
  } catch {
    return { ok: false, error: 'That image could not be saved to storage. Try again.' }
  }

  return attachOwnFile({
    projectId: input.projectId,
    slot,
    key,
    contentHash,
    kind: 'image',
    summary: new URL(resolvedUrl).pathname.split('/').pop() || resolvedUrl,
    dims: { width, height },
    sourceUrl: resolvedUrl,
  })
}

// ---------------------------------------------------------------------------
// Direction (decision 252): the Director's Book on the plan screen
// ---------------------------------------------------------------------------

/** Save the owner's edited Director's Book. Free; the next re-plan reads it. */
export async function saveDirectionAction(projectId: string, book: unknown): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'This project no longer exists.' }
  if (project.visualsPhase !== 'plan') {
    return { ok: false, error: 'Direction is edited at the plan checkpoint only.' }
  }

  const parsed = DirectorsBookSchema.safeParse(book)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: `That direction does not validate: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'unknown'}`,
    }
  }

  await setProjectDirection(db, projectId, parsed.data)
  refresh(projectId)
  return { ok: true }
}

/** Redraft the book with one model call. The owner's edits are replaced. */
export async function redraftDirectionAction(projectId: string): Promise<ActionResult> {
  return sendReplan(projectId, 'direction')
}

/** Plan every chapter again from the saved book. Pre-fetched slots are discarded. */
export async function replanShotsAction(projectId: string): Promise<ActionResult> {
  return sendReplan(projectId, 'shots')
}

async function sendReplan(projectId: string, op: 'direction' | 'shots'): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'This project no longer exists.' }
  if (project.visualsPhase !== 'plan') {
    return { ok: false, error: 'The plan checkpoint is not open on this project.' }
  }

  try {
    await inngest.send(events.visualsReplanRequested.create({ projectId, op }))
  } catch (error) {
    console.error('[visuals] could not send replan', error)
    return {
      ok: false,
      error:
        'Could not reach Inngest to re-plan. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  refresh(projectId)
  return { ok: true }
}

/**
 * "Redirect the scene" (decision 252): an image model refused this still,
 * so the slot-redirector asks for the same beat without the likeness. The
 * work happens behind the cost guard, never in the request handler.
 */
export async function redirectSceneAction(
  projectId: string,
  slotId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
  const linked = await linkedSlotRefusal(slot)
  if (linked) return linked
  if ((slot.brief as { type?: string } | null)?.type !== 'still') {
    return { ok: false, error: 'Only an AI image slot can be redirected.' }
  }

  try {
    await inngest.send(events.visualsRedirectRequested.create({ projectId, slotId }))
  } catch (error) {
    console.error('[visuals] could not send redirect', error)
    return {
      ok: false,
      error:
        'Could not reach Inngest to redirect this scene. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
  refresh(projectId)
  return { ok: true }
}
