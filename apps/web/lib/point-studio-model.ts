import {
  channelForProject,
  getShort,
  latestScriptParagraphSources,
  latestTimeline,
  MOCK_KEY_PREFIX,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import {
  countWords,
  PointFetchesRecordSchema,
  PointPlanRecordSchema,
  PointScriptRecordSchema,
  PointVoiceRecordSchema,
  SHORT_PHASES,
  SHORT_RULES,
  teaserTextHash,
  TimelineSchema,
} from '@boom-busters/schemas'
import type {
  CropFocus,
  PointFetchesRecord,
  PointPlanRecord,
  PointShotMotion,
  PointVoiceRecord,
  PointWork,
  ShortPhase,
  SlotCandidate,
  Timeline,
  TimelineSlot,
} from '@boom-busters/schemas'
import { checkShortRules, layoutPointNarration } from '@boom-busters/timeline'
import type { RuleFinding } from '@boom-busters/timeline'
import { countNewPictures, pointParagraphAudio, pointVoiceHash } from '@/inngest/lib/point-build'
import type { TeaserFetchedOptionProp, TeaserShotOption } from '@/lib/shorts-review'
import {
  mockTeaserShotKey,
  slotFromTeaserCandidate,
  teaserCandidateReady,
} from '@/lib/teaser-fetch'
import { stillSlotEstimateUsd } from '@/lib/visual-assets'

/**
 * The point Short studio's model (playbook Shorts design 6): the script as
 * five labelled phases with a live word count and runtime, the shot list on
 * the voiced clock, the long form's slots as a library and the Short's
 * fetched pool, and the rule book's findings recomputed from the stored
 * master (a build stores only a count). Everything is plain JSON: the studio
 * is a client component.
 */

/**
 * How long the studio's slot of work (a fetch, a re-voice, a re-plan, an
 * assemble, a rebuild) refuses a second request (decision 234). Long enough to
 * outlive a re-plan that buys a few pictures; short enough that a run that
 * vanished without writing its failure cannot lock a Short for good.
 */
export const POINT_WORK_COOLDOWN_MS = 10 * 60 * 1000

export interface PointStudioShot {
  index: number
  startMs: number
  durationMs: number
  /** Presigned (or external) preview; null for drawn cards and mock keys. */
  thumbUrl: string | null
  /** The slot's type: still, stock, headline, chart and so on. */
  type: string
  crop: CropFocus
  motion: PointShotMotion
  /** A picture from the long form's board, or one fetched for this Short. */
  source: 'long form' | 'new'
}

export interface PointStudioParagraph {
  text: string
  chapterIndex: number
  chapterTitle: string | null
  /** True when stored audio exists AND still speaks the current text. */
  voiced: boolean
}

export interface PointStudioModel {
  phases: { phase: ShortPhase; paragraphs: PointStudioParagraph[] }[]
  words: number
  estimatedRuntimeSec: number
  shots: PointStudioShot[]
  /** The long form's slots, in master order: a library entry's index is its `ref`. */
  library: TeaserShotOption[]
  /** The Short's fetched pool: stock results and generated stills. */
  fetched: TeaserFetchedOptionProp[]
  findings: RuleFinding[]
  /** What one "Generate a still" buys. */
  stillEstimateUsd: number
  scriptBehind: boolean
  /** The plan was made for a voice or script this Short no longer has. */
  planBehind: boolean
  /** The studio's work in flight right now, within its cooldown; null when idle. */
  pending: PointWork | null
  /** Why the last piece of work stopped, in words; null when it did not. */
  failure: string | null
}

type Presign = ((key: string) => Promise<string>) | null | undefined

/** Whether a stored work state is still in flight (a stale one is not). */
export function pointWorkPending(
  state: PointFetchesRecord['state'] | undefined,
  now = Date.now(),
): PointWork | null {
  if (!state || state.state !== 'fetching') return null
  const startedAt = state.startedAt ? Date.parse(state.startedAt) : Number.NaN
  if (!Number.isFinite(startedAt)) return null
  return now - startedAt < POINT_WORK_COOLDOWN_MS ? state.what : null
}

/** Two slots show the same footage when their payloads agree exactly. */
function sameShot(a: TimelineSlot, b: TimelineSlot): boolean {
  return JSON.stringify(a.payload) === JSON.stringify(b.payload)
}

function srcOf(slot: TimelineSlot): { r2Key?: string; externalUrl?: string } | null {
  return slot.payload.kind === 'image' || slot.payload.kind === 'video' ? slot.payload.src : null
}

/** The findings of one stored Short, from its compiled master. Empty for a draft. */
export function pointFindings(row: {
  sourceTimeline: unknown
  pointScript: unknown
  pointPlan: unknown
  pointFetches: unknown
}): RuleFinding[] {
  const timeline = TimelineSchema.safeParse(row.sourceTimeline)
  const script = PointScriptRecordSchema.safeParse(row.pointScript)
  const plan = PointPlanRecordSchema.safeParse(row.pointPlan)
  if (!timeline.success || !script.success || !plan.success) return []
  const fetches = PointFetchesRecordSchema.safeParse(row.pointFetches)
  return checkShortRules({
    timeline: timeline.data,
    paragraphs: script.data.paragraphs,
    newImageCount: countNewPictures(plan.data, fetches.success ? fetches.data : null),
  })
}

/**
 * The full studio for one open point Short. Null when the stored script cannot
 * be read: one bad row degrades its own card, never the whole Shorts screen.
 */
export async function pointStudioModel(
  db: Database,
  shortId: string,
  options: { presign?: Presign } = {},
): Promise<PointStudioModel | null> {
  const row = await getShort(db, shortId)
  if (!row || row.kind !== 'point') throw new Error(`Short ${shortId} is not a point Short`)
  const parsedScript = PointScriptRecordSchema.safeParse(row.pointScript)
  if (!parsedScript.success) return null
  const script = parsedScript.data
  const voice = PointVoiceRecordSchema.safeParse(row.pointVoice)
  const plan = PointPlanRecordSchema.safeParse(row.pointPlan)
  const fetches = PointFetchesRecordSchema.safeParse(row.pointFetches)
  const [timelineRow, sources, channel] = await Promise.all([
    latestTimeline(db, row.projectId),
    latestScriptParagraphSources(db, row.projectId),
    channelForProject(db, row.projectId),
  ])
  const master: Timeline | null = timelineRow ? TimelineSchema.parse(timelineRow.json) : null
  const stored = TimelineSchema.safeParse(row.sourceTimeline)
  const mocked = mockProvidersEnabled()
  const presign = options.presign ?? null

  // Script: five labelled phases, each paragraph with its voice state.
  const voicedAt = (index: number, text: string): boolean => {
    if (!voice.success || voice.data.scriptVersion !== script.scriptVersion) return false
    const kept = voice.data.paragraphs[index]
    return kept !== undefined && kept.textHash === teaserTextHash(text)
  }
  const phases = SHORT_PHASES.map((phase) => ({
    phase,
    paragraphs: script.paragraphs.flatMap((paragraph, index): PointStudioParagraph[] =>
      paragraph.phase === phase
        ? [
            {
              text: paragraph.text,
              chapterIndex: paragraph.chapterIndex,
              chapterTitle: sources.chapters[paragraph.chapterIndex]?.title ?? null,
              voiced: voicedAt(index, paragraph.text),
            },
          ]
        : [],
    ),
  }))
  const words = script.paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph.text), 0)

  // The voiced clock, when the voice is the script's; otherwise the pace.
  let layout: ReturnType<typeof layoutPointNarration> | null = null
  if (voice.success) {
    try {
      layout = layoutPointNarration(pointParagraphAudio(script, voice.data))
    } catch {
      layout = null
    }
  }
  const estimatedRuntimeSec = Math.round(
    layout
      ? layout.narrationEndMs / 1000
      : (words / ((SHORT_RULES.wpmMin + SHORT_RULES.wpmMax) / 2)) * 60,
  )

  // Shots.
  const poolKeys = new Set<string>()
  const poolUrls = new Set<string>()
  for (const candidate of fetches.success ? fetches.data.candidates : []) {
    if (candidate.r2Key !== undefined) poolKeys.add(candidate.r2Key)
    // Mock mode stands a bookmark key in for bytes that never existed.
    poolKeys.add(mockTeaserShotKey(candidate.id))
    poolUrls.add(candidate.sourceUrl)
  }
  const shotUrlOf = async (slot: TimelineSlot): Promise<string | null> => {
    const src = srcOf(slot)
    if (!src) return null
    if (src.externalUrl) return src.externalUrl
    if (src.r2Key && !src.r2Key.startsWith(MOCK_KEY_PREFIX) && presign) return presign(src.r2Key)
    return null
  }
  const planShots = plan.success ? plan.data.shots : []
  const clockOf = (index: number): { startMs: number; durationMs: number } => {
    if (layout) {
      const startOf = (at: number): number =>
        at === 0 ? 0 : (layout!.words[planShots[at]!.startWord]?.startMs ?? 0)
      const start = startOf(index)
      const end = index === planShots.length - 1 ? layout.narrationEndMs : startOf(index + 1)
      return { startMs: start, durationMs: Math.max(0, end - start) }
    }
    // The voice is not the script's: the stored cut is the last honest clock.
    const slot =
      stored.success && stored.data.slots.length === planShots.length
        ? stored.data.slots[index]
        : undefined
    return { startMs: slot?.startMs ?? 0, durationMs: slot?.durationMs ?? 0 }
  }
  const shots: PointStudioShot[] = []
  for (const [index, shot] of planShots.entries()) {
    const slot = shot.slot
    const src = slot ? srcOf(slot) : null
    const isNew =
      src !== null &&
      ((src.r2Key !== undefined && poolKeys.has(src.r2Key)) ||
        (src.externalUrl !== undefined && poolUrls.has(src.externalUrl)))
    shots.push({
      index,
      ...clockOf(index),
      thumbUrl: slot ? await shotUrlOf(slot) : null,
      type: slot ? (slot.payload.kind === 'graphic-code' ? 'graphic' : slot.type) : 'pending',
      crop: shot.crop,
      motion: shot.motion,
      source: isNew ? 'new' : 'long form',
    })
  }
  const inPlan = (slot: TimelineSlot): boolean =>
    planShots.some((shot) => shot.slot !== null && sameShot(shot.slot, slot))

  // The long form's library: every slot, in master order, so index is ref.
  const library: TeaserShotOption[] = []
  for (const slot of master?.slots ?? []) {
    library.push({
      kind: slot.payload.kind === 'graphic-code' ? 'graphic' : slot.payload.kind,
      url: await shotUrlOf(slot),
      slot,
      selected: inPlan(slot),
    })
  }

  // The fetched pool, ready candidates carrying their pre-built slot.
  const fetched: TeaserFetchedOptionProp[] = []
  for (const candidate of fetches.success ? fetches.data.candidates : []) {
    const ready = teaserCandidateReady(candidate, mocked)
    const slot = ready ? slotFromTeaserCandidate(candidate, { mocked }) : null
    const preview = await previewOf(candidate, presign)
    fetched.push({
      id: candidate.id,
      kind: candidate.kind,
      origin: candidate.provider === 'fal' || candidate.provider === 'google' ? 'still' : 'stock',
      url: preview.url,
      previewKind: preview.previewKind,
      slot,
      selected: slot !== null && inPlan(slot),
    })
  }

  const now = Date.now()
  const state = fetches.success ? fetches.data.state : null
  return {
    phases,
    words,
    estimatedRuntimeSec,
    shots,
    library,
    fetched,
    findings: pointFindings(row),
    stillEstimateUsd: await stillSlotEstimateUsd(channel.channelId),
    scriptBehind: sources.scriptVersion > script.scriptVersion,
    planBehind: planIsBehind(plan.success ? plan.data : null, voice.success ? voice.data : null),
    pending: pointWorkPending(state, now),
    failure: state?.state === 'failed' ? state.reason : null,
  }
}

/** The plan was made for a voice (or script version) that is no longer the Short's. */
function planIsBehind(plan: PointPlanRecord | null, voice: PointVoiceRecord | null): boolean {
  if (!plan || !voice) return false
  return (
    plan.plannedFor.scriptVersion !== voice.scriptVersion ||
    plan.plannedFor.voiceHash !== pointVoiceHash(voice)
  )
}

/** A provider thumb, stored bytes presigned, or a stable URL; null when nothing shows. */
async function previewOf(
  candidate: SlotCandidate,
  presign: Presign,
): Promise<{ url: string | null; previewKind: 'image' | 'video' }> {
  if (candidate.thumbUrl) return { url: candidate.thumbUrl, previewKind: 'image' }
  if (candidate.r2Key && !candidate.r2Key.startsWith(MOCK_KEY_PREFIX) && presign) {
    return { url: await presign(candidate.r2Key), previewKind: candidate.kind }
  }
  return {
    url: /^https?:\/\//.test(candidate.sourceUrl) ? candidate.sourceUrl : null,
    previewKind: candidate.kind,
  }
}
