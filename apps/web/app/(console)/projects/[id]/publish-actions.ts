'use server'

import { createHash } from 'node:crypto'
import {
  ensurePublishRecord,
  getLatestScript,
  getProject,
  getPublishRecord,
  getRender,
  getShort,
  hasLiveRun,
  latestRender,
  latestScriptParagraphSources,
  channelForProject,
  channelYoutubeConnected,
  channelYoutubeToken,
  recordChannelYoutubeVerify,
  scriptableClaims,
  setProjectStage,
  updatePublishRecord,
} from '@boom-busters/db'
import type { PublishRecordRow } from '@boom-busters/db'
import {
  CHAPTER_GLOSS_MAX,
  composeDescription,
  HASHTAGS_MAX,
  OutlineSchema,
  splitHashtags,
  PublishDraftSchema,
  PublishMetadataSchema,
  splitParagraphs,
  TeaserScriptSchema,
  UlidSchema,
} from '@boom-busters/schemas'
import {
  buildDescriptionRequest,
  buildTitlesRequest,
  mockDescription,
  mockProvidersEnabled,
  mockTitleOptions,
  parseDescriptionAnswer,
  parseTitleOptions,
} from '@boom-busters/providers'
import type { DescriptionAnswer, ScriptClaim } from '@boom-busters/providers'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { movePublishAt, refreshAccessToken, YoutubeAuthError } from '@/lib/youtube'
import { callForAnswer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { descriptionIngredients } from '@/lib/publish-review'
import { deleteObject, putObject, R2_PREFIX, storageConfigured } from '@/lib/storage'
import { THUMB_LIMIT, THUMB_MAX_BYTES, thumbnailDimensionError } from '@/lib/thumbnail-rules'
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
  draft: {
    title: string
    descriptionBody: string
    tags: string
    /** A comma or a "#" starts each one; the words inside one are joined (decision 303). */
    hashtags?: string
    /** By chapter id (decision 303). Absent keeps what is stored. */
    chapterGlosses?: Record<string, string>
  },
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
  const hashtags =
    draft.hashtags === undefined ? undefined : splitHashtags(draft.hashtags).slice(0, HASHTAGS_MAX)

  const parsed = PublishDraftSchema.safeParse({
    title: draft.title.trim() || undefined,
    descriptionBody: draft.descriptionBody,
    tags,
    ...(hashtags !== undefined ? { hashtags } : {}),
    ...(draft.chapterGlosses !== undefined ? { chapterGlosses: draft.chapterGlosses } : {}),
  })
  if (!parsed.success) {
    return {
      ok: false,
      error:
        "That draft does not fit YouTube's limits — 100 characters of title, 60 tags of 100 " +
        `characters each, chapter notes of ${CHAPTER_GLOSS_MAX} characters.`,
    }
  }

  const record = await ensurePublishRecord(db, type, targetId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }

  // An opening the owner rewrote is theirs, for the script as it is now
  // (decision 303); one left as it was keeps the version it was written for.
  const stored = PublishDraftSchema.safeParse(record.metadata)
  const body = parsed.data.descriptionBody ?? ''
  const rewritten = !stored.success || (stored.data.descriptionBody ?? '') !== body
  const { scriptVersion } = rewritten
    ? await latestScriptParagraphSources(db, projectId)
    : { scriptVersion: undefined }

  await mergeDraft(record, {
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    descriptionBody: body,
    ...(rewritten ? { bodyScriptVersion: scriptVersion } : {}),
    tags: parsed.data.tags,
    ...(hashtags !== undefined ? { hashtags: parsed.data.hashtags } : {}),
    ...(draft.chapterGlosses !== undefined ? { chapterGlosses: parsed.data.chapterGlosses } : {}),
  })

  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

/** The owner's tags first, then the written ones, inside YouTube's 500 characters. */
function joinTags(kept: readonly string[], written: readonly string[]): string[] {
  const tags: string[] = []
  const seen = new Set<string>()
  for (const tag of [...kept, ...written]) {
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    if ([...tags, tag].join(',').length > 500 || tags.length >= 60) break
    seen.add(key)
    tags.push(tag)
  }
  return tags
}

/** The film's facts, as the claim list every metadata call reads (decision 303). */
async function metadataGrounding(projectId: string): Promise<{
  claims: ScriptClaim[]
  centralQuestion: string | undefined
  scriptVersion: number
}> {
  const [claims, latest] = await Promise.all([
    scriptableClaims(db, projectId),
    getLatestScript(db, projectId),
  ])
  const outline = OutlineSchema.safeParse(latest?.script.outline)
  return {
    // An unverified claim is no ground for a public title or description,
    // and its source is not listed either (decision 303, review).
    claims: claims
      .filter((claim) => claim.confidence !== 'unverified')
      .map((claim) => ({
        id: claim.id,
        text: claim.text,
        sourceUrl: claim.sourceUrl,
        confidence: claim.confidence,
      })),
    centralQuestion: outline.success ? outline.data.centralQuestion : undefined,
    scriptVersion: latest?.script.version ?? 0,
  }
}

/**
 * The search description (decision 303): the opening, a gloss per chapter,
 * three hashtags and tags, written from the claim list and the film itself,
 * never from the pitch title. One metadata-tier call; mock mode answers
 * locally. Everything it writes stays editable before scheduling.
 */
export async function generateDescription(
  targetType: string,
  targetId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const record = await ensurePublishRecord(db, type, targetId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }

  const [grounding, ingredients, sources] = await Promise.all([
    metadataGrounding(projectId),
    descriptionIngredients(db, projectId),
    latestScriptParagraphSources(db, projectId),
  ])
  const textOf = new Map(sources.chapters.map((chapter) => [chapter.id, chapter.contentMd]))
  const chapters =
    type === 'master'
      ? ingredients.chapters.map((chapter) => ({
          title: chapter.title,
          text: textOf.get(chapter.id) ?? '',
        }))
      : []
  const shortText = type === 'short' ? await shortNarration(targetId, textOf) : undefined

  let answer: DescriptionAnswer
  if (mockProvidersEnabled()) {
    answer = mockDescription(chapters.length)
  } else {
    try {
      // The project's frozen bible, read here where the request is built.
      const frozen = await channelForProject(db, projectId)
      const written = await callForAnswer({
        request: buildDescriptionRequest({
          bible: frozen,
          channelName: frozen.name,
          target: type,
          claims: grounding.claims,
          ...(grounding.centralQuestion ? { centralQuestion: grounding.centralQuestion } : {}),
          chapters,
          ...(shortText ? { shortText } : {}),
        }),
        parse: (text, note) => parseDescriptionAnswer(text, chapters.length, note),
        complete: completeForProject(projectId, { estimateOutputTokens: 800 }),
      })
      if (!written.ok) {
        return { ok: false, error: `The description could not be written: ${written.issue}` }
      }
      answer = written.value
    } catch (error) {
      return {
        ok: false,
        error: `The description could not be written: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
  }

  const stored = PublishDraftSchema.safeParse(record.metadata)
  const patch = {
    descriptionBody: answer.body,
    bodyScriptVersion: grounding.scriptVersion,
    ...(type === 'master'
      ? {
          chapterGlosses: Object.fromEntries(
            ingredients.chapters.map((chapter, index) => [
              chapter.id,
              answer.chapterGlosses[index] ?? '',
            ]),
          ),
        }
      : {}),
    hashtags: answer.hashtags,
    tags: joinTags(stored.success ? stored.data.tags : [], answer.tags),
  }
  // A patch the draft schema would refuse would make the whole draft unreadable
  // at upload, which would then fall back to the pitch title (decision 303, review).
  if (!PublishDraftSchema.safeParse({ ...record.metadata, ...patch }).success) {
    return { ok: false, error: "The written description does not fit YouTube's limits." }
  }
  await mergeDraft(record, patch)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

/** What a Short says: a teaser's own beats, an excerpt's paragraphs of the script. */
async function shortNarration(
  shortId: string,
  textOf: ReadonlyMap<string, string>,
): Promise<string | undefined> {
  const short = await getShort(db, shortId)
  if (!short) return undefined
  if (short.kind === 'teaser') {
    const script = TeaserScriptSchema.safeParse(short.teaserScript)
    return script.success ? script.data.paragraphs.map((p) => p.text).join(' ') : undefined
  }
  const chapter = textOf.get(short.segmentRef.chapterId)
  if (chapter === undefined) return undefined
  return splitParagraphs(chapter)
    .slice(short.segmentRef.fromParagraph, short.segmentRef.toParagraph + 1)
    .join(' ')
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
    const [{ hook }, grounding, sources] = await Promise.all([
      descriptionIngredients(db, projectId),
      metadataGrounding(projectId),
      latestScriptParagraphSources(db, projectId),
    ])
    // A Short's titles are written from what it says, not the film's hook.
    const shortText =
      type === 'short'
        ? await shortNarration(
            targetId,
            new Map(sources.chapters.map((chapter) => [chapter.id, chapter.contentMd])),
          )
        : undefined
    try {
      // The project's frozen bible, read here where the request is built.
      const frozen = await channelForProject(db, projectId)
      // At most two calls (decision 293): a cut-off is asked once more at
      // double the budget, a refusal once more with its reason. An unusable
      // title is still dropped by the parser, as ordinary filtering.
      const answer = await callForAnswer({
        request: buildTitlesRequest({
          bible: frozen,
          channelName: frozen.name,
          caseTitle: project.caseTitle,
          hook: hook || project.title,
          target: type,
          workingTitle,
          // The pitch title can carry a figure the research did not support;
          // the claims are where a title's facts come from (decision 303).
          claims: grounding.claims,
          ...(grounding.centralQuestion ? { centralQuestion: grounding.centralQuestion } : {}),
          ...(shortText ? { shortText } : {}),
        }),
        parse: (text) => parseTitleOptions(text),
        complete: completeForProject(projectId, { estimateOutputTokens: 500 }),
      })
      if (!answer.ok) {
        return { ok: false, error: `The titles could not be generated: ${answer.issue}` }
      }
      titles = answer.value
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
// Thumbnails — required on masters, optional on Shorts (decision 232). The
// Shorts feed plays the video itself, but search results and channel pages
// show the thumbnail, so the owner may set one; nothing gates on it.
// ---------------------------------------------------------------------------

// The rule itself lives in `lib/thumbnail-rules.ts`, which the dropzone
// imports too: a 'use server' module may only EXPORT async functions, but it
// may import whatever it likes, so the two sides no longer keep their own
// copies of the numbers (decision 251).

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

  const targetType = String(formData.get('targetType') ?? 'master')
  const targetId = String(formData.get('targetId') ?? '')
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'
  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

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
  // Per target type: a Short's thumbnail is vertical, and enforcing the
  // master's 16:9 floor on one refused the correct file (decision 251).
  const tooSmall = thumbnailDimensionError(type, dimensions)
  if (tooSmall) return { ok: false, error: tooSmall }

  if (!storageConfigured()) {
    return { ok: false, error: 'Uploads need R2 configured — there is nowhere to store the PNG.' }
  }

  const record = await ensurePublishRecord(db, type, targetId)
  const blocked = editableReason(record)
  if (blocked) return { ok: false, error: blocked }
  if (record.uploadedThumbKeys.length >= THUMB_LIMIT) {
    return {
      ok: false,
      error: `Three thumbnails are already stored — remove one to add another.`,
    }
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
  // Keyed by target: the master's targetId IS the projectId, so its keys
  // keep their historical shape; a Short's live under its own id.
  const key = `${R2_PREFIX}/thumbs/${targetId}/${hash}.png`
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

export async function removeThumbnail(
  targetType: string,
  targetId: string,
  key: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'
  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const record = await getPublishRecord(db, type, targetId)
  if (!record || !record.uploadedThumbKeys.includes(key)) {
    return { ok: false, error: 'That thumbnail is not on this item.' }
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

/**
 * The shared write for both ways an upload starts (decision 226): verify the
 * render, compose the final metadata, write the row — status back to draft
 * when retrying a failure — and only then emit `publish/requested`.
 *
 * The runner re-checks all of this (its preflight is the enforcement), but a
 * button that accepts and then immediately refuses in the activity feed is a
 * worse experience than one that says why here.
 */
async function requestUpload(
  type: 'master' | 'short',
  targetId: string,
  projectId: string,
  publishAt: Date,
  privacyStatus: 'private' | 'public',
): Promise<ActionResult> {
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
  const glosses: Record<string, string> = draft.success ? draft.data.chapterGlosses : {}
  const composed = composeDescription({
    body: draft.success ? (draft.data.descriptionBody ?? ingredients.hook) : ingredients.hook,
    // Chapter stamps only mean something on the full video; each carries its
    // search gloss when one was written (decision 303).
    chapters:
      type === 'master'
        ? ingredients.chapters.map((chapter) => ({ ...chapter, gloss: glosses[chapter.id] }))
        : [],
    sources: ingredients.sources,
    // The bed plays under Shorts too — the licence rides on every upload.
    musicAttribution: ingredients.musicAttribution,
    hashtags: draft.success ? draft.data.hashtags : [],
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
        'trimmed — shorten the opening or the chapter notes.',
    }
  }

  // The row first (status back to draft when retrying a failure), THEN the
  // event. A runner that fires between the two finds a claimable record.
  // `privacyStatus` is written every time so a failed publish-now that gets
  // re-scheduled onto a slot goes back to private-with-a-moment.
  await updatePublishRecord(db, record.id, {
    status: 'draft',
    publishAt,
    privacyStatus,
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

  return requestUpload(type, targetId, projectId, publishAt, 'private')
}

/**
 * Upload immediately instead of onto a slot (decision 226). Once the API
 * audit has passed the video goes up public and is live as soon as YouTube
 * finishes processing; before that the API cannot flip a video public, so it
 * goes up private with no scheduled moment and the human flips it in Studio
 * — the same manual step the audit checklist already owns.
 */
export async function publishNow(targetType: string, targetId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const { settings } = await channelForProject(db, projectId)
  const privacy = settings.publish.apiAuditPassed ? 'public' : 'private'
  // `publishAt` records the intended public moment — now. The runner sees a
  // moment that is not ahead and omits it from the upload job.
  return requestUpload(type, targetId, projectId, new Date(), privacy)
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
    const refreshToken = await channelYoutubeToken(db, record.channelId, env.SECRETS_ENCRYPTION_KEY)
    if (!refreshToken) {
      return { ok: false, error: 'YouTube is not connected — Settings → Connections.' }
    }
    // A token on an unverified or invalid connection may belong to another
    // YouTube account: never move a slot with it.
    if (!(await channelYoutubeConnected(db, record.channelId))) {
      return {
        ok: false,
        error:
          'The YouTube connection for this channel needs reconnecting. Open Settings, Connections.',
      }
    }

    let accessToken: string
    try {
      accessToken = (await refreshAccessToken(refreshToken)).accessToken
    } catch (error) {
      if (error instanceof YoutubeAuthError && error.needsReconnect) {
        await recordChannelYoutubeVerify(db, record.channelId, 'invalid')
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
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/**
 * Run the analytics pass now instead of waiting for the next 06:00 UTC cron.
 * The runner has listened on `analytics/refresh.requested` since M8 "so the
 * owner has a button" — this is that button's action, finally built (owner
 * report, 2026-09-09: the snapshot step failed on a Google-side API toggle,
 * and the only retry on offer was tomorrow). Free apart from YouTube API
 * quota, so no confirm step.
 */
export async function refreshAnalytics(projectId: string): Promise<ActionResult> {
  await requireOwner()
  const parsed = UlidSchema.safeParse(projectId)
  if (!parsed.success) return { ok: false, error: 'Unknown project' }
  try {
    const { channelId } = await channelForProject(db, parsed.data)
    await inngest.send(
      events.analyticsRefreshRequested.create({ requestedBy: 'publish-screen', channelId }),
    )
  } catch (error) {
    console.error('[analytics] could not request the refresh', error)
    return { ok: false, error: 'Could not reach Inngest to start the analytics pass.' }
  }
  return { ok: true }
}

/**
 * Forget an item's YouTube upload so it can be scheduled or published again
 * (owner report, 2026-09-10: the OAuth consent had picked the WRONG channel
 * of the account's two, and every upload landed there — the records were
 * locked at `scheduled`/`live` with no way back). Deliberately does not
 * touch YouTube: deleting the stray video is the human's act in Studio, on
 * the channel that actually holds it. The refusal while uploading stands —
 * a job mid-flight would just re-mark the record when it finishes.
 */
export async function unlinkPublishRecord(
  targetType: string,
  targetId: string,
): Promise<ActionResult> {
  await requireOwner()
  const invalid = parseTarget(targetType, targetId)
  if (invalid) return invalid
  const type = targetType as 'master' | 'short'

  const projectId = await projectIdOf(type, targetId)
  if (!projectId) return { ok: false, error: 'Unknown target' }

  const record = await getPublishRecord(db, type, targetId)
  if (!record) return { ok: false, error: 'Nothing has been uploaded for this item yet.' }
  if (record.status === 'uploading' || record.status === 'uploaded') {
    return { ok: false, error: 'The upload is still finishing — wait for it to settle first.' }
  }

  await updatePublishRecord(db, record.id, {
    status: 'draft',
    youtubeVideoId: null,
    publishAt: null,
    privacyStatus: 'private',
    error: null,
  })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/c/[slug]', 'layout')
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
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}

/**
 * Publish → done is the same shape as shorts → publish: a human decision,
 * not a gate (decision 226). Nothing waits on "everything is scheduled" —
 * how many of the Shorts go up, and when, is curation — so a visible button
 * ends the pipeline instead of a trigger that would have to guess. Scheduled
 * uploads keep running on their own; every screen stays reachable from the
 * rail.
 */
export async function markProjectDone(projectId: string): Promise<ActionResult> {
  await requireOwner()
  if (!UlidSchema.safeParse(projectId).success) return { ok: false, error: 'Unknown project' }

  const project = await getProject(db, projectId)
  if (!project) return { ok: false, error: 'Unknown project' }
  if (project.stage !== 'publish') {
    return { ok: false, error: `This project is on the ${project.stage} stage, not publish.` }
  }
  if (await hasLiveRun(db, projectId)) {
    return { ok: false, error: 'A run is still in flight — let it finish first.' }
  }

  await setProjectStage(db, projectId, { stage: 'done', stageStatus: 'approved' })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/c/[slug]', 'layout')
  return { ok: true }
}
