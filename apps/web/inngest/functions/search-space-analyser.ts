import {
  durationSpread,
  latestSearchSpace,
  measurementKey,
  saveSearchSpace,
} from '@boom-busters/db'
import type { SearchSpaceOutlier } from '@boom-busters/db'
import {
  buildWinnersRequest,
  mockProvidersEnabled,
  mockWinners,
  parseWinners,
} from '@boom-busters/providers'
import type { Winners } from '@boom-busters/providers'
import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import { SEARCH_BRIEF_STALE_DAYS, TITLE_PATTERNS_MAX, parseEventData } from '@boom-busters/schemas'
import type { SearchOutlier } from '@boom-busters/schemas'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import type { AnswerComplete } from '@/lib/answer'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { liveResearchSources, mockResearchSources } from '@/lib/research-sources'
import { spendVidiq } from '@/lib/vidiq-spend'
import { inngest } from '../client'
import { events } from '../events'

/**
 * search-space-analyser: what winning looks like in each of a format's
 * keywords, kept in `channel_search_space` and shown on the format card.
 *
 * Per keyword: VidIQ outliers (5 credits), the top ten's details (5 credits),
 * their running time from the YouTube Data API (no VidIQ credits; mock mode
 * serves a fixture) and the title patterns they share. Each VidIQ step records
 * its ledger row once its call has returned, so a retry replays the steps
 * already done from the step cache and never buys one twice. A keyword
 * analysed inside the stale window (a second press, or a run queued behind
 * another for the channel) is skipped in its first step, before anything is
 * spent. Display only: no prompt reads the result.
 */

const FUNCTION_ID = 'search-space-analyser'
const PURPOSE = 'search-space' as const
const DAY_MS = 24 * 60 * 60 * 1000
const OUTLIERS_LIMIT = 25
/** Outliers whose details and running time are read, and which the row keeps. */
const OUTLIERS_KEPT = 10
const TAGS_KEPT = 10
const DESCRIPTION_CHARS = 400

type Details = Record<string, { description: string; tags: string[] }>

const byBreakout = (a: SearchOutlier, b: SearchOutlier) =>
  (b.breakoutScore ?? -1) - (a.breakoutScore ?? -1)

/** `callForAnswer`'s call for a run with no project: charged to the channel. */
const completeFor =
  (channelId: string): AnswerComplete =>
  (request, call) =>
    callLlm(request, { channelId, ...(call === 'answer' ? {} : { purpose: call }) })

export const searchSpaceAnalyser = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Search space analysis',
    retries: 2,
    concurrency: [{ key: 'event.data.channelId', limit: 1 }],
    onFailure: async ({ event }) => {
      console.error(
        '[search-space-analyser] the run failed',
        event.data.event.data['channelId'],
        event.data.error?.message,
      )
    },
    triggers: [events.searchSpaceAnalyse],
  },
  async ({ event, step }) => {
    const { channelId, keywords } = parseEventData('channel/search_space.analyse', event.data)

    const asked = new Map<string, string>()
    for (const keyword of keywords) {
      const key = measurementKey(keyword)
      if (key !== '' && !asked.has(key)) asked.set(key, keyword.trim())
    }

    const complete = completeFor(channelId)
    const readWinners = async (
      keyword: string,
      top: SearchOutlier[],
      details: Details,
    ): Promise<Winners> => {
      if (mockProvidersEnabled()) return mockWinners()
      const winning = top.map((outlier) => ({
        ...outlier,
        tags: details[outlier.videoId]?.tags ?? [],
      }))
      const descriptions = Object.fromEntries(
        Object.entries(details).map(([videoId, detail]) => [videoId, detail.description]),
      )
      const answer = await callForAnswer({
        request: buildWinnersRequest({ subject: keyword, outliers: winning, descriptions }),
        parse: (text, note) => parseWinners(text, note),
        complete,
      })
      return answerOrStop(answer, 'The winning-video patterns could not be read')
    }
    let analysed = 0
    let credits = 0
    let index = 0
    for (const [key, keyword] of asked) {
      const n = index
      index += 1

      // 1. The winning videos; also the freshness guard, so a skip spends nothing.
      const found: { outliers: SearchOutlier[]; credits: number } | null = await step.run(
        `outliers-${n}`,
        async () => {
          const last = (await latestSearchSpace(db, channelId)).get(key)
          if (last && Date.now() - last.measuredAt.getTime() <= SEARCH_BRIEF_STALE_DAYS * DAY_MS) {
            return null
          }
          const result = await spendVidiq(
            {
              channelId,
              purpose: PURPOSE,
              tool: 'vidiq_outliers',
              cost: VIDIQ_CREDIT_COST.outliers,
            },
            (client) =>
              client.outliers({
                keyword,
                requireAllTitleTerms: true,
                publishedWithin: 'allTime',
                limit: OUTLIERS_LIMIT,
              }),
          )
          const outliers: SearchOutlier[] = result.data
            .map((video) => ({
              videoId: video.videoId,
              title: video.title,
              channel: video.channel,
              subscribers: video.subscribers,
              views: video.views,
              breakoutScore: video.breakoutScore,
              publishedAt: video.publishedAt,
              tags: [],
            }))
            .sort(byBreakout)
            .slice(0, OUTLIERS_KEPT)
          return { outliers, credits: result.credits }
        },
      )
      if (found === null) continue
      const top = found.outliers

      // 2. Tags and the start of the descriptions, for the pattern step. Skipped with no outliers.
      const read: { details: Details; credits: number } =
        top.length === 0
          ? { details: {}, credits: 0 }
          : await step.run(`outlier-details-${n}`, async () => {
              const result = await spendVidiq(
                {
                  channelId,
                  purpose: PURPOSE,
                  tool: 'vidiq_get_videos_by_ids',
                  cost: VIDIQ_CREDIT_COST.getVideosByIds,
                },
                (client) => client.getVideosByIds(top.map((outlier) => outlier.videoId)),
              )
              const kept: Details = {}
              for (const video of result.data) {
                kept[video.videoId] = {
                  description: (video.description ?? '').trim().slice(0, DESCRIPTION_CHARS),
                  tags: (video.tags ?? []).slice(0, TAGS_KEPT),
                }
              }
              return { details: kept, credits: result.credits }
            })
      const details = read.details

      // 3. How long each winner runs, from the YouTube Data API. No VidIQ credits.
      const seconds: Record<string, number | null> =
        top.length === 0
          ? {}
          : await step.run(`durations-${n}`, async () => {
              // The VidIQ credits are spent by now: a failed read (no contact email, a quota
              // or HTTP error) leaves every duration unknown rather than losing the row.
              let videos: { id: string; durationSec: number }[] = []
              try {
                const sources = mockProvidersEnabled()
                  ? mockResearchSources()
                  : liveResearchSources()
                // Without a key on file there is no reading: every duration is unknown.
                videos = sources.youtube
                  ? await sources.youtube.details(top.map((outlier) => outlier.videoId))
                  : []
              } catch (error) {
                console.error(
                  '[search-space-analyser] could not read the durations',
                  keyword,
                  error,
                )
              }
              // A video YouTube omits, or gives no length (a live stream), is unknown.
              const byId = new Map(videos.map((video) => [video.id, video.durationSec]))
              return Object.fromEntries(
                top.map((outlier) => {
                  const sec = byId.get(outlier.videoId)
                  return [outlier.videoId, sec !== undefined && sec > 0 ? sec : null]
                }),
              )
            })

      // 4. What the winning titles share. No outliers, nothing to study: no model call.
      const winners: Winners =
        top.length === 0
          ? { titlePatterns: [], toldAlready: [] }
          : await step.run(`winners-${n}`, async () => {
              // Same loss as above: a failed model call saves the row without patterns.
              try {
                return await readWinners(keyword, top, details)
              } catch (error) {
                console.error('[search-space-analyser] could not read the patterns', keyword, error)
                return { titlePatterns: [], toldAlready: [] }
              }
            })

      // 5. The row, written once the readings are in.
      const spent = found.credits + read.credits
      await step.run(`save-${n}`, async () => {
        const kept: SearchSpaceOutlier[] = top.map((outlier) => ({
          videoId: outlier.videoId,
          title: outlier.title,
          channel: outlier.channel,
          views: outlier.views,
          breakoutScore: outlier.breakoutScore,
          durationSec: seconds[outlier.videoId] ?? null,
        }))
        await saveSearchSpace(db, {
          channelId,
          keyword,
          measuredAt: new Date(),
          outliers: kept,
          titlePatterns: winners.titlePatterns.slice(0, TITLE_PATTERNS_MAX),
          durations: durationSpread(
            kept.flatMap((outlier) => (outlier.durationSec === null ? [] : [outlier.durationSec])),
          ),
          credits: spent,
        })
      })
      analysed += 1
      credits += spent
    }

    return { analysed, credits }
  },
)
