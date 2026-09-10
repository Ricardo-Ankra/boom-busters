import {
  countUploadsSince,
  getDossier,
  getProject,
  getRendersByIds,
  getSettings,
  latestRender,
  latestScriptParagraphSources,
  latestSnapshotForVideo,
  latestTimeline,
  listPublishRecords,
  listShorts,
  musicBedByR2Key,
} from '@boom-busters/db'
import type { Database, PublishRecordRow } from '@boom-busters/db'
import {
  PublishDraftSchema,
  quotaDayStartUtc,
  stripNarrationMarkup,
  TimelineSchema,
} from '@boom-busters/schemas'
import type { ScheduleSlot } from '@boom-busters/schemas'

/**
 * What the Publish screen (build spec section 11.3) needs in one read: an
 * item per publishable thing (the master, then each Short), its readiness in
 * words, its record's draft metadata and status, the description auto-block
 * ingredients (chapter timestamps from the master timeline, sources from the
 * dossier's usable claims, the hook paragraph), the schedule slots from
 * settings, and where today's upload budget stands.
 */

export interface PublishRecordProp {
  id: string
  status: PublishRecordRow['status']
  publishAtIso: string | null
  youtubeVideoId: string | null
  errorMessage: string | null
  title: string | null
  titleOptions: string[]
  descriptionBody: string | null
  tags: string[]
  thumbs: { key: string; url: string | null }[]
}

export interface PublishItemModel {
  targetType: 'master' | 'short'
  targetId: string
  /** The working title: the project's for the master, the card's for a Short. */
  label: string
  durationMs: number | null
  /** Everything the runner would refuse on, said before the button exists. */
  notReadyReason: string | null
  /**
   * The Studio related-link bookkeeping — null for the master, the chip's
   * state for a Short. Not a gate (decision 226): the link can only be set
   * in Studio AFTER the Short is on YouTube, so the Publish screen reminds
   * on scheduled cards instead of refusing draft ones.
   */
  relatedLinkChecked: boolean | null
  record: PublishRecordProp | null
}

/** The master's numbers, once the analytics cron has seen it live (M8). */
export interface MasterAnalytics {
  videoId: string
  snapshotDateIso: string
  views: number | null
  avgViewDurationSec: number | null
  retentionCurve: { pct: number; ratio: number }[] | null
}

export interface PublishModel {
  items: PublishItemModel[]
  /** For the description's chapter block — from the master timeline. */
  chapters: { title: string; startMs: number }[]
  /** For the description's source block — the dossier's usable claims. */
  sources: string[]
  /** The script's opening paragraph — the seed for the description body. */
  hook: string
  /**
   * The timeline bed's licence/attribution text (decision 207) — published
   * as the description's Music block. Null when there is no bed or the
   * library row carries no text.
   */
  musicAttribution: string | null
  slots: ScheduleSlot[]
  apiAuditPassed: boolean
  dailyUploadBudget: number
  uploadsToday: number
  /** Master duration, for the retention overlay's chapter positions. */
  masterDurationMs: number | null
  /** Null until the master has a video AND a snapshot. */
  analytics: MasterAnalytics | null
}

export function emptyPublishModel(): PublishModel {
  return {
    items: [],
    chapters: [],
    sources: [],
    hook: '',
    musicAttribution: null,
    slots: [],
    apiAuditPassed: false,
    dailyUploadBudget: 0,
    uploadsToday: 0,
    masterDurationMs: null,
    analytics: null,
  }
}

/** How many source links the description offers before the composer trims. */
const MAX_SOURCES = 12

/**
 * The description auto-block ingredients, from what is already on file.
 * Shared by the model (for the live preview) and the schedule action (which
 * composes the final text server-side) so the preview can never show a
 * description the action would not write.
 */
export function deriveIngredients(input: {
  master: { narration: { chapterId: string; startMs: number }[] } | null
  scriptChapters: { id: string; title: string; contentMd: string }[]
  claims: { sourceUrl: string | null; confidence: string; quarantined: boolean }[]
}): { chapters: { title: string; startMs: number }[]; sources: string[]; hook: string } {
  const chapterStarts = new Map<string, number>()
  for (const segment of input.master?.narration ?? []) {
    const known = chapterStarts.get(segment.chapterId)
    if (known === undefined || segment.startMs < known) {
      chapterStarts.set(segment.chapterId, segment.startMs)
    }
  }
  const chapters = input.scriptChapters
    .filter((chapter) => chapterStarts.has(chapter.id))
    .map((chapter) => ({ title: chapter.title, startMs: chapterStarts.get(chapter.id)! }))
    .sort((a, b) => a.startMs - b.startMs)

  const sources = Array.from(
    new Set(
      input.claims
        .filter((claim) => !claim.quarantined && claim.confidence !== 'unverified')
        .map((claim) => claim.sourceUrl)
        .filter((url): url is string => typeof url === 'string' && url.length > 0),
    ),
  ).slice(0, MAX_SOURCES)

  const firstChapter = input.scriptChapters[0]
  const hook = firstChapter
    ? stripNarrationMarkup(
        firstChapter.contentMd
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .find((paragraph) => paragraph.length > 0 && !paragraph.startsWith('#')) ?? '',
      )
    : ''

  return { chapters, sources, hook }
}

/** The attribution the timeline's bed carries, or null at every gap. */
async function timelineMusicAttribution(
  db: Database,
  master: { music: { r2Key: string } | null } | null,
): Promise<string | null> {
  if (!master?.music) return null
  const bed = await musicBedByR2Key(db, master.music.r2Key)
  return bed?.attributionText?.trim() || null
}

/** The same ingredients straight from the database — the actions' entry. */
export async function descriptionIngredients(
  db: Database,
  projectId: string,
): Promise<{
  chapters: { title: string; startMs: number }[]
  sources: string[]
  hook: string
  musicAttribution: string | null
}> {
  const [timelineRow, scriptSources, dossier] = await Promise.all([
    latestTimeline(db, projectId),
    latestScriptParagraphSources(db, projectId),
    getDossier(db, projectId),
  ])
  const master = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  return {
    ...deriveIngredients({
      master,
      scriptChapters: scriptSources.chapters,
      claims: dossier?.claims ?? [],
    }),
    musicAttribution: await timelineMusicAttribution(db, master),
  }
}

function toRecordProp(
  row: PublishRecordRow,
  thumbs: { key: string; url: string | null }[],
): PublishRecordProp {
  const draft = PublishDraftSchema.safeParse(row.metadata)
  const error = row.error as { message?: string } | null
  return {
    id: row.id,
    status: row.status,
    publishAtIso: row.publishAt?.toISOString() ?? null,
    youtubeVideoId: row.youtubeVideoId,
    errorMessage: typeof error?.message === 'string' ? error.message : null,
    title: draft.success ? (draft.data.title ?? null) : null,
    titleOptions: draft.success ? draft.data.titleOptions : [],
    descriptionBody: draft.success ? (draft.data.descriptionBody ?? null) : null,
    tags: draft.success ? draft.data.tags : [],
    thumbs,
  }
}

export async function publishModel(
  db: Database,
  projectId: string,
  options: {
    /** Presigner for thumbnail previews; null when R2 is not configured. */
    presign: ((key: string) => Promise<string>) | null
  },
): Promise<PublishModel> {
  const project = await getProject(db, projectId)
  if (!project) return emptyPublishModel()

  const [shorts, masterRender, timelineRow, scriptSources, dossier, settings] = await Promise.all([
    listShorts(db, projectId),
    latestRender(db, projectId, 'master'),
    latestTimeline(db, projectId),
    latestScriptParagraphSources(db, projectId),
    getDossier(db, projectId),
    getSettings(db),
  ])

  const [records, uploadsToday] = await Promise.all([
    listPublishRecords(db, { projectId, shortIds: shorts.map((short) => short.id) }),
    countUploadsSince(db, quotaDayStartUtc(new Date())),
  ])
  const recordFor = (targetType: 'master' | 'short', targetId: string) =>
    records.find((row) => row.targetType === targetType && row.targetId === targetId)

  const master = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  const { chapters, sources, hook } = deriveIngredients({
    master,
    scriptChapters: scriptSources.chapters,
    claims: dossier?.claims ?? [],
  })

  // --- Items ---------------------------------------------------------------

  const thumbsFor = async (row: PublishRecordRow | undefined) => {
    if (!row) return []
    return Promise.all(
      row.uploadedThumbKeys.map(async (key) => ({
        key,
        url: options.presign ? await options.presign(key) : null,
      })),
    )
  }

  const masterRecord = recordFor('master', projectId)
  const masterDurationMs = master
    ? master.narration.reduce((end, seg) => Math.max(end, seg.startMs + seg.durationMs), 0)
    : null

  // Everything below the fold runs while the items assemble (decision 237):
  // the card renders in one batch instead of one lookup per Short, and the
  // attribution and retention reads stop serialising behind the loop.
  const [rendersById, musicAttribution, snapshot, masterThumbs] = await Promise.all([
    getRendersByIds(
      db,
      shorts.flatMap((short) => (short.renderId ? [short.renderId] : [])),
    ),
    timelineMusicAttribution(db, master),
    // The retention overlay (M8): only once the master has a YouTube video
    // and the analytics cron has snapshotted it — absent, not empty, before.
    masterRecord?.youtubeVideoId
      ? latestSnapshotForVideo(db, masterRecord.youtubeVideoId)
      : Promise.resolve(undefined),
    masterRecord ? thumbsFor(masterRecord) : Promise.resolve([]),
  ])

  const items: PublishItemModel[] = [
    {
      targetType: 'master',
      targetId: projectId,
      label: project.title,
      durationMs: masterDurationMs,
      notReadyReason:
        masterRender?.status === 'done' && masterRender.outputS3Key
          ? null
          : 'There is no finished master render yet.',
      relatedLinkChecked: null,
      record: masterRecord ? toRecordProp(masterRecord, masterThumbs) : null,
    },
  ]

  for (const short of shorts) {
    const render = short.renderId ? rendersById.get(short.renderId) : undefined
    const record = recordFor('short', short.id)
    // The related-link chip is deliberately NOT a readiness condition
    // (decision 226): the link is a property set on the Short inside Studio,
    // which only exists once the Short is uploaded — gating the upload on it
    // was a deadlock. Scheduled cards carry the reminder instead.
    const notReadyReason =
      render?.status === 'done' && render.outputS3Key
        ? null
        : 'This Short has no finished render yet.'
    items.push({
      targetType: 'short',
      targetId: short.id,
      label: short.title,
      durationMs: null,
      notReadyReason,
      relatedLinkChecked: short.relatedLinkChecked,
      record: record ? toRecordProp(record, await thumbsFor(record)) : null,
    })
  }

  const analytics: MasterAnalytics | null =
    masterRecord?.youtubeVideoId && snapshot
      ? {
          videoId: masterRecord.youtubeVideoId,
          snapshotDateIso: snapshot.date.toISOString(),
          views: snapshot.views,
          avgViewDurationSec: snapshot.avgViewDurationSec,
          retentionCurve: snapshot.retentionCurve,
        }
      : null

  return {
    items,
    chapters,
    sources,
    hook,
    musicAttribution,
    slots: settings.publish.defaultScheduleSlots,
    apiAuditPassed: settings.publish.apiAuditPassed,
    dailyUploadBudget: settings.publish.dailyUploadBudget,
    uploadsToday,
    masterDurationMs,
    analytics,
  }
}
