import {
  channelYoutubeReconnectNeeded,
  listFailedRuns,
  listOpenBudgetGates,
  listProjectsAwaitingReview,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { buildNeedsYouCards } from '@/components/needs-you-queue'

/**
 * How many cards the channel's Needs-you queue holds: awaiting review, budget
 * gates, failed runs and a dead YouTube connection. It builds the same cards
 * the dashboard does, so the switcher's number is the queue's own length.
 */
export async function needsYouCount(db: Database, channelId: string): Promise<number> {
  const [awaitingReview, budgetGates, failedRuns, youtubeReconnect] = await Promise.all([
    listProjectsAwaitingReview(db, channelId),
    listOpenBudgetGates(db, channelId),
    listFailedRuns(db, channelId),
    channelYoutubeReconnectNeeded(db, channelId),
  ])
  // Only the length is used, so neither the links' address nor the category words matter.
  return buildNeedsYouCards({
    slug: '',
    bible: { caseCategories: [] },
    awaitingReview,
    budgetGates,
    failedRuns,
    youtubeReconnect,
  }).length
}
