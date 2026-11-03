import { currentBible } from '@boom-busters/db'
import { EXAMPLE_SLOTS, FIRST_CHANNEL_ID, tooCloseTo } from '@boom-busters/schemas'
import type { BibleDraft, OverlapSource, TooClose } from '@boom-busters/schemas'
import { BIBLE_ENTRY_LISTS } from './bible-draft-keys'
import { db } from './db'

/**
 * What a bible draft is checked against for eight-word overlap, shared by the
 * drafting run and the owner's edits so the two agree: other creators' research
 * quotes and, on a second channel, Boom & Busters' own bible. The channel's own
 * words are never a source.
 */

const FIRST_CHANNEL_LABEL = 'Boom & Busters'

/** Craft sentences the slots' `teaches` lines quote: every channel keeps them word for word. */
const CRAFT_TEXTS: readonly string[] = EXAMPLE_SLOTS.map((slot) => slot.teaches)

export interface OverlapSources {
  /** Other creators' research quotes: no exemption. */
  digest: OverlapSource[]
  /** Boom & Busters' own bible, on a second channel; craft wording is exempt. */
  firstChannel: OverlapSource[]
}

/** Other creators' quotes from the research digest: patterns whose every source is not the channel's own. */
function digestSources(draft: BibleDraft): OverlapSource[] {
  const sources: OverlapSource[] = []
  for (const pattern of draft.research?.patterns ?? []) {
    const first = pattern.sources[0]
    if (!pattern.quote || !first || pattern.sources.some((s) => s.own)) continue
    sources.push({ label: `${first.channel}: ${first.title}`, text: pattern.quote })
  }
  return sources
}

/** On a channel other than the first, the first channel's current bible is a source too. */
export async function overlapSources(
  channelId: string,
  draft: BibleDraft,
): Promise<OverlapSources> {
  const sources: OverlapSources = { digest: digestSources(draft), firstChannel: [] }
  if (channelId === FIRST_CHANNEL_ID) return sources
  const first = (await currentBible(db, FIRST_CHANNEL_ID)).bible
  const texts = [
    ...Object.values(first.examples),
    ...BIBLE_ENTRY_LISTS.flatMap((list) => first[list].map((entry) => entry.text)),
  ]
  for (const text of texts) sources.firstChannel.push({ label: FIRST_CHANNEL_LABEL, text })
  return sources
}

/** The overlap flag for a field's text, or null. */
export function overlapFlag(text: string, sources: OverlapSources): TooClose | null {
  return tooCloseTo(text, sources.digest) ?? tooCloseTo(text, sources.firstChannel, 8, CRAFT_TEXTS)
}
