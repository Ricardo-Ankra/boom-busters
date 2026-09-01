'use server'

import { createHash } from 'node:crypto'
import {
  ensurePublishRecord,
  getProject,
  getPublishRecord,
  getRender,
  getShort,
  hasLiveRun,
  latestRender,
  recordVerifyResult,
  setProjectStage,
  updatePublishRecord,
  youtubeRefreshToken,
} from '@boom-busters/db'
import type { PublishRecordRow } from '@boom-busters/db'
import {
  composeDescription,
  PublishDraftSchema,
  PublishMetadataSchema,
  UlidSchema,
} from '@boom-busters/schemas'
import {
  buildTitlesRequest,
  mockProvidersEnabled,
  mockTitleOptions,
  parseTitleOptions,
} from '@boom-busters/providers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { movePublishAt, refreshAccessToken, YoutubeAuthError } from '@/lib/youtube'
import { callLlm } from '@/lib/llm'
import { descriptionIngredients } from '@/lib/publish-review'
import { deleteObject, putObject, R2_PREFIX, storageConfigured } from '@/lib/storage'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'

/**
 * The Publish screen's actions (build spec section 11.3). The one with teeth
 * is `schedulePublish`: it writes the `publish_records` row FIRST — slot,
 * composed description, final metadata — and only then emits
 * `publish/requested` (spec section 7.2 item 8: the runner never uploads
 * without an existing row to claim). Everything else is curation: drafts,
 * generated titles, thumbnails, and the stage handover from Shorts.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

function parseTarget(targetType: string, targetId: string): ActionResult | null {
  if (targetType !== 'master' && targetType !== 'short') {
    return { ok: false, error: `Unknown publish target "${targetType}"` }
  }
  if (!UlidSchema.safeParse(targetId).success) return { ok: false, error: 'Unknown target' }
  return null
}

/** A target's project, so every action can revalidate the right screen. */
async function projectIdOf(
  targetType: 'master' | 'short',
  targetId: string,
): Promise<string | undefined> {
  if (targetType === 'master') {
    return (await getProject(db, targetId)) ? targetId : undefined
  }
  return (await getShort(db, targetId))?.projectId
}

/** Draft fields merged over what the jsonb already holds — never replaced. */
async function mergeDraft(record: PublishRecordRow, patch: Record<string, unknown>): Promise<void> {
  await updatePublishRecord(db, record.id, {
    metadata: { ...record.metadata, ...patch },
  })
}

const EDITABLE = ['draft', 'failed'] as const
function editableReason(record: PublishRecordRow | undefined): string | null {
  if (!record) return null
  if ((EDITABLE as readonly string[]).includes(record.status)) return null
  return record.status === 'scheduled' || record.status === 'live'
    ? 'This item is already on YouTube — edit it in Studio.'
    : 'This item is uploading right now.'
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

export async function savePublishDraft(
  targetType: string,
  targetId: string,
  draft: { title: string; descriptionBody: string; tags: string },
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const tags = draft.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)

  const parsed = PublishDraftSchema.safeParse({
    title: draft.title.trim() || undefined,
    descriptionBody: draft.descriptionBody,
    tags,
  })
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "That draft does not fit YouTube's limits — 100 characters of title, 60 tags of 100 " +
        'characters each.',
    }
  }

  const record = await ensurePublishRecord(db, type, targetId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }

  await mergeDraft(record, {
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    descriptionBody: parsed.data.descriptionBody ?? '',
    tags: parsed.data.tags,
  })

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

/**
 * The 8 generated title options (spec section 11.3): the 'metadata' LLM task,
 * routed and budget-guarded like every other call. Mock mode answers locally
 * — deterministic, obviously mock — for free.
 */
export async function generateTitles(targetType: string, targetId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }
  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }

  const record = await ensurePublishRecord(db, type, targetId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }

  const workingTitle =
    type === 'master' ? project.title : ((await getShort(db, targetId))?.title ?? project.title)

  let titles: string[]
  if (mockProvidersEnabled()) {
    titles = mockTitleOptions(workingTitle)
  } else {
    const { hook } = await descriptionIngredients(db, projectId)
    try {
      const result = await callLlm(
        buildTitlesRequest({
          caseTitle: project.caseTitle,
          hook: hook || project.title,
          target: type,
          workingTitle,
        }),
        { projectId, estimateOutputTokens: 500 },
      )
      titles = parseTitleOptions(result.text)
    } catch (error) {
      return {
        ok: false,
        error: `The titles could not be generated: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
  }

  await mergeDraft(record, { titleOptions: titles })
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Thumbnails (masters only — Shorts take their frame from the video)
// ---------------------------------------------------------------------------

// A 'use server' module may only export async functions, so the limits the
// client shares live as literals on both sides; the server's are the law.
const THUMB_MAX_BYTES = 2 * 1024 * 1024
const THUMB_MIN_WIDTH = 1280
const THUMB_MIN_HEIGHT = 720
const THUMB_LIMIT = 3

/** PNG IHDR: signature, then the first chunk is always IHDR — width and
 *  height are big-endian at fixed offsets. No image library needed. */
function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

export async function uploadThumbnail(formData: FormData): Promise<ActionResult> {
  await requireOwner()

  const projectId = String(formData.get('projectId') ?? '')
  if (!UlidSchema.safeParse(projectId).success) return { ok: false, error: 'Unknown project' }
  if (!(await getProject(db, projectId))) return { ok: false, error: 'Unknown project' }

  const file = formData.get('file')
  if (!(file instanceof File)) return { ok: false, error: 'No file arrived.' }
  if (file.size > THUMB_MAX_BYTES) {
    return { ok: false, error: 'YouTube thumbnails must be 2 MB or less.' }
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const dimensions = pngDimensions(bytes)
  if (!dimensions) {
    return { ok: false, error: 'Only PNG files can be dropped here — export one from Canva.' }
  }
  if (dimensions.width < THUMB_MIN_WIDTH || dimensions.height < THUMB_MIN_HEIGHT) {
    return {
      ok: false,
      error:
        `That PNG is ${dimensions.width}×${dimensions.height}; YouTube wants at least ` +
        `${THUMB_MIN_WIDTH}×${THUMB_MIN_HEIGHT}.`,
    }
  }

  if (!storageConfigured()) {
    return { ok: false, error: 'Uploads need R2 configured — there is nowhere to store the PNG.' }
  }

  const record = await ensurePublishRecord(db, 'master', projectId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }
  if (record.uploadedThumbKeys.length >= THUMB_LIMIT) {
    return {
      ok: false,
      error: `Three thumbnails are already stored — remove one to add another.`,
    }
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  const key = `${R2_PREFIX}/thumbs/${projectId}/${hash}.png`
  if (record.uploadedThumbKeys.includes(key)) {
    return { ok: false, error: 'That exact PNG is already uploaded.' }
  }

  await putObject(key, bytes, 'image/png')
  await updatePublishRecord(db, record.id, {
    uploadedThumbKeys: [...record.uploadedThumbKeys, key],
  })

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function removeThumbnail(projectId: string, key: string): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(projectId).success) return { ok: false, error: 'Unknown project' }

  const record = await getPublishRecord(db, 'master', projectId)
  if (!record || !record.uploadedThumbKeys.includes(key)) {
    return { ok: false, error: 'That thumbnail is not on this project.' }
  }
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }

  await updatePublishRecord(db, record.id, {
    uploadedThumbKeys: record.uploadedThumbKeys.filter((stored) => stored !== key),
  })
  try {
    await deleteObject(key)
  } catch {
    // Bytes left behind cost fractions of a cent; the record no longer
    // points at them, which is what mattered.
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Scheduling — the fifth gate
// ---------------------------------------------------------------------------

export async function schedulePublish(
  targetType: string,
  targetId: string,
  publishAtIso: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const publishAt = new Date(publishAtIso)
  if (Number.isNaN(publishAt.getTime())) return { ok: false, error: 'That is not a date.' }
  if (publishAt.getTime() <= Date.now()) {
    return { ok: false, error: 'That slot is in the past — pick one ahead of now.' }
  }

  /**
   * The runner re-checks all of this (its preflight is the enforcement),
   * but a schedule button that accepts and then immediately refuses in the
   * activity feed is a worse experience than one that says why here.
   */
  let workingTitle: string
  if (type === 'master') {
    const render = await latestRender(db, projectId, 'master')
    if (render?.status !== 'done' || !render.outputS3Key) {
      return { ok: false, error: 'There is no finished master render to upload.' }
    }
    workingTitle = (await getProject(db, projectId))?.title ?? ''
  } else {
    const short = await getShort(db, targetId)
    if (!short) return { ok: false, error: 'Unknown Short' }
    if (!short.relatedLinkChecked) {
      return {
        ok: false,
        error: 'Tick the related-video-link chip on the Shorts screen first.',
      }
    }
    const render = short.renderId ? await getRender(db, short.renderId) : undefined
    if (render?.status !== 'done' || !render.outputS3Key) {
      return { ok: false, error: 'This Short has no finished render to upload.' }
    }
    workingTitle = short.title
  }

  const record = await ensurePublishRecord(db, type, targetId)
  if (record.status !== 'draft' && record.status !== 'failed') {
    return { ok: false, error: editableReason(record) ?? 'This item is already scheduled.' }
  }

  const draft = PublishDraftSchema.safeParse(record.metadata)
  // The working title is what the editor's field shows before a draft is
  // saved, so it is also what scheduling falls back to — refusing here would
  // contradict a screen that plainly displays a title.
  const title = (draft.success ? draft.data.title?.trim() : undefined) || workingTitle.slice(0, 100)
  if (!title) return { ok: false, error: 'Pick or write a title first.' }
  if (type === 'master' && record.uploadedThumbKeys.length === 0) {
    return { ok: false, error: 'Drop a thumbnail PNG first — masters need one.' }
  }

  const ingredients = await descriptionIngredients(db, projectId)
  const composed = composeDescription({
    body: draft.success ? (draft.data.descriptionBody ?? ingredients.hook) : ingredients.hook,
    // Chapter stamps only mean something on the full video.
    chapters: type === 'master' ? ingredients.chapters : [],
    sources: ingredients.sources,
    // The bed plays under Shorts too — the licence rides on every upload.
    musicAttribution: ingredients.musicAttribution,
  })

  const metadata = PublishMetadataSchema.safeParse({
    title,
    description: composed.description,
    tags: draft.success ? draft.data.tags : [],
  })
  if (!metadata.success) {
    return {
      ok: false,
      error:
        "The composed description is over YouTube's 5000-character limit even with sources " +
        'trimmed — shorten the opening text.',
    }
  }

  // The row first (status back to draft when retrying a failure), THEN the
  // event. A runner that fires between the two finds a claimable record.
  await updatePublishRecord(db, record.id, {
    status: 'draft',
    publishAt,
    metadata: { ...record.metadata, ...metadata.data },
    error: null,
  })

  try {
    await inngest.send(events.publishRequested.create({ projectId, targetType: type, targetId }))
  } catch (error) {
    console.error('[publish] could not request the upload', error)
    return {
      ok: false,
      error: 'The slot is saved, but Inngest could not be reached to start the upload.',
    }
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

/**
 * Move an already-scheduled video to a different slot.
 *
 * Scheduling put the video on YouTube as private with a `publishAt`;
 * nothing about that is final until the moment arrives, and YouTube lets
 * `videos.update` move it. So "once it's set it's set" was a gap, not a
 * rule: this action re-points the video's publish moment and then the row,
 * in that order — the row only says what YouTube has already accepted.
 * Live videos stay refusable: a public video has no moment left to move.
 */
export async function reschedulePublish(
  targetType: string,
  targetId: string,
  publishAtIso: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const publishAt = new Date(publishAtIso)
  if (Number.isNaN(publishAt.getTime())) return { ok: false, error: 'That is not a date.' }
  if (publishAt.getTime() <= Date.now()) {
    return { ok: false, error: 'That slot is in the past — pick one ahead of now.' }
  }

  const record = await getPublishRecord(db, type, targetId)
  if (!record) return { ok: false, error: 'Nothing has been scheduled for this item yet.' }
  if (record.status !== 'scheduled') {
    return {
      ok: false,
      error:
        record.status === 'live'
          ? 'This video is already public — there is no moment left to move.'
          : record.status === 'uploading' || record.status === 'uploaded'
            ? 'The upload is still finishing — move it once it reads Scheduled.'
            : 'This item is not scheduled yet — use a slot button to schedule it.',
    }
  }
  if (!record.youtubeVideoId) {
    return { ok: false, error: 'The record has no YouTube video id — retry the upload instead.' }
  }

  if (!mockProvidersEnabled()) {
    const refreshToken = await youtubeRefreshToken(db, env.SECRETS_ENCRYPTION_KEY)
    if (!refreshToken) {
      return { ok: false, error: 'YouTube is not connected — Settings → Connections.' }
    }

    let accessToken: string
    try {
      accessToken = (await refreshAccessToken(refreshToken)).accessToken
    } catch (error) {
      if (error instanceof YoutubeAuthError && error.needsReconnect) {
        await recordVerifyResult(db, 'youtube', 'invalid')
        return {
          ok: false,
          error: 'YouTube no longer honours the stored consent — reconnect in Settings.',
        }
      }
      return { ok: false, error: 'Could not reach YouTube to move the slot. Try again.' }
    }

    const moved = await movePublishAt(accessToken, record.youtubeVideoId, publishAt.toISOString())
    if (!moved.ok) return { ok: false, error: moved.error ?? 'YouTube refused the new moment.' }
  }

  // Only after YouTube accepted (or in mock mode, where nothing is real):
  // the row must never claim a moment the platform does not hold.
  await updatePublishRecord(db, record.id, { publishAt })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/calendar')
  return { ok: true }
}

/** Failed → draft → re-emit. The mapped error stays visible until it works. */
export async function retryPublish(targetType: string, targetId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const record = await getPublishRecord(db, type, targetId)
  if (!record) return { ok: false, error: 'Nothing has been scheduled for this item yet.' }
  if (record.status !== 'failed') {
    return { ok: false, error: 'Only a failed upload can be retried.' }
  }
  if (!record.publishAt || record.publishAt.getTime() <= Date.now()) {
    return {
      ok: false,
      error: 'The publish slot has passed — pick a new one instead of retrying.',
    }
  }

  await updatePublishRecord(db, record.id, { status: 'draft' })
  try {
    await inngest.send(events.publishRequested.create({ projectId, targetType: type, targetId }))
  } catch (error) {
    console.error('[publish] could not retry the upload', error)
    return { ok: false, error: 'Could not reach Inngest to retry the upload.' }
  }

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// The handover from Shorts
// ---------------------------------------------------------------------------

/**
 * Shorts → publish is a human decision, not a gate: no runner waits on the
 * Shorts screen (curation has no "done" the machine could detect), so the
 * button moves the stage directly rather than emitting an approval into the
 * void.
 */
export async function advanceToPublish(projectId: string): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(projectId).success) return { ok: false, error: 'Unknown project' }

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }
  if (project.stage !== 'shorts') {
    return { ok: false, error: `This project is on the ${project.stage} stage, not shorts.` }
  }
  if (await hasLiveRun(db, projectId)) {
    return { ok: false, error: 'A run is still in flight — let it finish first.' }
  }

  await setProjectStage(db, projectId, { stage: 'publish', stageStatus: 'awaiting_review' })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
  return { ok: true }
}
