'use server'

import { createHash } from 'node:crypto'
import {
  chooseSlotCandidate,
  getProject,
  getSettings,
  getShotSlot,
  retypeShotSlot,
  setSlotResolution,
  setSlotRetype,
  shotBriefHash,
  updateSlotBrief,
  upsertAssetByHash,
} from '@boom-busters/db'
import { stillStyleAnchors } from '@boom-busters/providers'
import {
  convertBrief,
  HERO_SLOTS_ENABLED,
  ShotBriefSchema,
  ShotSlotTypeSchema,
  SlotCandidateSchema,
  UlidSchema,
} from '@boom-busters/schemas'
import type { SlotCandidate } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { events } from '@/inngest/events'
import { inngest } from '@/inngest/client'
import { db } from '@/lib/db'
import { putObject, R2_PREFIX, storageConfigured } from '@/lib/storage'

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
  const project = await getProject(db, projectId)
  if (project?.visualsPhase !== 'board') {
    refresh(projectId)
    return { ok: true }
  }

  const sent = await sendRefetch(projectId, slotId, 'Brief edited')
  refresh(projectId)
  return sent
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

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }
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

/** Client-side limit repeated server-side: a poster frame, not a media file. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

const UPLOAD_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/**
 * `Upload own` — images only, deliberately. Video uploads would stream media
 * bytes through the app layer, which the architecture forbids (product spec:
 * "the web layer never touches a video byte"); a poster image is small enough
 * to be the exception the narration WAVs already are.
 */
export async function uploadOwnAction(formData: FormData): Promise<ActionResult> {
  await requireOwner()

  const projectId = String(formData.get('projectId') ?? '')
  const slotId = String(formData.get('slotId') ?? '')
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'No file arrived.' }

  const extension = UPLOAD_TYPES[file.type]
  if (!extension) {
    return { ok: false, error: 'Only PNG, JPEG or WebP images can be uploaded here.' }
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'That file is over the 8 MB limit for board images.' }
  }
  if (!storageConfigured()) {
    return {
      ok: false,
      error: 'Uploads need R2 configured — there is nowhere to store the image.',
    }
  }

  const slot = await getShotSlot(db, slotId)
  if (!slot) return { ok: false, error: 'This slot no longer exists.' }

  const bytes = Buffer.from(await file.arrayBuffer())
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  const key = `${R2_PREFIX}/uploads/${projectId}/${contentHash}.${extension}`
  await putObject(key, bytes, file.type)

  const asset = await upsertAssetByHash(db, {
    kind: 'image',
    r2Key: key,
    licence: 'Uploaded by owner',
    contentHash,
  })

  const candidate: SlotCandidate = SlotCandidateSchema.parse({
    id: `upload-${contentHash.slice(0, 12)}`,
    provider: 'upload',
    kind: 'image',
    sourceUrl: `upload://${contentHash}`,
    assetId: asset.id,
    r2Key: key,
    licence: asset.licence,
    summary: file.name,
    chosen: true,
  })

  // The upload joins the strip and wins the choice; fetched candidates stay
  // for comparison, un-chosen.
  const existing = Array.isArray(slot.candidates) ? slot.candidates : []
  const others = existing
    .map((entry) => SlotCandidateSchema.safeParse(entry))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter((entry) => entry.id !== candidate.id)
    .map(({ chosen: _chosen, ...rest }) => rest)

  await setSlotResolution(db, slotId, {
    candidates: [candidate, ...others],
    status: 'resolved',
    chosenAssetId: asset.id,
    // The upload answers the CURRENT brief: without the fingerprint, the
    // next "Fetch visuals" would treat this slot as owed and fetch over it.
    briefHash: shotBriefHash(slot.brief),
  })

  refresh(projectId)
  return { ok: true }
}
