'use server'

/**
 * The Motion tab's reference actions (spec 2026-11-04, sections 7.2 and
 * 8.4). An upload is the logo library's two-step presigned shape (decision
 * 205): the browser asks for a URL, PUTs the bytes, then asks for the row.
 * A clip's frames are taken in the browser and PUT the same way, one key
 * per frame; the finalise recomputes the frame set from the window and
 * refuses a list that differs, then HEADs every key before a row is written.
 * A reference is read only on "Save and read" or "Read", never silently.
 */

import {
  archiveMotionReference,
  getAsset,
  getChannelSettings,
  insertMotionReference,
  listMotionReferences,
  motionReferenceById,
  referencesUsingAsset,
  remarkMotionReference,
  setReferenceReading,
  setReferenceReadState,
  updateMotionReference,
  upsertChannelAsset,
} from '@boom-busters/db'
import {
  buildMotionIdentityDraftRequest,
  DRAFT_OUTPUT_TOKENS,
  MANIFEST,
  mockMotionIdentityDraft,
  mockProvidersEnabled,
  parseMotionIdentityDraft,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  DENSE_FRAMES_MAX,
  denseFrameTimes,
  MotionReferenceEditSchema,
  MotionReferenceInputSchema,
  OVERVIEW_FRAMES_MAX,
  overviewFrameTimes,
  REFERENCE_CLIP_MAX_MS,
  REFERENCE_IMAGE_MAX_BYTES,
  REFERENCE_PACK_MAX,
  REFERENCE_VIDEO_MAX_BYTES,
  ReferenceMimeSchema,
  ReferenceReadingEditSchema,
  referenceExtension,
  isReservedTechnique,
  referenceKind,
  resolveBrandKit,
  resolveMotionIdentity,
  UlidSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { MotionIdentityDraft, ReferenceFrames } from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { callForAnswer } from '@/lib/answer'
import { completeForChannel } from '@/lib/answer-call'
import { channelWriteRefusal } from '@/lib/channel-lookup'
import { db } from '@/lib/db'
import { referenceFrameKey, referenceKey } from '@/lib/reference-keys'
import { settingsErrorMessage } from '@/lib/settings-error'
import { deleteObject, headObject, presignPut, storageConfigured } from '@/lib/storage'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import type { ActionResult } from './actions'

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

const HEX_64 = /^[0-9a-f]{64}$/
const UNKNOWN_CHANNEL: ActionResult = { ok: false, error: 'Unknown channel' }
const UNKNOWN_REFERENCE: ActionResult = { ok: false, error: 'That reference is already gone.' }
const NO_STORAGE: ActionResult = {
  ok: false,
  error: 'Reference uploads need R2 configured; there is nowhere to store them.',
}
const BAD_TYPE: ActionResult = {
  ok: false,
  error: 'A reference is a PNG, JPEG or WebP still, or an MP4, WebM or MOV clip.',
}
const BAD_HASH: ActionResult = {
  ok: false,
  error: 'The file could not be fingerprinted. Try choosing it again.',
}
const FRAMES_MISMATCH: ActionResult = {
  ok: false,
  error: 'The frames do not match the window. Mark it again.',
}
const NOT_A_REFERENCE: ActionResult = {
  ok: false,
  error:
    'Those exact bytes are already stored as a mark in the logo library. Upload a different file.',
}
const PACK_FULL: ActionResult = {
  ok: false,
  error: 'This channel already holds twelve references. Archive one first.',
}
const BEING_READ: ActionResult = { ok: false, error: 'This reference is being read.' }
const BRIEF_MAX = 1000
/** A read that has answered nothing for this long has stalled and may be asked for again. */
const READ_STALE_MS = 10 * 60_000
/** HEADs in flight at once when a finalise verifies a clip's frames. */
const HEAD_BATCH = 8

function refresh(): void {
  revalidatePath('/c/[slug]', 'layout')
}

/** The channel checks every action starts with, or the refusal. */
async function channelGate(channelId: string): Promise<ActionResult | null> {
  await requireOwner()
  if (!UlidSchema.safeParse(channelId).success) return UNKNOWN_CHANNEL
  return channelWriteRefusal(channelId)
}

/** The reference the action names, when it belongs to the channel. */
async function ownReference(channelId: string, id: string) {
  if (!UlidSchema.safeParse(id).success) return null
  const row = await motionReferenceById(db, id)
  return row && row.channelId === channelId && row.archivedAt === null ? row : null
}

/** A read in flight that has not stalled: the row holds still while it runs (final review, issues 4 and 5). */
function beingRead(row: { readState: string; updatedAt: Date }): boolean {
  return row.readState === 'reading' && Date.now() - row.updatedAt.getTime() < READ_STALE_MS
}

/** Whether the pack has room for one more live reference. */
async function packFull(channelId: string): Promise<boolean> {
  return (await listMotionReferences(db, channelId)).length >= REFERENCE_PACK_MAX
}

interface FrameUpload {
  set: 'dense' | 'overview'
  atMs: number
  width: number
  height: number
}

/** Whether the frames the browser took are exactly the set the window asks for. */
function framesMatch(
  frames: readonly FrameUpload[],
  window: { startMs: number; endMs: number },
  durationMs: number,
): boolean {
  const times = (set: FrameUpload['set']) =>
    frames.filter((frame) => frame.set === set).map((frame) => frame.atMs)
  const same = (a: number[], b: number[]) =>
    a.length === b.length && a.every((value, index) => value === b[index])
  return (
    same(times('dense'), denseFrameTimes(window.startMs, window.endMs)) &&
    same(times('overview'), overviewFrameTimes(durationMs)) &&
    frames.every((frame) => frame.width >= 1 && frame.height >= 1)
  )
}

/** Every frame key answered to a HEAD, a few at a time; null names the first that did not. */
async function missingFrame(keys: readonly string[]): Promise<string | null> {
  for (let at = 0; at < keys.length; at += HEAD_BATCH) {
    const batch = keys.slice(at, at + HEAD_BATCH)
    const heads = await Promise.all(batch.map((key) => headObject(key)))
    const missing = heads.findIndex((head) => head === undefined)
    if (missing !== -1) return batch[missing]!
  }
  return null
}

function storedFrames(
  channelId: string,
  contentHash: string,
  frames: readonly FrameUpload[],
): ReferenceFrames {
  const stored = (set: FrameUpload['set']) =>
    frames
      .filter((frame) => frame.set === set)
      .map((frame) => ({
        atMs: frame.atMs,
        r2Key: referenceFrameKey({ channelId, contentHash, set, atMs: frame.atMs }),
        width: Math.round(frame.width),
        height: Math.round(frame.height),
      }))
  return { dense: stored('dense'), overview: stored('overview') }
}

/** Step one: a presigned PUT for the original still or clip. */
export async function createReferenceUploadAction(
  channelId: string,
  input: { fileType: string; fileSize: number; contentHash: string; durationMs?: number },
): Promise<ActionResult & { url?: string; key?: string }> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const mime = ReferenceMimeSchema.safeParse(input.fileType)
  if (!mime.success) return BAD_TYPE
  const kind = referenceKind(mime.data)
  if (!Number.isFinite(input.fileSize) || input.fileSize <= 0) {
    return { ok: false, error: 'That file looks empty.' }
  }
  if (kind === 'image' && input.fileSize > REFERENCE_IMAGE_MAX_BYTES) {
    return { ok: false, error: 'That still is over the 8 MB limit.' }
  }
  if (kind === 'video' && input.fileSize > REFERENCE_VIDEO_MAX_BYTES) {
    return { ok: false, error: 'That clip is over the 100 MB limit.' }
  }
  if (kind === 'video' && (input.durationMs ?? 0) > REFERENCE_CLIP_MAX_MS) {
    return { ok: false, error: 'That clip is over 90 seconds. Trim it first.' }
  }
  if (!HEX_64.test(input.contentHash)) return BAD_HASH
  // Refused before the bytes travel, not after a 100 MB upload (final review, issue 7).
  if (await packFull(channelId)) return PACK_FULL
  if (!storageConfigured()) return NO_STORAGE
  const key = referenceKey({
    channelId,
    contentHash: input.contentHash,
    ext: referenceExtension(mime.data),
  })
  return { ok: true, url: await presignPut(key, mime.data), key }
}

/** One presigned PUT per frame the browser took, under the reference's hash. */
export async function createReferenceFrameUploadsAction(
  channelId: string,
  input: { contentHash: string; dense: number[]; overview: number[] },
): Promise<
  ActionResult & {
    uploads?: { set: 'dense' | 'overview'; atMs: number; key: string; url: string }[]
  }
> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  if (!HEX_64.test(input.contentHash)) return BAD_HASH
  if (input.dense.length > DENSE_FRAMES_MAX || input.overview.length > OVERVIEW_FRAMES_MAX) {
    return FRAMES_MISMATCH
  }
  if (!storageConfigured()) return NO_STORAGE
  const wanted = [
    ...input.dense.map((atMs) => ({ set: 'dense' as const, atMs })),
    ...input.overview.map((atMs) => ({ set: 'overview' as const, atMs })),
  ]
  const uploads = await Promise.all(
    wanted.map(async ({ set, atMs }) => {
      const key = referenceFrameKey({ channelId, contentHash: input.contentHash, set, atMs })
      return { set, atMs, key, url: await presignPut(key, 'image/jpeg') }
    }),
  )
  return { ok: true, uploads }
}

/** Step two: the objects landed; verify every key and record the reference. */
export async function finaliseReferenceAction(
  channelId: string,
  input: {
    contentHash: string
    fileType: string
    width: number
    height: number
    durationMs?: number
    frames: FrameUpload[]
    input: unknown
    read: boolean
  },
): Promise<ActionResult & { id?: string }> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const mime = ReferenceMimeSchema.safeParse(input.fileType)
  if (!mime.success) return BAD_TYPE
  const kind = referenceKind(mime.data)
  const form = MotionReferenceInputSchema.safeParse(input.input)
  if (!form.success) return { ok: false, error: settingsErrorMessage(form.error) }
  if (form.data.kind !== kind) return BAD_TYPE
  if (!HEX_64.test(input.contentHash)) return BAD_HASH
  if (kind === 'video') {
    const durationMs = Math.round(input.durationMs ?? 0)
    if (durationMs <= 0 || durationMs > REFERENCE_CLIP_MAX_MS) {
      return { ok: false, error: 'That clip is over 90 seconds. Trim it first.' }
    }
    const window = { startMs: form.data.windowStartMs!, endMs: form.data.windowEndMs! }
    if (!framesMatch(input.frames, window, durationMs)) return FRAMES_MISMATCH
  } else if (input.frames.length > 0) {
    return FRAMES_MISMATCH
  }
  if (!storageConfigured()) return NO_STORAGE

  const key = referenceKey({
    channelId,
    contentHash: input.contentHash,
    ext: referenceExtension(mime.data),
  })
  const head = await headObject(key)
  if (!head) return { ok: false, error: 'The upload never arrived in storage. Try again.' }
  const maxBytes = kind === 'image' ? REFERENCE_IMAGE_MAX_BYTES : REFERENCE_VIDEO_MAX_BYTES
  if (head.size > maxBytes) {
    await deleteObject(key)
    return {
      ok: false,
      error: `That file is over the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
    }
  }
  const frames = storedFrames(channelId, input.contentHash, input.frames)
  const lost = await missingFrame([...frames.dense, ...frames.overview].map((f) => f.r2Key))
  if (lost) return { ok: false, error: 'A frame never arrived in storage. Try again.' }

  const width = Math.max(1, Math.round(input.width))
  const height = Math.max(1, Math.round(input.height))
  const asset = await upsertChannelAsset(db, channelId, {
    kind,
    r2Key: key,
    contentHash: input.contentHash,
    width,
    height,
    durationMs: kind === 'video' ? Math.round(input.durationMs ?? 0) : null,
    title: form.data.title,
  })
  if (!asset) return NOT_A_REFERENCE
  const { kind: _kind, windowStartMs, windowEndMs, ...words } = form.data
  let row
  try {
    row = await insertMotionReference(db, channelId, {
      assetId: asset.id,
      kind,
      ...words,
      windowStartMs,
      windowEndMs,
      frames:
        kind === 'image'
          ? { dense: [{ atMs: 0, r2Key: key, width, height }], overview: [] }
          : frames,
    })
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    // The pack is full: the bytes just uploaded have no row to belong to,
    // unless another reference already holds the same bytes (final review, issue 2).
    if ((await referencesUsingAsset(db, asset.id)) === 0) {
      await deleteObject(key).catch(() => undefined)
    }
    return { ok: false, error: error.message }
  }
  if (input.read) {
    const queued = await startReading(channelId, row.id, row.readState)
    if (!queued.ok) return { ...queued, id: row.id }
  }
  refresh()
  return { ok: true, id: row.id }
}

/**
 * The row says "reading" and the reader is sent for. A send that fails puts
 * the state back, so a card never says "Reading..." for a run that was never
 * queued (final review, issue 4).
 */
async function startReading(
  channelId: string,
  referenceId: string,
  previous: 'unread' | 'reading' | 'read' | 'failed',
): Promise<ActionResult> {
  await setReferenceReadState(db, referenceId, 'reading')
  try {
    await inngest.send(events.motionReferenceIngested.create({ channelId, referenceId }))
  } catch {
    await setReferenceReadState(
      db,
      referenceId,
      previous === 'reading' ? 'failed' : previous,
    ).catch(() => undefined)
    return { ok: false, error: 'The read could not be queued. Try again.' }
  }
  return { ok: true }
}

/** The text fields on the card. */
export async function updateReferenceAction(
  channelId: string,
  input: { id: string; input: unknown },
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const row = await ownReference(channelId, input.id)
  if (!row) return UNKNOWN_REFERENCE
  const edit = MotionReferenceEditSchema.safeParse(input.input)
  if (!edit.success) return { ok: false, error: settingsErrorMessage(edit.error) }
  const updated = await updateMotionReference(db, row.id, edit.data)
  if (!updated) return UNKNOWN_REFERENCE
  refresh()
  return { ok: true }
}

/** A new window on a clip: the frames the browser took for it, verified as on upload. */
export async function remarkReferenceAction(
  channelId: string,
  input: {
    id: string
    windowStartMs: number
    windowEndMs: number
    frames: FrameUpload[]
    read: boolean
  },
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const row = await ownReference(channelId, input.id)
  if (!row) return UNKNOWN_REFERENCE
  if (row.kind !== 'video') return { ok: false, error: 'A still has no window to mark.' }
  if (beingRead(row)) return BEING_READ
  const window = MotionReferenceInputSchema.safeParse({
    kind: 'video',
    title: row.title,
    purpose: row.purpose,
    carryOver: row.carryOver,
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,
  })
  if (!window.success) return { ok: false, error: settingsErrorMessage(window.error) }
  const asset = await getAsset(db, row.assetId)
  const durationMs = asset?.durationMs ?? 0
  if (
    !framesMatch(
      input.frames,
      { startMs: input.windowStartMs, endMs: input.windowEndMs },
      durationMs,
    )
  ) {
    return FRAMES_MISMATCH
  }
  if (!storageConfigured()) return NO_STORAGE
  const frames = storedFrames(channelId, asset?.contentHash ?? '', input.frames)
  const lost = await missingFrame([...frames.dense, ...frames.overview].map((f) => f.r2Key))
  if (lost) return { ok: false, error: 'A frame never arrived in storage. Try again.' }
  const marked = await remarkMotionReference(db, row.id, {
    windowStartMs: input.windowStartMs,
    windowEndMs: input.windowEndMs,
    frames,
  })
  if (!marked) return UNKNOWN_REFERENCE
  if (input.read) {
    const queued = await startReading(channelId, row.id, 'unread')
    if (!queued.ok) return queued
  }
  refresh()
  return { ok: true }
}

const TITLE_TAKEN: ActionResult = {
  ok: false,
  error: 'Another reference is already called that. Give this window its own title.',
}

/**
 * "New window" on a stored clip (decision 448): another window of the same
 * clip, saved as a reference of its own with its own words, on the asset the
 * clip is already stored as. Nothing is uploaded but the window's frames,
 * which the browser took from the stored clip. Its title must be its own: the
 * storyboard and the critic name references by title.
 */
export async function addReferenceWindowAction(
  channelId: string,
  input: { fromId: string; frames: FrameUpload[]; input: unknown; read: boolean },
): Promise<ActionResult & { id?: string }> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const source = await ownReference(channelId, input.fromId)
  if (!source) return UNKNOWN_REFERENCE
  if (source.kind !== 'video') return { ok: false, error: 'A still has no window to mark.' }
  const form = MotionReferenceInputSchema.safeParse(input.input)
  if (!form.success) return { ok: false, error: settingsErrorMessage(form.error) }
  if (form.data.kind !== 'video') return BAD_TYPE
  const live = await listMotionReferences(db, channelId)
  const title = form.data.title.trim().toLowerCase()
  if (live.some((row) => row.title.trim().toLowerCase() === title)) return TITLE_TAKEN
  const asset = await getAsset(db, source.assetId)
  if (!asset) return UNKNOWN_REFERENCE
  const window = { startMs: form.data.windowStartMs!, endMs: form.data.windowEndMs! }
  if (!framesMatch(input.frames, window, asset.durationMs ?? 0)) return FRAMES_MISMATCH
  if (!storageConfigured()) return NO_STORAGE
  if (await packFull(channelId)) return PACK_FULL
  const frames = storedFrames(channelId, asset.contentHash, input.frames)
  const lost = await missingFrame([...frames.dense, ...frames.overview].map((f) => f.r2Key))
  if (lost) return { ok: false, error: 'A frame never arrived in storage. Try again.' }
  const { kind: _kind, windowStartMs, windowEndMs, ...words } = form.data
  let row
  try {
    row = await insertMotionReference(db, channelId, {
      assetId: asset.id,
      kind: 'video',
      ...words,
      windowStartMs,
      windowEndMs,
      frames,
    })
  } catch (error) {
    // The pack filled between the check and the insert: the clip stays, its other reference holds it.
    if (!(error instanceof ValidationError)) throw error
    return { ok: false, error: error.message }
  }
  if (input.read) {
    const queued = await startReading(channelId, row.id, row.readState)
    if (!queued.ok) return { ...queued, id: row.id }
  }
  refresh()
  return { ok: true, id: row.id }
}

/** Read an unread or failed reference, on the owner's word. */
export async function readReferenceAction(channelId: string, id: string): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const row = await ownReference(channelId, id)
  if (!row) return UNKNOWN_REFERENCE
  if (beingRead(row)) return BEING_READ
  const queued = await startReading(channelId, row.id, row.readState)
  if (!queued.ok) return queued
  refresh()
  return { ok: true }
}

/** The owner's edit of a reading; its provenance stays and the edit is dated. */
export async function saveReadingAction(
  channelId: string,
  input: { id: string; reading: unknown },
): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const row = await ownReference(channelId, input.id)
  if (!row) return UNKNOWN_REFERENCE
  if (beingRead(row)) return BEING_READ
  if (!row.reading) return { ok: false, error: 'This reference has no reading to edit yet.' }
  const edit = ReferenceReadingEditSchema.safeParse(input.reading)
  if (!edit.success) return { ok: false, error: settingsErrorMessage(edit.error) }
  await setReferenceReading(db, row.id, {
    ...row.reading,
    ...edit.data,
    editedAt: new Date().toISOString(),
  })
  refresh()
  return { ok: true }
}

/** Archiving keeps the row and its files; the pack no longer lists it. */
export async function archiveReferenceAction(channelId: string, id: string): Promise<ActionResult> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const row = await ownReference(channelId, id)
  if (!row) return UNKNOWN_REFERENCE
  await archiveMotionReference(db, row.id)
  refresh()
  return { ok: true }
}

/**
 * "Draft motion identity" (spec 8.4): one call from the readings, the brief,
 * the brand's colours and fonts and the catalogue. The proposal comes back
 * to the tab; nothing is stored until Apply.
 */
export async function draftMotionIdentityAction(
  channelId: string,
  input: { brief: string },
): Promise<ActionResult & { draft?: MotionIdentityDraft }> {
  const refusal = await channelGate(channelId)
  if (refusal) return refusal
  const brief = input.brief.trim()
  if (brief.length > BRIEF_MAX) {
    return { ok: false, error: `The brief is over ${BRIEF_MAX} characters.` }
  }
  const settings = await getChannelSettings(db, channelId)
  const brand = resolveBrandKit(settings)
  const references = await listMotionReferences(db, channelId)
  const request = {
    current: resolveMotionIdentity(settings),
    brief,
    readings: references.map((row) => ({
      title: row.title,
      purpose: row.purpose,
      negative: row.negative,
      carryOver: row.carryOver,
      avoid: row.avoid,
      reading: row.reading ?? null,
    })),
    brand: {
      colors: Object.fromEntries(
        Object.entries(brand.colors).flatMap(([role, value]) =>
          typeof value === 'string'
            ? [[role, value]]
            : Array.isArray(value)
              ? [[role, value.join(', ')]]
              : Object.entries(value).map(([inner, hex]) => [`${role} ${inner}`, hex]),
        ),
      ),
      fonts: Object.fromEntries(
        Object.entries(brand.typography).map(([role, face]) => [role, face.family]),
      ),
    },
    techniques: MANIFEST.filter((entry) => !isReservedTechnique(entry.technique)).map((entry) => ({
      technique: entry.technique,
      description: entry.description,
    })),
  }
  if (mockProvidersEnabled()) return { ok: true, draft: mockMotionIdentityDraft(request) }
  try {
    const answer = await callForAnswer({
      request: buildMotionIdentityDraftRequest(request),
      // The draft chooses from the catalogue; the channel's own keys in use stay (spec 8.5).
      parse: (text) => parseMotionIdentityDraft(text, request.current.techniques),
      complete: completeForChannel(channelId, { estimateOutputTokens: DRAFT_OUTPUT_TOKENS }),
    })
    if (!answer.ok) return { ok: false, error: answer.issue }
    return { ok: true, draft: answer.value }
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, error: error.message }
    throw error
  }
}
