'use server'

import {
  dismissCastMember,
  getCastMember,
  getProject,
  insertCastMember,
  setCastPhotos,
  updateCastMember,
} from '@boom-busters/db'
import {
  buildCastIdentityRequest,
  mockCastIdentity,
  mockProvidersEnabled,
  parseCastIdentity,
} from '@boom-busters/providers'
import type { MsgImage } from '@boom-busters/providers'
import {
  castPhotoExtension,
  CastPhotoMimeSchema,
  CastPhotoViewSchema,
  MAX_CAST_PHOTOS,
  referencePhotos,
  UlidSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { CastMember, CastPhoto } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import {
  castPhotoKey,
  deleteObject,
  getObjectBytes,
  headObject,
  presignPut,
  storageConfigured,
} from '@/lib/storage'

/**
 * The Cast card's buttons (decision 253): add a person, upload their
 * reference photos, write the identity string from them, edit, remove.
 *
 * Photos travel browser → R2 on a presigned PUT in two actions (the
 * decision 213 shape the board's "Upload own" uses): the app never holds the
 * bytes on the way in. The only time the app reads them back is to hand
 * them to a vision model as base64, here and at still generation.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

/** Reference photos are small by nature; a 15 MB ceiling leaves room for a full-frame JPEG. */
const MAX_CAST_PHOTO_BYTES = 15 * 1024 * 1024

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
    return { ok: false, error: 'Someone with that exact name is already in the cast.' }
  }
  return { ok: false, error: fallback }
}

export async function addCastMemberAction(
  projectId: string,
  input: { name: string; role: string },
): Promise<ActionResult & { id?: string }> {
  await requireOwner()
  const invalid = badIds(projectId)
  if (invalid) return invalid
  if (!(await getProject(db, projectId)))
    return { ok: false, error: 'This project no longer exists.' }
  try {
    const member = await insertCastMember(db, { projectId, ...input })
    refresh(projectId)
    return { ok: true, id: member.id }
  } catch (error) {
    return failure(error, 'The person could not be added.')
  }
}

export async function updateCastMemberAction(
  memberId: string,
  patch: { name?: string; role?: string; identityString?: string; guardrail?: string },
): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(memberId)
  if (invalid) return invalid
  try {
    const member = await updateCastMember(db, memberId, patch)
    refresh(member.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The change could not be saved.')
  }
}

export async function removeCastMemberAction(memberId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(memberId)
  if (invalid) return invalid
  const member = await getCastMember(db, memberId)
  if (!member) return { ok: true }
  // Photos are conditioning input nobody else references; they go with the
  // person. The row itself is kept and marked dismissed, so a redraft of the
  // Director's Book does not put the same person back (decision 253 (j)).
  for (const photo of member.photos) await deleteObject(photo.r2Key).catch(() => undefined)
  await dismissCastMember(db, memberId)
  refresh(member.projectId)
  return { ok: true }
}

/**
 * Step one of a photo upload: a presigned PUT for exactly this file. The
 * key is derived from the fingerprint, so finalise can recompute it and
 * only ever record an object this flow issued the URL for.
 */
export async function createCastPhotoUploadAction(input: {
  memberId: string
  mimeType: string
  fileSize: number
  contentHash: string
}): Promise<ActionResult & { url?: string; key?: string }> {
  await requireOwner()
  const invalid = badIds(input.memberId)
  if (invalid) return invalid

  const member = await getCastMember(db, input.memberId)
  if (!member) return { ok: false, error: 'This cast member no longer exists.' }
  if (member.photos.length >= MAX_CAST_PHOTOS) {
    return {
      ok: false,
      error: `${member.name} already has ${MAX_CAST_PHOTOS} photos. Remove one to add another.`,
    }
  }
  const mime = CastPhotoMimeSchema.safeParse(input.mimeType)
  if (!mime.success) {
    return { ok: false, error: 'Only JPEG, PNG or WebP photos can be used as references.' }
  }
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: 'That file looks empty.' }
  }
  if (input.fileSize > MAX_CAST_PHOTO_BYTES) {
    return { ok: false, error: 'That photo is over the 15 MB limit.' }
  }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Photo uploads need R2 configured; there is nowhere to store them.' }
  }

  const key = castPhotoKey({
    projectId: member.projectId,
    contentHash: input.contentHash,
    ext: castPhotoExtension(mime.data),
  })
  return { ok: true, url: await presignPut(key, mime.data), key }
}

/**
 * Step two: the browser uploaded the bytes and read the dimensions; the
 * server checks the object landed, records the photo, and on the first
 * photo writes the identity string from it.
 */
export async function finaliseCastPhotoAction(input: {
  memberId: string
  mimeType: string
  contentHash: string
  width: number
  height: number
  view: string
  sourceUrl?: string
}): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(input.memberId)
  if (invalid) return invalid

  const member = await getCastMember(db, input.memberId)
  if (!member) return { ok: false, error: 'This cast member no longer exists.' }
  const mime = CastPhotoMimeSchema.safeParse(input.mimeType)
  const view = CastPhotoViewSchema.safeParse(input.view)
  if (!mime.success || !view.success)
    return { ok: false, error: 'That photo could not be recorded.' }
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) {
    return { ok: false, error: 'The file could not be fingerprinted. Try choosing it again.' }
  }
  if (member.photos.some((photo) => photo.contentHash === input.contentHash)) {
    return { ok: true }
  }
  if (member.photos.length >= MAX_CAST_PHOTOS) {
    return { ok: false, error: `${member.name} already has ${MAX_CAST_PHOTOS} photos.` }
  }
  if (!storageConfigured()) {
    return { ok: false, error: 'Photo uploads need R2 configured; there is nowhere to store them.' }
  }

  const key = castPhotoKey({
    projectId: member.projectId,
    contentHash: input.contentHash,
    ext: castPhotoExtension(mime.data),
  })
  const head = await headObject(key)
  if (!head) return { ok: false, error: 'The upload never arrived in storage. Try again.' }
  if (head.size > MAX_CAST_PHOTO_BYTES) {
    await deleteObject(key)
    return { ok: false, error: 'That photo is over the 15 MB limit.' }
  }

  const photo: CastPhoto = {
    r2Key: key,
    contentHash: input.contentHash,
    mimeType: mime.data,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    view: view.data,
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
  }
  try {
    const updated = await setCastPhotos(db, member.id, [...member.photos, photo])
    // The first photo writes the identity string; later ones do not overwrite
    // what the producer may have edited.
    if (updated.identityString.trim() === '') await describeFromPhotos(updated)
    refresh(member.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The photo could not be recorded.')
  }
}

export async function removeCastPhotoAction(input: {
  memberId: string
  contentHash: string
}): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(input.memberId)
  if (invalid) return invalid
  const member = await getCastMember(db, input.memberId)
  if (!member) return { ok: false, error: 'This cast member no longer exists.' }
  const photo = member.photos.find((entry) => entry.contentHash === input.contentHash)
  if (!photo) return { ok: true }
  await deleteObject(photo.r2Key).catch(() => undefined)
  await setCastPhotos(
    db,
    member.id,
    member.photos.filter((entry) => entry.contentHash !== input.contentHash),
  )
  refresh(member.projectId)
  return { ok: true }
}

/** "Describe from photos": rewrite the identity string and guardrail from the current photos. */
export async function describeCastMemberAction(memberId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(memberId)
  if (invalid) return invalid
  const member = await getCastMember(db, memberId)
  if (!member) return { ok: false, error: 'This cast member no longer exists.' }
  if (member.photos.length === 0) {
    return { ok: false, error: 'Upload a photo first; the description is written from it.' }
  }
  try {
    await describeFromPhotos(member)
    refresh(member.projectId)
    return { ok: true }
  } catch (error) {
    return failure(error, 'The description could not be written.')
  }
}

// Not exported: a 'use server' module may only export async functions that
// are actions; this is shared machinery.
async function describeFromPhotos(member: CastMember): Promise<void> {
  const written = mockProvidersEnabled()
    ? mockCastIdentity({ name: member.name, role: member.role })
    : parseCastIdentity(
        (
          await callLlm(
            buildCastIdentityRequest({
              name: member.name,
              role: member.role,
              photos: await loadPhotos(member),
            }),
            { projectId: member.projectId },
          )
        ).text,
      )
  await updateCastMember(db, member.id, {
    identityString: written.identityString,
    // A guardrail the producer already wrote is theirs; only fill an empty one.
    ...(member.guardrail.trim() === '' ? { guardrail: written.guardrail } : {}),
  })
}

async function loadPhotos(member: CastMember): Promise<MsgImage[]> {
  const images: MsgImage[] = []
  for (const photo of referencePhotos(member, MAX_CAST_PHOTOS)) {
    const object = await getObjectBytes(photo.r2Key)
    images.push({ mimeType: photo.mimeType, data: Buffer.from(object.bytes).toString('base64') })
  }
  return images
}
