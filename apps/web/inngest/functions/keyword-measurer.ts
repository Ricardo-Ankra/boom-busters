import {
  latestKeywordMeasurements,
  measurementKey,
  recordKeywordMeasurement,
} from '@boom-busters/db'
import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import { SEARCH_BRIEF_STALE_DAYS, parseEventData } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { spendVidiq } from '@/lib/vidiq-spend'
import { inngest } from '../client'
import { events } from '../events'
import { TERMS_LIMIT } from './case-researcher'

/**
 * keyword-measurer: one VidIQ reading (volume, competition, overall, monthly
 * searches) for each keyword the action chose, kept in `keyword_measurements`.
 *
 * One step per keyword, each recording its ledger row and its measurement once
 * the call has returned, so a retry replays the keywords already read from the
 * step cache and never buys one twice. A keyword that already has a reading
 * inside the stale window (a second press, or a run queued behind another for
 * the channel) is skipped before it spends.
 */

const FUNCTION_ID = 'keyword-measurer'
const DAY_MS = 24 * 60 * 60 * 1000

export const keywordMeasurer = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Keyword measurement',
    retries: 2,
    concurrency: [{ key: 'event.data.channelId', limit: 1 }],
    onFailure: async ({ event }) => {
      console.error(
        '[keyword-measurer] the run failed',
        event.data.event.data['channelId'],
        event.data.error?.message,
      )
    },
    triggers: [events.keywordsMeasure],
  },
  async ({ event, step }) => {
    const { channelId, keywords } = parseEventData('channel/keywords.measure', event.data)

    const asked = new Map<string, string>()
    for (const keyword of keywords) {
      const key = measurementKey(keyword)
      if (key !== '' && !asked.has(key)) asked.set(key, keyword.trim())
    }

    let measured = 0
    let credits = 0
    let index = 0
    for (const [key, keyword] of asked) {
      const spent: number = await step.run(`measure-${index}`, async () => {
        const last = (await latestKeywordMeasurements(db, channelId)).get(key)
        if (last && Date.now() - last.measuredAt.getTime() <= SEARCH_BRIEF_STALE_DAYS * DAY_MS) {
          return 0
        }
        const found = await spendVidiq(
          {
            channelId,
            purpose: 'keyword-measure',
            tool: 'vidiq_keyword_research',
            cost: VIDIQ_CREDIT_COST.keywordResearch,
          },
          (client) =>
            client.keywordResearch(keyword, { mode: 'matching_terms', limit: TERMS_LIMIT }),
        )
        // VidIQ answers with the nearest terms, the asked phrase among them when it has data:
        // only the row for this keyword is its reading, else the row holds nulls and stays fresh.
        const row = found.data.find((candidate) => measurementKey(candidate.keyword) === key)
        await recordKeywordMeasurement(db, {
          channelId,
          keyword,
          volume: row?.volume ?? null,
          competition: row?.competition ?? null,
          overall: row?.overall ?? null,
          estimatedMonthlySearch: row?.estimatedMonthlySearch ?? null,
          credits: found.credits,
          measuredAt: new Date(),
        })
        return found.credits
      })
      index += 1
      if (spent > 0) measured += 1
      credits += spent
    }

    return { measured, credits }
  },
)
