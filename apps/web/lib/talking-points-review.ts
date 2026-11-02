import { estimateLlmUsd, estimateTtsUsd } from '@boom-busters/cost'
import {
  getChannelSettings,
  getLatestScript,
  getProject,
  getWorkspace,
  hasLiveRun,
  latestTalkingPointSet,
  listTalkingPointSets,
  channelForProject,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { canonicalModelId, estimateRenderCostUsd } from '@boom-busters/schemas'
import type { ShortType, TalkingPoint } from '@boom-busters/schemas'
import { stillSlotEstimateUsd } from '@/lib/visual-assets'

/**
 * The Talking points screen's model (playbook Shorts design 3.3 and 5.2): the
 * latest proposal as cards, the note history, what building every point would
 * cost, and whether a proposal is being redone right now.
 */

/** The function id the mirror records for the proposal runner. */
export const TALKING_POINTS_RUNNER = 'talking-points-runner'

/** New images per Short by default (design 5.2). */
const NEW_IMAGES_PER_SHORT = 4
/** About 160 words of narration at six characters a word. */
const NARRATION_CHARACTERS = 160 * 6
/** The script call and the shot-plan call, in tokens (design 5.2). */
const SCRIPT_CALL = { inputTokens: 12_000, outputTokens: 1_500 }
const PLAN_CALL = { inputTokens: 8_000, outputTokens: 3_000 }
/** A Short runs about 55 seconds. */
const SHORT_RENDER_SECONDS = 55

export const SHORT_TYPE_LABELS: Record<ShortType, string> = {
  'forensic-breakdown': 'Forensic breakdown',
  'contrarian-thesis': 'Contrarian thesis',
  'incomplete-mechanism': 'Incomplete mechanism',
  'result-first': 'Result first',
}

export interface ChapterRef {
  index: number
  title: string
}

export interface TalkingPointCard {
  id: string
  type: ShortType
  typeLabel: string
  title: string
  question: string
  payoff: string
  bridge: string
  hook: string
  order: number
  sourceChapters: ChapterRef[]
  bridgeChapters: ChapterRef[]
}

export interface TalkingPointsModel {
  /** 0 when no proposal exists yet. */
  version: number
  points: TalkingPointCard[]
  history: { version: number; note: string | null; createdAt: string }[]
  estimateUsd: number
  busy: boolean
}

export function emptyTalkingPointsModel(): TalkingPointsModel {
  return { version: 0, points: [], history: [], estimateUsd: 0, busy: false }
}

/** Cards in `order`, with chapter indexes turned into the chapter's title. */
export function talkingPointCards(
  points: readonly TalkingPoint[],
  chapters: readonly ChapterRef[],
): TalkingPointCard[] {
  const named = (indexes: readonly number[]): ChapterRef[] =>
    indexes.map((index) => ({
      index,
      title: chapters.find((chapter) => chapter.index === index)?.title ?? `Chapter ${index + 1}`,
    }))
  return [...points]
    .sort((a, b) => a.order - b.order)
    .map((point) => ({
      id: point.id,
      type: point.type,
      typeLabel: SHORT_TYPE_LABELS[point.type],
      title: point.title,
      question: point.question,
      payoff: point.payoff,
      bridge: point.bridge,
      hook: point.hook,
      order: point.order,
      sourceChapters: named(point.sourceChapters),
      bridgeChapters: named(point.bridgeChapters),
    }))
}

/**
 * What one point's Short costs to build, from constants rather than a trial
 * (design 5.2): four new stills, about 160 words of narration, the script and
 * shot-plan calls at the scripting model's price, and one render.
 */
export async function pointShortEstimateUsd(db: Database, channelId: string): Promise<number> {
  const settings = await getChannelSettings(db, channelId)
  const { settings: workspace } = await getWorkspace(db)
  const stills = NEW_IMAGES_PER_SHORT * (await stillSlotEstimateUsd(channelId))
  const narration = estimateTtsUsd({
    provider: settings.tts.provider,
    characters: NARRATION_CHARACTERS,
  })
  const route = settings.modelRouting.scripting
  const calls = [SCRIPT_CALL, PLAN_CALL].reduce(
    (sum, call) =>
      sum +
      estimateLlmUsd({
        provider: route.provider,
        model: canonicalModelId(route.provider, route.model),
        ...call,
        prices: workspace.modelPrices,
      }),
    0,
  )
  return stills + narration + calls + estimateRenderCostUsd(SHORT_RENDER_SECONDS, 'short')
}

export async function talkingPointsModel(
  db: Database,
  projectId: string,
): Promise<TalkingPointsModel> {
  const latest = await latestTalkingPointSet(db, projectId)
  if (!latest) return emptyTalkingPointsModel()

  const [script, sets, liveRun, channel, project] = await Promise.all([
    getLatestScript(db, projectId),
    listTalkingPointSets(db, projectId),
    hasLiveRun(db, projectId, { functionName: TALKING_POINTS_RUNNER }),
    channelForProject(db, projectId),
    getProject(db, projectId),
  ])
  // The mirror lags a request by seconds; the claimed stage status does not.
  const busy = liveRun || (project?.shortsPhase === 'points' && project.stageStatus === 'running')
  const chapters = (script?.chapters ?? []).map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
  }))
  const perShort = await pointShortEstimateUsd(db, channel.channelId)

  return {
    version: latest.version,
    points: talkingPointCards(latest.points, chapters),
    history: sets.map((set) => ({
      version: set.version,
      note: set.note,
      createdAt: set.createdAt.toISOString(),
    })),
    estimateUsd: latest.points.length * perShort,
    busy,
  }
}
