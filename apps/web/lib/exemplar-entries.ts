import type { Database } from '@boom-busters/db'
import { approvedExemplar, channelTechniquesFor, listChannelExemplars } from '@boom-busters/db'
import { MANIFEST, entryFromProposal, exemplarFor } from '@boom-busters/providers'
import type { Exemplar, TechniqueEntry } from '@boom-busters/providers'
import { isHouseTechnique } from '@boom-busters/schemas'
import type { ChannelTechnique, MotionIdentity, TechniqueKey } from '@boom-busters/schemas'

/**
 * What a derivation or a refine designs from, for any technique key (spec
 * 2026-11-04, section 8.5): a house key reads its catalogue entry, a
 * channel's own key reads the proposal stored on its newest version. The
 * exemplar the loop pins is the house design for a house key (plan 4) and
 * the channel's approved version for its own key, since that has no house
 * design; before one is approved the designer builds from the plan alone.
 */

export async function techniqueEntryFor(
  db: Database,
  channelId: string,
  technique: TechniqueKey,
): Promise<TechniqueEntry | null> {
  if (isHouseTechnique(technique)) {
    return MANIFEST.find((entry) => entry.technique === technique) ?? null
  }
  // Newest version first (`listChannelExemplars` orders version desc within a technique).
  const rows = await listChannelExemplars(db, channelId)
  const newest = rows.find((row) => row.technique === technique && row.proposal !== null)
  return newest?.proposal ? entryFromProposal(newest.proposal) : null
}

export async function pinnedExemplarFor(
  db: Database,
  channelId: string,
  technique: TechniqueKey,
): Promise<Exemplar | null> {
  if (isHouseTechnique(technique)) return exemplarFor(technique) ?? null
  const approved = await approvedExemplar(db, channelId, technique)
  if (!approved) return null
  return {
    technique,
    description: approved.proposal?.description ?? technique,
    mechanisms: approved.plan.mechanisms,
    title: approved.code.title,
    source: approved.code.source,
  }
}

/** The channel's own techniques the board honours: approved, and ticked in the identity. */
export async function channelTechniquesInUse(
  db: Database,
  channelId: string,
  motion: MotionIdentity,
): Promise<ChannelTechnique[]> {
  const own = await channelTechniquesFor(db, channelId)
  return own.filter((entry) => motion.techniques.includes(entry.technique))
}
