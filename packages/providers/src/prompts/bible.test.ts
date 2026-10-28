import { FIRST_CHANNEL_BIBLE, type BibleInUse, type ChannelBible } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { BibleSlotMissingError, channelRulesBlock, fillSlots, markersIn, noun } from './bible'

function inUse(examples: Record<string, string>, slotIds: string[] = []): BibleInUse {
  return { bible: { ...FIRST_CHANNEL_BIBLE, examples }, slotIds }
}

describe('fillSlots', () => {
  it('replaces a marker with the bible example', () => {
    expect(fillSlots('a [[example:a-b]] z', inUse({ 'a-b': 'MID' }))).toBe('a MID z')
  })

  it('inserts replacement patterns literally', () => {
    expect(fillSlots('[[example:a-b]]', inUse({ 'a-b': 'costs $& and $1 and $$' }))).toBe(
      'costs $& and $1 and $$',
    )
  })

  it('does not re-scan inserted text', () => {
    const out = fillSlots('[[example:a-b]]', inUse({ 'a-b': 'x [[example:a-c]]', 'a-c': 'NO' }))
    expect(out).toBe('x [[example:a-c]]')
  })

  it('throws BibleSlotMissingError with the id for a missing entry', () => {
    try {
      fillSlots('[[example:a-z]]', inUse({}))
      throw new Error('did not throw')
    } catch (err) {
      expect(err).toBeInstanceOf(BibleSlotMissingError)
      expect((err as BibleSlotMissingError).slotId).toBe('a-z')
    }
  })

  it('keeps an if block when the id is in use and removes it otherwise', () => {
    expect(fillSlots('p[[if:a-b]]x[[/if]]q', inUse({}, ['a-b']))).toBe('pxq')
    expect(fillSlots('p[[if:a-b]]x[[/if]]q', inUse({}, []))).toBe('pq')
  })

  it('throws on a nested if block', () => {
    expect(() => fillSlots('[[if:a-b]][[if:a-c]]x[[/if]][[/if]]', inUse({}, ['a-b']))).toThrow(
      'nested [[if:]] blocks are not supported',
    )
  })
})

describe('markersIn', () => {
  it('finds both kinds in order without duplicates', () => {
    expect(markersIn('[[example:a-b]] [[if:a-c]]t[[/if]] [[example:a-b]] [[example:a-d]]')).toEqual(
      ['a-b', 'a-c', 'a-d'],
    )
  })
})

describe('noun', () => {
  it('returns the singular or plural form', () => {
    expect(noun(FIRST_CHANNEL_BIBLE, 'singular')).toBe('company')
    expect(noun(FIRST_CHANNEL_BIBLE, 'plural')).toBe('companies')
  })
})

describe('channelRulesBlock', () => {
  const base: ChannelBible = { ...FIRST_CHANNEL_BIBLE, voiceDos: [], voiceDonts: [] }

  it('is empty for the first channel', () => {
    expect(channelRulesBlock(FIRST_CHANNEL_BIBLE, 'script')).toBe('')
    expect(channelRulesBlock(FIRST_CHANNEL_BIBLE, 'direction')).toBe('')
  })

  it('renders dos, donts and markdown for script', () => {
    const bible = {
      ...base,
      voiceDos: ['Be plain'],
      voiceDonts: ['Gloat'],
      scriptRulesMd: 'Rules here.',
    }
    expect(channelRulesBlock(bible, 'script')).toBe(
      "\n\n## This channel's rules\n\n- Do: Be plain\n- Don't: Gloat\nRules here.",
    )
  })

  it('uses only directionRulesMd for direction', () => {
    const bible = {
      ...base,
      voiceDos: ['Be plain'],
      scriptRulesMd: 'S',
      directionRulesMd: 'Shoot wide.',
    }
    expect(channelRulesBlock(bible, 'direction')).toBe("\n\n## This channel's rules\n\nShoot wide.")
  })

  it('treats whitespace-only markdown as blank', () => {
    expect(channelRulesBlock({ ...base, scriptRulesMd: '  \n ' }, 'script')).toBe('')
    expect(
      channelRulesBlock({ ...base, voiceDos: ['x'], directionRulesMd: ' ' }, 'direction'),
    ).toBe('')
  })
})
