import type { TechniqueKey, TechniqueProposal } from '@boom-busters/schemas'
import type { ExemplarEntry } from './manifest'

/**
 * What a derivation designs from, for a house technique or a channel's
 * own (spec 2026-11-04, section 8.5): the words the storyboard is shown,
 * the mechanisms, the synthetic slot and, for a chart technique, its kind.
 * A catalogue `ExemplarEntry` is one; a proposal makes one without a
 * vendored source or a chart.
 */
export type TechniqueEntry = Pick<
  ExemplarEntry,
  'description' | 'mechanisms' | 'slot' | 'chart'
> & {
  technique: TechniqueKey
}

export function entryFromProposal(proposal: TechniqueProposal): TechniqueEntry {
  return {
    technique: proposal.key,
    description: proposal.description,
    mechanisms: proposal.mechanisms,
    slot: {
      durationMs: proposal.slot.durationMs,
      words: proposal.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
      intent: proposal.slot.intent,
    },
  }
}
