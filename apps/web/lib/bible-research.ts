import { approvedScriptOpenings, currentBible, getChannel } from '@boom-busters/db'
import { planResearch } from '@boom-busters/providers/vidiq'
import type { ResearchPlan } from '@boom-busters/providers/vidiq'
import type { BibleDraftInputs } from '@boom-busters/schemas'
import { db } from '@/lib/db'

/** How many of the channel's approved scripts the research reads the openings of. */
export const OWN_LINES_LIMIT = 10

/**
 * What a research run would fetch for this channel. The channel's own videos
 * are read too when it has a handle and at least one approved script, so the
 * digest can set what it does already beside what the owner admires.
 */
export async function researchPlanFor(
  channelId: string,
  inputs: BibleDraftInputs,
): Promise<ResearchPlan | { error: string }> {
  const [channel, current, openings] = await Promise.all([
    getChannel(db, channelId),
    currentBible(db, channelId),
    approvedScriptOpenings(db, channelId, OWN_LINES_LIMIT),
  ])
  return planResearch(inputs, {
    handle: openings.length > 0 ? channel.handle : null,
    language: current.bible.language === '' ? null : current.bible.language,
  })
}
