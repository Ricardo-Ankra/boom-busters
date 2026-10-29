import { describe, expect, test } from 'vitest'
import {
  BIBLE_SECTION_LABELS,
  BIBLE_SECTION_ORDER,
  bibleDraftUnits,
  bibleProblems,
  bibleSaveBlockers,
  jobIsRunning,
  sectionIsEmpty,
  unitKey,
} from './bible-draft'
import type { BibleDraft, BibleSectionStatus } from './bible-draft'
import { CAST_GUARDRAIL_MAX, DEFAULT_GUARDRAIL_SUFFIX } from './cast'
import { EXAMPLE_SLOTS } from './bible-slots'
import {
  BIBLE_SECTIONS,
  ChannelBibleReadSchema,
  ChannelBibleSchema,
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
} from './channels'
import type { BibleSection, ChannelBible } from './channels'

function draftOf(
  bible: ChannelBible,
  statuses: Partial<Record<BibleSection, BibleSectionStatus>> = {},
): BibleDraft {
  const all = Object.fromEntries(
    BIBLE_SECTION_ORDER.map((s) => [s, statuses[s] ?? 'approved']),
  ) as Record<BibleSection, BibleSectionStatus>
  return {
    channelId: 'c',
    baseBibleId: 'b',
    bible,
    statuses: all,
    tooClose: {},
    errors: {},
    inputs: null,
    research: null,
    job: null,
    updatedAt: new Date().toISOString(),
  }
}

describe('bibleProblems', () => {
  test('a slot over its maxLength and an over-long default guardrail are problems', () => {
    const slot = EXAMPLE_SLOTS[0]!
    const long = {
      ...FIRST_CHANNEL_BIBLE,
      examples: { ...FIRST_CHANNEL_BIBLE.examples, [slot.id]: 'x'.repeat(slot.maxLength + 1) },
    }
    expect(bibleProblems(long)).toContain(
      `examples.${slot.id} is ${slot.maxLength + 1} characters; the limit is ${slot.maxLength}`,
    )
    const guardSlot = EXAMPLE_SLOTS.find((s) => s.id === 'direction-default-guardrail')!
    const text = 'x'.repeat(CAST_GUARDRAIL_MAX)
    const guard = {
      ...FIRST_CHANNEL_BIBLE,
      examples: { ...FIRST_CHANNEL_BIBLE.examples, 'direction-default-guardrail': text },
    }
    const problems = bibleProblems(guard)
    expect(problems).toContain(
      `The default guardrail is ${text.length + DEFAULT_GUARDRAIL_SUFFIX.length} characters with its ending; the limit is ${CAST_GUARDRAIL_MAX}`,
    )
    if (guardSlot.maxLength < text.length) {
      expect(problems).toContain(
        `examples.direction-default-guardrail is ${text.length} characters; the limit is ${guardSlot.maxLength}`,
      )
    }
    expect(bibleProblems(FIRST_CHANNEL_BIBLE)).toEqual([])
  })
})

describe('bibleSaveBlockers', () => {
  test('a drafted section blocks save, an empty one does not', () => {
    const draft = draftOf(FIRST_CHANNEL_BIBLE, { voice: 'drafted', hooks: 'drafted' })
    expect(bibleSaveBlockers(draft)).toEqual(['Voice is drafted, not approved'])
  })

  test('a too-close flag blocks save by its field path', () => {
    const draft = {
      ...draftOf(FIRST_CHANNEL_BIBLE),
      tooClose: { 'examples.script-close-hedge': { source: 'v1', run: 'a b c' } },
    }
    expect(bibleSaveBlockers(draft)).toEqual([
      'examples.script-close-hedge is too close to its source',
    ])
  })
})

describe('sectionIsEmpty', () => {
  test('the empty bible is empty everywhere, the first bible is not', () => {
    for (const s of BIBLE_SECTION_ORDER) expect(sectionIsEmpty(EMPTY_BIBLE, s)).toBe(true)
    expect(sectionIsEmpty(FIRST_CHANNEL_BIBLE, 'voice')).toBe(false)
    expect(sectionIsEmpty(FIRST_CHANNEL_BIBLE, 'hooks')).toBe(true)
  })

  test('identity is not empty when only case categories are set', () => {
    const bible = { ...EMPTY_BIBLE, caseCategories: [{ key: 'a', label: 'A' }] }
    expect(sectionIsEmpty(bible, 'identity')).toBe(false)
  })
})

describe('section order and labels', () => {
  test('every section is ordered and labelled', () => {
    expect([...BIBLE_SECTION_ORDER].sort()).toEqual(Object.keys(BIBLE_SECTIONS).sort())
    expect(BIBLE_SECTION_LABELS.hooks).toBe('Hooks, openings and titles')
  })
})

describe('ChannelBibleReadSchema', () => {
  test('a stored version with a key the schema dropped still reads', () => {
    expect(
      ChannelBibleReadSchema.parse({ ...FIRST_CHANNEL_BIBLE, musicMood: 'x' }),
    ).not.toHaveProperty('musicMood')
    expect(ChannelBibleSchema.safeParse({ ...FIRST_CHANNEL_BIBLE, musicMood: 'x' }).success).toBe(
      false,
    )
  })
})

describe('bibleDraftUnits', () => {
  test('examples expand into one unit per craft file, in registry order', () => {
    const units = bibleDraftUnits(['examples'])
    expect(units.map(unitKey)).toEqual(
      [...new Set(EXAMPLE_SLOTS.map((s) => s.source))].map((s) => `examples:${s}`),
    )
  })

  test('units follow the section order and a slot unit keys by id', () => {
    const keys = bibleDraftUnits().map(unitKey)
    expect(keys[0]).toBe('identity')
    expect(keys.at(-1)).toBe('publishing')
    expect(unitKey({ section: 'examples', slotId: 'script-close-hedge' })).toBe(
      'slot:script-close-hedge',
    )
  })
})

describe('jobIsRunning', () => {
  test('a job running for over thirty minutes is not running', () => {
    const startedAt = new Date(Date.now() - 31 * 60_000).toISOString()
    expect(
      jobIsRunning({ kind: 'draft', state: 'running', current: null, error: null, startedAt }),
    ).toBe(false)
  })

  test('a recent running job is running, a done one is not', () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString()
    const job = { kind: 'draft', current: null, error: null, startedAt } as const
    expect(jobIsRunning({ ...job, state: 'running' })).toBe(true)
    expect(jobIsRunning({ ...job, state: 'done' })).toBe(false)
  })
})
