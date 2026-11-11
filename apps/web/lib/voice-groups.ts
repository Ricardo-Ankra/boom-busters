import type { KnownVoice } from '@boom-busters/providers'

/**
 * The audition panel's voices, grouped by the vendor's category (decision 462).
 *
 * The account's own kinds come first (clones, then designed voices), because
 * those are the ones made or saved for a channel; the default voices every
 * ElevenLabs account has come after them. A category the vendor adds later
 * still gets a group under its own name, after the known ones, and a voice
 * that arrives with no category goes last.
 *
 * A voice saved from the Voice Library is grouped by whatever category the
 * vendor reports for it, expected to be that of the voice it was copied from
 * (most are professional clones). That is the vendor's grouping, not a
 * judgement made here.
 */

export interface VoiceGroup {
  /** The vendor's category, or `''` for voices that came without one. */
  category: string
  label: string
  voices: KnownVoice[]
}

const KNOWN_CATEGORIES: readonly { category: string; label: string }[] = [
  { category: 'cloned', label: 'Instant voice clones' },
  { category: 'professional', label: 'Professional voice clones' },
  { category: 'generated', label: 'Designed voices' },
  { category: 'high_quality', label: 'Studio-quality voices' },
  { category: 'famous', label: 'Iconic voices' },
  { category: 'premade', label: 'Default voices' },
]

function rank(category: string): number {
  const index = KNOWN_CATEGORIES.findIndex((known) => known.category === category)
  if (index >= 0) return index
  return category === '' ? KNOWN_CATEGORIES.length + 1 : KNOWN_CATEGORIES.length
}

/** The heading for a category, including one this file has never heard of. */
export function voiceCategoryLabel(category: string): string {
  if (category === '') return 'Other voices'
  const known = KNOWN_CATEGORIES.find((entry) => entry.category === category)
  if (known) return known.label
  const words = category.replace(/_/g, ' ').trim()
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} voices`
}

/** Groups in display order, each sorted by name. Empty categories are left out. */
export function groupVoicesByCategory(voices: readonly KnownVoice[]): VoiceGroup[] {
  const byCategory = new Map<string, KnownVoice[]>()
  for (const voice of voices) {
    const category = voice.category ?? ''
    const group = byCategory.get(category)
    if (group) group.push(voice)
    else byCategory.set(category, [voice])
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([category, group]) => ({
      category,
      label: voiceCategoryLabel(category),
      voices: [...group].sort((x, y) =>
        x.label.localeCompare(y.label, 'en', { sensitivity: 'base' }),
      ),
    }))
}
