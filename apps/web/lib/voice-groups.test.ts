import { describe, expect, it } from 'vitest'
import { groupVoicesByCategory, voiceCategoryLabel } from './voice-groups'

describe('groupVoicesByCategory', () => {
  it('puts the account’s own voices before the defaults, each group sorted by name', () => {
    const groups = groupVoicesByCategory([
      { id: 'd2', label: 'Rachel', category: 'premade' },
      { id: 'c1', label: 'my clone', category: 'cloned' },
      { id: 'd1', label: 'Adam', category: 'premade' },
      { id: 'p1', label: 'Library Narrator', category: 'professional' },
      { id: 'g1', label: 'Designed One', category: 'generated' },
      { id: 'c2', label: 'Another Clone', category: 'cloned' },
    ])

    expect(groups.map((group) => group.label)).toEqual([
      'Instant voice clones',
      'Professional voice clones',
      'Designed voices',
      'Default voices',
    ])
    expect(groups[0]?.voices.map((voice) => voice.id)).toEqual(['c2', 'c1'])
    expect(groups[3]?.voices.map((voice) => voice.id)).toEqual(['d1', 'd2'])
  })

  it('gives a category it does not know a group of its own, before uncategorised voices', () => {
    const groups = groupVoicesByCategory([
      { id: 'x', label: 'No category' },
      { id: 'n', label: 'New kind', category: 'brand_new' },
      { id: 'd', label: 'Default', category: 'premade' },
    ])

    expect(groups.map((group) => [group.category, group.label])).toEqual([
      ['premade', 'Default voices'],
      ['brand_new', 'Brand new voices'],
      ['', 'Other voices'],
    ])
  })

  it('leaves out categories with no voices', () => {
    expect(groupVoicesByCategory([])).toEqual([])
  })
})

describe('voiceCategoryLabel', () => {
  it('names every category ElevenLabs documents', () => {
    expect(
      ['cloned', 'professional', 'generated', 'high_quality', 'famous', 'premade'].map(
        voiceCategoryLabel,
      ),
    ).toEqual([
      'Instant voice clones',
      'Professional voice clones',
      'Designed voices',
      'Studio-quality voices',
      'Iconic voices',
      'Default voices',
    ])
  })
})
