'use server'

/**
 * The Set card's actions (decision 264). Deliberately `cast-actions.ts` with
 * different nouns, including the two-step presigned upload, because the
 * bytes cannot travel through the app: Vercel rejects a body over about
 * 4.5 MB (decision 205).
 */

import {
  dismissProjectSet,
  getProject,
  getProjectSet,
  getSettings,
  insertProjectSet,
  setSetPlates,
  updateProjectSet,
} from '@boom-busters/db'
import { stillStyleAnchors } from '@boom-busters/providers'
import {
  castPhotoExtension,
  CastPhotoMimeSchema,
  MAX_SET_PLATES,
  SetPlateViewSchema,
  UlidSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { SetPlate, SetPlateView, SlotCandidate, StillBrief } from '@boom-busters/schemas'
import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { fetchRemoteImage } from '@/lib/remote-image'
import {
  deleteObject,
  getObjectBytes,
  headObject,
  presignPut,
  putObject,
  setPlateKey,
  stillKey,
  storageConfigured,
} from '@/lib/storage'
import { generateStillCandidates } from '@/lib/visual-assets'

export interface ActionResult {
  ok: boolean
  error?: string
}

/** A set's reference plates are photographs like the cast's; the same 15 MB ceiling applies. */
const MAX_SET_PLATE_BYTES = 15 * 1024 * 1024

/**
 * Where this project's generated stills live, taken from the key helper
 * itself so there is one spelling of the prefix in the app.
 */
function projectStillsPrefix(projectId: string): string {
  const key = stillKey({ projectId, contentHash: 'x' })
  return key.slice(0, key.lastIndexOf('/') + 1)
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
}

function failure(error: unknown, fallback: string): ActionResult {
  if (error instanceof ValidationError) return { ok: false, error: error.message }
  // Drizzle wraps the driver's error; the unique violation sits in the cause.
  const cause = error instanceof Error ? (error.cause as { code?: string } | undefined) : undefined
  const text = [error, cause].map((e) => (e instanceof Error ? e.message : '')).join(' ')
  if (cause?.code === '23505' || /unique|duplicate/i.test(text)) {
    return { ok: false, error: 'A set with that exact name already exists.' }
  }
  return { ok: false, error: fallback }
}

export async function addSetAction(
  projectId: string,
  input: { name: string; look: string },
): Promise<ActionResult & { id?: string }> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid
  if (!(await getProject(db, projectId)))
    return { ok: false, error: 'This project no longer exists.' }
  try {
    const set = await insertProjectSet(db, { projectId, ...input })
    refresh(projectId)
    return { ok: true, id: set.id }
  } catch (error) {
    return failure(error, 'The set could not be added.')
  }
}

export async function updateSetAction(
  setId: string,
  patch: { name?: string; look?: string },
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(setId)
  if (invalid) return invalid
  try {
    const set = await updateProjectSet(db, setId, patch)
    refresh(set.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The change could not be saved.')
  }
}

export async function removeSetAction(setId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(setId)
  if (invalid) return invalid
  const set = await getProjectSet(db, setId)
  if (!set) return { ok: true }
  // Plates are conditioning input nobody else references; they go with the
  // room. The row itself is kept and marked dismissed, so a redraft of the
  // Director's Book does not put the same set back (decision 264, mirroring
  // decision 253 (j)).
  for (const plate of set.plates) await deleteObject(plate.r2Key).catch(() => undefined)
  await dismissProjectSet(db, setId)
  refresh(set.projectId)
  return { ok: true }
}

/**
 * Step one of a plate upload: a presigned PUT for exactly this file. The
 * key is derived from the fingerprint, so finalise can recompute it and
 * only ever record an object this flow issued the URL for.
 */
export async function createSetPlateUploadAction(input: {
  setId: string
  mimeType: string
  fileSize: number
  contentHash: string
}): Promise<ActionResult & { url?: string; key?: string }> {
  await requireOwner()
  const invalid = badIds(input.setId)
  if (invalid) return invalid

  const set = await getProjectSet(db, input.setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  if (set.plates.length >= MAX_SET_PLATES) {
    return { ok: false, error: 'A set keeps at most four plates; remove one first.' }
  }
  const mime = CastPhotoMimeSchema.safeParse(input.mimeType)
  if (!mime.success) {
    return { ok: false, error: 'Only JPEG, PNG or WebP photos can be used as references.' }
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: 'That file looks empty.' }
  }
  if (input.fileSize > MAX_SET_PLATE_BYTES) {
    return { ok: false, error: 'That photo is over the 15 MB limit.' }
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Photo uploads need R2 configured; there is nowhere to store them.' }
  }

  const key = setPlateKey({
    projectId: set.projectId,
    contentHash: input.contentHash,
    ext: castPhotoExtension(mime.data),
  })
  return { ok: true, url: await presignPut(key, mime.data), key }
}

/**
 * Step two: the browser uploaded the bytes and read the dimensions; the
 * server checks the object landed and records the plate.
 */
export async function finaliseSetPlateAction(input: {
  setId: string
  mimeType: string
  contentHash: string
  width: number
  height: number
  view: SetPlateView
  sourceUrl?: string
}): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(input.setId)
  if (invalid) return invalid

  const set = await getProjectSet(db, input.setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  const mime = CastPhotoMimeSchema.safeParse(input.mimeType)
  const view = SetPlateViewSchema.safeParse(input.view)
  if (!mime.success || !view.success)
    return { ok: false, error: 'That photo could not be recorded.' }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (set.plates.some((plate) => plate.contentHash === input.contentHash)) {
    return { ok: true }
  }
  if (set.plates.length >= MAX_SET_PLATES) {
    return { ok: false, error: 'A set keeps at most four plates; remove one first.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Photo uploads need R2 configured; there is nowhere to store them.' }
  }

  const key = setPlateKey({
    projectId: set.projectId,
    contentHash: input.contentHash,
    ext: castPhotoExtension(mime.data),
  })
  const head = await headObject(key)
  if (!head) return { ok: false, error: 'The upload never arrived in storage. Try again.' }
  if (head.size > MAX_SET_PLATE_BYTES) {
    await deleteObject(key)
    return { ok: false, error: 'That photo is over the 15 MB limit.' }
  }

  const plate: SetPlate = {
    r2Key: key,
    contentHash: input.contentHash,
    mimeType: mime.data,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    view: view.data,
    origin: 'uploaded',
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
  }
  try {
    await setSetPlates(db, set.id, [...set.plates, plate])
    refresh(set.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The photo could not be recorded.')
  }
}

/**
 * Add a plate the producer found on the web, by its address (decision 264,
 * mirroring decision 253 (k)).
 *
 * The URL is a way in, not the reference: the server fetches the bytes once,
 * stores them in R2 exactly as an upload does, and keeps the address only as
 * provenance.
 */
export async function addSetPlateFromUrlAction(input: {
  setId: string
  url: string
  view: SetPlateView
}): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(input.setId)
  if (invalid) return invalid

  const set = await getProjectSet(db, input.setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  const view = SetPlateViewSchema.safeParse(input.view)
  if (!view.success) return { ok: false, error: 'That photo could not be recorded.' }
  if (set.plates.length >= MAX_SET_PLATES) {
    return { ok: false, error: 'A set keeps at most four plates; remove one first.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Photo uploads need R2 configured; there is nowhere to store them.' }
  }

  const fetched = await fetchRemoteImage(input.url)
  if (!fetched.ok) return { ok: false, error: fetched.error }
  const { bytes, mimeType, width, height, resolvedUrl } = fetched.image

  // The same fingerprint the browser computes, so the same picture arriving
  // by either route lands on one key and is recognised as already held.
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  if (set.plates.some((plate) => plate.contentHash === contentHash)) {
    return { ok: false, error: `${set.name} already has that exact plate.` }
  }

  const key = setPlateKey({
    projectId: set.projectId,
    contentHash,
    ext: castPhotoExtension(mimeType),
  })
  try {
    await putObject(key, bytes, mimeType)
  } catch {
    return { ok: false, error: 'That image could not be saved to storage. Try again.' }
  }

  const plate: SetPlate = {
    r2Key: key,
    contentHash,
    mimeType,
    width,
    height,
    view: view.data,
    origin: 'uploaded',
    sourceUrl: resolvedUrl,
  }
  try {
    await setSetPlates(db, set.id, [...set.plates, plate])
    refresh(set.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The photo could not be recorded.')
  }
}

export async function removeSetPlateAction(input: {
  setId: string
  contentHash: string
}): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(input.setId)
  if (invalid) return invalid
  const set = await getProjectSet(db, input.setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  const plate = set.plates.find((entry) => entry.contentHash === input.contentHash)
  if (!plate) return { ok: true }
  await deleteObject(plate.r2Key).catch(() => undefined)
  await setSetPlates(
    db,
    set.id,
    set.plates.filter((entry) => entry.contentHash !== input.contentHash),
  )
  refresh(set.projectId)
  return { ok: true }
}

/**
 * Generate a candidate plate from the set's `look` alone (decision 264): no
 * cast, no set conditioning, because a room's own reference plates cannot
 * condition their own first generation. Returns the candidates; nothing is
 * stored until `chooseSetPlateAction` picks one.
 */
export async function generateSetPlateAction(
  setId: string,
): Promise<ActionResult & { candidates?: SlotCandidate[] }> {
  await requireOwner()
  const invalid = badIds(setId)
  if (invalid) return invalid
  const set = await getProjectSet(db, setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  // Refused before the generator is called, not after: a full set has
  // nowhere to put the image the money would have bought.
  if (set.plates.length >= MAX_SET_PLATES) {
    return { ok: false, error: 'A set keeps at most four plates; remove one first.' }
  }

  const settings = await getSettings(db)
  const brief: StillBrief = {
    type: 'still',
    coversText: set.name,
    description: set.look,
    shotSize: 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: `${set.look} ${stillStyleAnchors(settings.brandKit)}`,
  }
  try {
    const candidates = await generateStillCandidates(brief, set.projectId)
    return { ok: true, candidates }
  } catch (error) {
    return failure(error, 'The plate could not be generated.')
  }
}

/**
 * Store the chosen candidate as a plate. The server never fetches an
 * arbitrary client-supplied URL: a live candidate already sits in R2 under
 * `r2Key` (the same still `generateStillCandidates` stored, read back with
 * `getObjectBytes` exactly as a Gemini reference is), and a mock candidate's
 * `sourceUrl` is a self-contained `data:` thumbnail decoded in place. Either
 * way the bytes are copied under `setPlateKey`, and the plate is recorded as
 * `origin: 'generated'`, `view: 'establishing'`, since a generated plate is
 * the film's own invention, and always the establishing view of the room it
 * just invented.
 */
export async function chooseSetPlateAction(input: {
  setId: string
  r2Key?: string | null
  sourceUrl: string
  width: number
  height: number
}): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(input.setId)
  if (invalid) return invalid
  const set = await getProjectSet(db, input.setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  if (set.plates.length >= MAX_SET_PLATES) {
    return { ok: false, error: 'A set keeps at most four plates; remove one first.' }
  }
  if (
    !Number.isInteger(input.width) ||
    input.width <= 0 ||
    !Number.isInteger(input.height) ||
    input.height <= 0
  ) {
    return { ok: false, error: 'That candidate could not be recorded.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Photo uploads need R2 configured; there is nowhere to store them.' }
  }

  let bytes: Buffer
  if (input.r2Key) {
    // Only a still this project just generated may be copied in. The key is
    // the client's to name, and an arbitrary one would make this action a
    // reader of any object in the bucket.
    if (!input.r2Key.startsWith(projectStillsPrefix(set.projectId))) {
      return {
        ok: false,
        error: 'That candidate is no longer available; generate the plate again.',
      }
    }
    try {
      const object = await getObjectBytes(input.r2Key)
      bytes = Buffer.from(object.bytes)
    } catch {
      return {
        ok: false,
        error: 'That candidate is no longer available; generate the plate again.',
      }
    }
  } else if (input.sourceUrl.startsWith('data:')) {
    bytes = Buffer.from(input.sourceUrl.slice(input.sourceUrl.indexOf(',') + 1), 'base64')
  } else {
    return { ok: false, error: 'That candidate is no longer available; generate the plate again.' }
  }

  const contentHash = createHash('sha256').update(bytes).digest('hex')
  if (set.plates.some((plate) => plate.contentHash === contentHash)) {
    return { ok: true }
  }

  const key = setPlateKey({ projectId: set.projectId, contentHash, ext: 'png' })
  try {
    await putObject(key, bytes, 'image/png')
  } catch {
    return { ok: false, error: 'That image could not be saved to storage. Try again.' }
  }

  const plate: SetPlate = {
    r2Key: key,
    contentHash,
    mimeType: 'image/png',
    width: input.width,
    height: input.height,
    view: 'establishing',
    origin: 'generated',
  }
  try {
    await setSetPlates(db, set.id, [...set.plates, plate])
    refresh(set.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The plate could not be recorded.')
  }
}
