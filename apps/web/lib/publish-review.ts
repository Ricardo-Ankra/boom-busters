import {
  approvedTalkingPointSet,
  channelForProject,
  countUploadsSince,
  dismissedTermKeys,
  getArticleSources,
  getDossier,
  firstSnapshotDateForVideo,
  getProject,
  getRendersByIds,
  latestRender,
  latestScriptParagraphSources,
  latestSnapshotForVideo,
  latestTimeline,
  listCastMembers,
  listPublishRecords,
  listShorts,
  listShotSlots,
  musicBedByR2Key,
  rankChecksForVideo,
  searchReportsForVideo,
} from '@boom-busters/db'
import type { Database, PublishRecordRow } from '@boom-busters/db'
import {
  buildSearchReport,
  cohesionReport,
  DEFAULT_RESEARCH_THRESHOLDS,
  dropFixedParagraphs,
  matchTermDeterministic,
  nameMatches,
  normaliseArticleUrl,
  PublishDraftSchema,
  quotaDayStartUtc,
  researchKeywords,
  ShotBriefSchema,
  SlotCandidateSchema,
  sourceLabel,
  stripNarrationMarkup,
  TimelineSchema,
  timelineDurationMs,
} from '@boom-busters/schemas'
import type {
  BriefFit,
  CohesionReport,
  DescriptionSource,
  FixedLines,
  ScheduleSlot,
  SearchBrief,
  SearchReport,
  TermBucket,
  TitleSlot,
} from '@boom-busters/schemas'
import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import { z } from 'zod'
import { SEARCH_SOURCE_KEY } from './youtube-analytics'
import { pillarOf } from './pillar'
import { shortSlotsAfter } from './schedule-slots'

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
  /** VidIQ's score by option text; null is scored with no number, a missing key is unscored. */
  titleScores: Record<string, number | null>
  /** Why the last scoring run kept no scores, or kept only some; empty when it did not fail. */
  titleScoreNote: string
  /** The format's required title slots each option lacks, by option text. */
  titleSlotMisses: Record<string, TitleSlot[]>
  descriptionBody: string | null
  /** The script version the saved opening was written for; null before 303 kept it. */
  bodyScriptVersion: number | null
  /** The saved opening predates the current script (decision 303). */
  bodyStale: boolean
  /** One search gloss per chapter, in order (decision 303). */
  /** Search glosses by chapter id; a chapter the script no longer has is ignored. */
  chapterGlosses: Record<string, string>
  hashtags: string[]
  tags: string[]
  /** The tags that came from the case's search brief, so the screen can mark them. */
  searchTags: string[]
  /** The channel, format and pillar tags in the list, so the screen can mark them. */
  channelTags: string[]
  /** The channel tags left out to keep the list inside YouTube's limit. */
  channelTagsDropped: string[]
  thumbs: { key: string; url: string | null }[]
}

export interface PublishItemModel {
  targetType: 'master' | 'short'
  targetId: string
  /** The working title: the project's for the master, the card's for a Short. */
  label: string
  /**
   * Which kind of Short this is (decision 225), so its card can tell the
   * teaser from the excerpts. Null for the master.
   */
  shortKind: 'excerpt' | 'teaser' | 'point' | null
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
  /**
   * Real people shown by generated likeness in the chosen visuals (decision
   * 252). Non-empty means the upload sets YouTube's altered-content label,
   * and the card says so. Shorts inherit the master's list: they are cut
   * from the same visuals.
   */
  syntheticLikenesses: string[]
  /**
   * Where the topic, format and pillar keywords show up across the master's
   * copy. Information only. Null for a Short.
   */
  cohesion: CohesionReport | null
  /**
   * The frozen brief's channel fit with what the panel needs to word it: the
   * case's pillar key and the bible's pillars. Master only; absent when the
   * project froze no fit.
   */
  briefFit?: {
    fit: BriefFit
    casePillarKey: string
    pillars: { key: string; label: string }[]
  } | null
  /**
   * When an unscheduled point Short would take the next Short slot after its
   * long form (design section 8). A suggestion only: the owner's Schedule
   * click still decides. Absent for everything else.
   */
  suggestedPublishAtIso?: string | null
}

/**
 * The distinct names in `depicts` across still and hero slots whose CHOSEN
 * candidate is a generated one (fal or google), plus the names a copied
 * candidate carries from the still it was reused from (decision 261). An
 * uploaded real photograph of the same person is not synthetic media, so it
 * does not count.
 *
 * An entry that names a cast member is reported as the cast spells them
 * (decision 262): "Emad Mostaque" and "Emad Mostaque, founder and former
 * CEO of Stability AI" are one person on the label, not two. A name the
 * cast does not hold is reported as written.
 */
export function syntheticLikenesses(
  slots: readonly { brief: unknown; candidates: unknown }[],
  castNames: readonly string[] = [],
): string[] {
  const canonical = (entry: string) =>
    castNames.find((name) => nameMatches(entry, name)) ?? entry.trim()
  const names = new Set<string>()
  for (const slot of slots) {
    const candidates = z.array(SlotCandidateSchema).safeParse(slot.candidates)
    const chosen = candidates.success ? candidates.data.find((c) => c.chosen) : undefined
    if (!chosen || (chosen.provider !== 'fal' && chosen.provider !== 'google')) continue
    const brief = ShotBriefSchema.safeParse(slot.brief)
    const own =
      brief.success && (brief.data.type === 'still' || brief.data.type === 'hero')
        ? (brief.data.depicts ?? [])
        : []
    for (const name of [...own, ...(chosen.reusedFrom?.depicts ?? [])]) {
      names.add(canonical(name))
    }
  }
  return [...names]
}

/** The master's numbers, once the analytics cron has seen it live (M8). */
export interface MasterAnalytics {
  videoId: string
  snapshotDateIso: string
  views: number | null
  avgViewDurationSec: number | null
  retentionCurve: { pct: number; ratio: number }[] | null
}

/**
 * The search report card's data: the reports frozen at each checkpoint, the
 * live view built from the latest snapshot, the manual rank checks and the
 * dismissed term keys.
 */
export interface SearchReportsModel {
  /** Frozen reports, by checkpoint ascending. */
  frozen: SearchReport[]
  /**
   * Built on read from the latest snapshot (lifetime numbers, deterministic
   * matching only). Null when the master has no snapshot. Its outcome is
   * `too-early` until a report has frozen, and the card shows no verdict for
   * it either way.
   */
  live: SearchReport | null
  /** Manual VidIQ rank checks, newest first. */
  rankChecks: { keyword: string; position: number | null; checkedAt: string }[]
  /** Dismissed terms as `normaliseTerm(term, language).join(' ')`. */
  dismissed: string[]
  /** The language the terms are normalised in (the frozen brief's, else the bible's). */
  language?: string
  /** When the master went public, for the date a checkpoint becomes due. */
  publishedAt?: string | null
}

export function emptySearchReports(): SearchReportsModel {
  return { frozen: [], live: null, rankChecks: [], dismissed: [] }
}

/**
 * The live view of a video's search numbers: the latest snapshot's lifetime
 * figures, terms placed by words alone (no model call, so whatever the
 * research does not name is `unmatched`), and baselines that fall back to the
 * video's own figures. No outcome is judged: before any report has frozen it
 * is `too-early`.
 */
export function liveSearchReport(input: {
  snapshot: {
    views: number | null
    avgViewDurationSec: number | null
    retentionCurve: { pct: number; ratio: number }[] | null
    searchTerms: { term: string; views: number; minutes: number }[] | null
    subscribersGained: number | null
    likes: number | null
    comments: number | null
    ctrBySource: Record<string, number> | null
  }
  publishedAt: Date
  durationSec: number | null
  brief: SearchBrief | null
  language: string | undefined
  anyFrozen: boolean
  now: Date
}): SearchReport {
  const keywords = input.brief ? researchKeywords(input.brief) : { target: null, researched: [] }
  const terms = (input.snapshot.searchTerms ?? []).map((row) => {
    const hit = matchTermDeterministic(row.term, keywords, input.language)
    return {
      ...row,
      bucket: (hit ? hit.bucket : 'unmatched') as TermBucket,
      ...(hit ? { keyword: hit.keyword } : {}),
    }
  })
  const day = (moment: Date) => moment.toISOString().slice(0, 10)
  const report = buildSearchReport({
    checkpoint: 7,
    range: { start: day(input.publishedAt), end: day(input.now) },
    publishedAt: input.publishedAt.toISOString(),
    durationSec: input.durationSec,
    views: input.snapshot.views ?? 0,
    searchViews: input.snapshot.ctrBySource?.[SEARCH_SOURCE_KEY] ?? 0,
    avgViewDurationSec: input.snapshot.avgViewDurationSec,
    subscribersGained: input.snapshot.subscribersGained,
    likes: input.snapshot.likes,
    comments: input.snapshot.comments,
    retentionCurve: input.snapshot.retentionCurve,
    terms,
    targetKeyword: keywords.target,
    matching: 'none',
    rank: null,
    baselineInputs: {
      holdBand: [],
      holdChannel: [],
      dropBand: [],
      dropChannel: [],
      subsBand: [],
      subsChannel: [],
    },
    thresholds: DEFAULT_RESEARCH_THRESHOLDS,
    now: input.now,
  })
  return input.anyFrozen ? report : { ...report, outcome: 'too-early' }
}

export interface PublishModel {
  items: PublishItemModel[]
  /** For the description's chapter block — from the master timeline. */
  chapters: { id: string; title: string; startMs: number }[]
  /** For the description's source block — the dossier's usable claims, labelled (decision 303). */
  sources: DescriptionSource[]
  /** The script's opening paragraph — the seed for the description body. */
  hook: string
  /** The latest script's version, which a saved opening is measured against (decision 303). */
  scriptVersion: number
  /**
   * The timeline bed's licence/attribution text (decision 207) — published
   * as the description's Music block. Null when there is no bed or the
   * library row carries no text.
   */
  musicAttribution: string | null
  /** The channel's disclaimer, from the bible the project froze; the last block of the description. */
  disclaimer: string
  /** The channel's footer, from the same bible; the screen shows it on the master only. */
  footer: string
  /** The project froze a search brief, so VidIQ title scores are on offer. */
  hasSearchBrief: boolean
  /** What VidIQ charges to score one title, for the Score all estimate. */
  titleScoreCredits: number
  slots: ScheduleSlot[]
  apiAuditPassed: boolean
  dailyUploadBudget: number
  uploadsToday: number
  /** Master duration, for the retention overlay's chapter positions. */
  masterDurationMs: number | null
  /** Null until the master has a video AND a snapshot. */
  analytics: MasterAnalytics | null
  /** The search report card's data; empty before the master has a video. */
  searchReports: SearchReportsModel
}

export function emptyPublishModel(): PublishModel {
  return {
    items: [],
    chapters: [],
    sources: [],
    hook: '',
    scriptVersion: 0,
    musicAttribution: null,
    disclaimer: '',
    footer: '',
    hasSearchBrief: false,
    titleScoreCredits: VIDIQ_CREDIT_COST.scoreTitle,
    slots: [],
    apiAuditPassed: false,
    dailyUploadBudget: 0,
    uploadsToday: 0,
    masterDurationMs: null,
    analytics: null,
    searchReports: emptySearchReports(),
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
  claims: { text: string; sourceUrl: string | null; confidence: string; quarantined: boolean }[]
  /** What the article records read, by normalised URL (decision 303). */
  articles?: ReadonlyMap<string, { outlet: string | null; headline: string | null }>
  /** The project's format: its fixed lines are not the hook. */
  format: FixedLines
}): {
  chapters: { id: string; title: string; startMs: number }[]
  sources: DescriptionSource[]
  hook: string
} {
  const chapterStarts = new Map<string, number>()
  for (const segment of input.master?.narration ?? []) {
    const known = chapterStarts.get(segment.chapterId)
    if (known === undefined || segment.startMs < known) {
      chapterStarts.set(segment.chapterId, segment.startMs)
    }
  }
  const chapters = input.scriptChapters
    .filter((chapter) => chapterStarts.has(chapter.id))
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      startMs: chapterStarts.get(chapter.id)!,
    }))
    .sort((a, b) => a.startMs - b.startMs)

  // Each usable source once, in claim order, labelled with the publisher's
  // own words (decision 303): the outlet and the article's headline.
  const urls = new Set<string>()
  for (const claim of input.claims) {
    if (claim.quarantined || claim.confidence === 'unverified') continue
    if (typeof claim.sourceUrl !== 'string' || claim.sourceUrl.length === 0) continue
    urls.add(claim.sourceUrl)
  }
  const sources = [...urls].slice(0, MAX_SOURCES).map((url) => {
    const article = input.articles?.get(normaliseArticleUrl(url) ?? url)
    return {
      url,
      label: sourceLabel({
        url,
        outlet: article?.outlet ?? null,
        headline: article?.headline ?? null,
      }),
    }
  })

  const firstChapter = input.scriptChapters[0]
  const hook = firstChapter
    ? stripNarrationMarkup(
        dropFixedParagraphs(firstChapter.contentMd, input.format)
          .split(/\n{2,}/)
          .map((paragraph) => paragraph.trim())
          .find((paragraph) => paragraph.length > 0 && !paragraph.startsWith('#')) ?? '',
      )
    : ''

  return { chapters, sources, hook }
}

/**
 * Whether a saved opening was written for an earlier script (decision 303).
 * The Stability AI master was scheduled with the September script's opening
 * under a film rebuilt from the October one, and nothing said so. An opening
 * saved before versions were kept counts as stale too, unless it is the
 * current hook word for word.
 */
export function openingIsStale(input: {
  body: string | undefined
  bodyScriptVersion: number | undefined
  hook: string
  scriptVersion: number
}): boolean {
  const body = input.body?.trim() ?? ''
  if (body === '' || body === input.hook.trim()) return false
  return input.bodyScriptVersion === undefined || input.bodyScriptVersion < input.scriptVersion
}

/**
 * The words the first thirty seconds of narration carry, with the markup
 * stripped: the first thirty seconds after the format's fixed lines.
 */
export function spokenIntro(chapterMd: string, wordsPerMinute: number, format: FixedLines): string {
  const count = Math.round((30 * wordsPerMinute) / 60)
  return stripNarrationMarkup(
    dropFixedParagraphs(chapterMd, format)
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0 && !paragraph.startsWith('#'))
      .join(' '),
  )
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, count)
    .join(' ')
}

/** What the article records hold for these sources, by normalised URL. */
async function articlesFor(
  db: Database,
  claims: readonly { sourceUrl: string | null }[],
): Promise<Map<string, { outlet: string | null; headline: string | null }>> {
  const urls = [
    ...new Set(
      claims.flatMap((claim) => {
        const url = claim.sourceUrl ? normaliseArticleUrl(claim.sourceUrl) : null
        return url ? [url] : []
      }),
    ),
  ]
  const rows = await getArticleSources(db, urls)
  return new Map(rows.map((row) => [row.url, { outlet: row.outlet, headline: row.headline }]))
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
  chapters: { id: string; title: string; startMs: number }[]
  sources: DescriptionSource[]
  hook: string
  musicAttribution: string | null
  /** The channel's disclaimer, from the project's frozen bible. */
  disclaimer: string
  /** The channel's footer, from the project's frozen bible; the actions add it to a master's description only. */
  footer: string
  /** The latest script's version, which a saved opening is measured against. */
  scriptVersion: number
  /** The latest timeline's length in seconds; null when there is no timeline. */
  runtimeSec: number | null
}> {
  const [timelineRow, scriptSources, dossier, channel] = await Promise.all([
    latestTimeline(db, projectId),
    latestScriptParagraphSources(db, projectId),
    getDossier(db, projectId),
    channelForProject(db, projectId),
  ])
  const master = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  const claims = dossier?.claims ?? []
  return {
    ...deriveIngredients({
      master,
      scriptChapters: scriptSources.chapters,
      claims,
      articles: await articlesFor(db, claims),
      format: channel.format,
    }),
    musicAttribution: await timelineMusicAttribution(db, master),
    disclaimer: channel.bible.disclaimer,
    footer: channel.bible.channelFooter,
    scriptVersion: scriptSources.scriptVersion,
    runtimeSec: master ? timelineDurationMs(master) / 1000 : null,
  }
}

function toRecordProp(
  row: PublishRecordRow,
  thumbs: { key: string; url: string | null }[],
  current: { hook: string; scriptVersion: number },
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
    titleScores: draft.success ? draft.data.titleScores : {},
    titleScoreNote: draft.success ? draft.data.titleScoreNote : '',
    titleSlotMisses: draft.success ? draft.data.titleSlotMisses : {},
    descriptionBody: draft.success ? (draft.data.descriptionBody ?? null) : null,
    bodyScriptVersion: draft.success ? (draft.data.bodyScriptVersion ?? null) : null,
    bodyStale:
      draft.success &&
      openingIsStale({
        body: draft.data.descriptionBody,
        bodyScriptVersion: draft.data.bodyScriptVersion,
        hook: current.hook,
        scriptVersion: current.scriptVersion,
      }),
    chapterGlosses: draft.success ? draft.data.chapterGlosses : {},
    hashtags: draft.success ? draft.data.hashtags : [],
    tags: draft.success ? draft.data.tags : [],
    searchTags: draft.success ? draft.data.searchTags : [],
    channelTags: draft.success ? draft.data.channelTags : [],
    channelTagsDropped: draft.success ? draft.data.channelTagsDropped : [],
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

  const channel = await channelForProject(db, projectId)
  const settings = channel.settings
  const [shorts, masterRender, timelineRow, scriptSources, dossier, slotRows, cast] =
    await Promise.all([
      listShorts(db, projectId),
      latestRender(db, projectId, 'master'),
      latestTimeline(db, projectId),
      latestScriptParagraphSources(db, projectId),
      getDossier(db, projectId),
      listShotSlots(db, projectId),
      listCastMembers(db, projectId),
    ])

  const [records, uploadsToday] = await Promise.all([
    listPublishRecords(db, { projectId, shortIds: shorts.map((short) => short.id) }),
    countUploadsSince(db, channel.channelId, quotaDayStartUtc(new Date())),
  ])
  const recordFor = (targetType: 'master' | 'short', targetId: string) =>
    records.find((row) => row.targetType === targetType && row.targetId === targetId)

  const master = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  const { chapters, sources, hook } = deriveIngredients({
    master,
    scriptChapters: scriptSources.chapters,
    claims: dossier?.claims ?? [],
    articles: await articlesFor(db, dossier?.claims ?? []),
    format: channel.format,
  })
  const current = { hook, scriptVersion: scriptSources.scriptVersion }

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
  const likenesses = syntheticLikenesses(
    slotRows,
    cast.map((member) => member.name),
  )
  const masterDurationMs = master
    ? master.narration.reduce((end, seg) => Math.max(end, seg.startMs + seg.durationMs), 0)
    : null

  // Everything below the fold runs while the items assemble (decision 237):
  // the card renders in one batch instead of one lookup per Short, and the
  // attribution and retention reads stop serialising behind the loop.
  const [rendersById, musicAttribution, snapshot, firstSnapshotDate, masterThumbs] =
    await Promise.all([
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
      masterRecord?.youtubeVideoId
        ? firstSnapshotDateForVideo(db, masterRecord.youtubeVideoId)
        : Promise.resolve(null),
      masterRecord ? thumbsFor(masterRecord) : Promise.resolve([]),
    ])

  // The master's copy against the topic, the format and the pillar, from the
  // frozen bible. The opening is the saved body alone (the description starts
  // with it): an unwritten one is not credited with the generated hook.
  const masterCohesion = (): CohesionReport => {
    const draft = masterRecord ? toRecordProp(masterRecord, [], current) : null
    const brief = project.searchBrief
    const target = brief?.targetKeyword?.keyword
    const pillar = pillarOf(channel.bible, project.caseCategory)
    return cohesionReport({
      title: draft?.title ?? draft?.titleOptions[0] ?? '',
      description: draft?.descriptionBody?.trim() ? draft.descriptionBody : '',
      tags: draft?.tags ?? [],
      hashtags: draft?.hashtags ?? [],
      spokenIntro: spokenIntro(
        scriptSources.chapters[0]?.contentMd ?? '',
        channel.format.wordsPerMinute,
        channel.format,
      ),
      topic: [target, brief?.subject ?? project.caseTitle].filter(
        (text): text is string => typeof text === 'string' && text.trim() !== '',
      ),
      formatKeywords: channel.format.keywords,
      pillar: pillar ? { label: pillar.label, keywords: pillar.keywords } : null,
      channelHashtag: channel.bible.channelHashtag,
    })
  }

  const items: PublishItemModel[] = [
    {
      targetType: 'master',
      targetId: projectId,
      label: project.title,
      shortKind: null,
      durationMs: masterDurationMs,
      notReadyReason:
        masterRender?.status === 'done' && masterRender.outputS3Key
          ? null
          : 'There is no finished master render yet.',
      relatedLinkChecked: null,
      record: masterRecord ? toRecordProp(masterRecord, masterThumbs, current) : null,
      syntheticLikenesses: likenesses,
      cohesion: masterCohesion(),
      briefFit: project.searchBrief?.fit
        ? {
            fit: project.searchBrief.fit,
            casePillarKey: project.caseCategory,
            pillars: channel.bible.caseCategories.map(({ key, label }) => ({ key, label })),
          }
        : null,
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
      shortKind: short.kind,
      durationMs: null,
      notReadyReason,
      relatedLinkChecked: short.relatedLinkChecked,
      record: record ? toRecordProp(record, await thumbsFor(record), current) : null,
      syntheticLikenesses: likenesses,
      cohesion: null,
    })
  }

  // Unscheduled point Shorts take the Short slots after the long form, in
  // their talking-point order, skipping moments another item already holds.
  // A long form that is already live starts the search from now.
  if (masterRecord?.publishAt) {
    const order = new Map(
      ((await approvedTalkingPointSet(db, projectId))?.points ?? []).map((point) => [
        point.id,
        point.order,
      ]),
    )
    const waiting = items
      .filter((item) => item.shortKind === 'point' && !item.record?.publishAtIso)
      .map((item, position) => ({
        item,
        position,
        order:
          order.get(shorts.find((short) => short.id === item.targetId)?.pointId ?? '') ?? Infinity,
      }))
      .sort((a, b) => a.order - b.order || a.position - b.position)
    const held = new Set(
      records
        .filter((row) => row.publishAt && row.status !== 'failed')
        .map((row) => row.publishAt!.getTime()),
    )
    const from = new Date(Math.max(masterRecord.publishAt.getTime(), Date.now()))
    const free = shortSlotsAfter(
      from,
      settings.publish.defaultScheduleSlots,
      waiting.length + held.size,
    ).filter((at) => !held.has(at.getTime()))
    waiting.forEach(({ item }, index) => {
      const at = free[index]
      if (at) item.suggestedPublishAtIso = at.toISOString()
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

  const searchReports = await searchReportsModel(db, {
    channelId: channel.channelId,
    brief: project.searchBrief,
    bibleLanguage: channel.bible.language,
    videoId: masterRecord?.youtubeVideoId ?? null,
    publishedAt: livePublishedAt(masterRecord ?? null, firstSnapshotDate),
    snapshot,
    durationSec: masterDurationMs !== null ? masterDurationMs / 1000 : null,
  })

  return {
    items,
    chapters,
    sources,
    hook,
    scriptVersion: scriptSources.scriptVersion,
    musicAttribution,
    disclaimer: channel.bible.disclaimer,
    footer: channel.bible.channelFooter,
    hasSearchBrief: project.searchBrief !== null,
    titleScoreCredits: VIDIQ_CREDIT_COST.scoreTitle,
    slots: settings.publish.defaultScheduleSlots,
    apiAuditPassed: settings.publish.apiAuditPassed,
    dailyUploadBudget: settings.publish.dailyUploadBudget,
    uploadsToday,
    masterDurationMs,
    analytics,
    searchReports,
  }
}

/**
 * When the master went public for the live view: the scheduled time, else the day of its first
 * analytics snapshot (it starts the day the daily run first sees the video live and never moves),
 * else the record's last update, which drifts with every edit and is the last resort.
 */
export function livePublishedAt(
  record: { publishAt: Date | null; updatedAt: Date } | null,
  firstSnapshot: Date | null,
): Date | null {
  if (!record) return null
  return record.publishAt ?? firstSnapshot ?? record.updatedAt
}

async function searchReportsModel(
  db: Database,
  input: {
    channelId: string
    brief: SearchBrief | null
    bibleLanguage: string
    videoId: string | null
    publishedAt: Date | null
    snapshot: Awaited<ReturnType<typeof latestSnapshotForVideo>>
    durationSec: number | null
  },
): Promise<SearchReportsModel> {
  if (!input.videoId) return emptySearchReports()
  const language = input.brief?.language || input.bibleLanguage || undefined
  const [rows, checks, dismissed] = await Promise.all([
    searchReportsForVideo(db, input.videoId),
    rankChecksForVideo(db, input.videoId),
    dismissedTermKeys(db, input.channelId),
  ])
  const frozen: SearchReport[] = []
  for (const row of rows) {
    if (row.state === 'frozen' && row.report) frozen.push(row.report)
  }
  // YouTube's own publish time, as the first frozen report read it, wins over the record's.
  const frozenPublished = frozen[0] ? new Date(frozen[0].publishedAt) : null
  const publishedAt =
    frozenPublished && !Number.isNaN(frozenPublished.getTime())
      ? frozenPublished
      : input.publishedAt
  const live =
    input.snapshot && publishedAt
      ? liveSearchReport({
          snapshot: input.snapshot,
          publishedAt,
          durationSec: input.durationSec,
          brief: input.brief,
          language,
          anyFrozen: frozen.length > 0,
          now: new Date(),
        })
      : null
  return {
    frozen,
    live,
    rankChecks: checks.map((check) => ({
      keyword: check.keyword,
      position: check.position,
      checkedAt: check.checkedAt.toISOString(),
    })),
    dismissed: [...dismissed],
    ...(language ? { language } : {}),
    publishedAt: publishedAt?.toISOString() ?? null,
  }
}
