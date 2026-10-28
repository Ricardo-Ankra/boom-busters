import { describe, expect, test } from 'vitest'
import {
  ChannelBibleSchema,
  ChannelSlugSchema,
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  isBibleComplete,
  slugFromName,
} from './channels'
import { UlidSchema } from './ids'

describe('channels', () => {
  test('FIRST_CHANNEL_ID is a ULID and the first bible is complete', () => {
    expect(UlidSchema.safeParse(FIRST_CHANNEL_ID).success).toBe(true)
    expect(isBibleComplete(FIRST_CHANNEL_BIBLE)).toBe(true)
    expect(FIRST_CHANNEL_BIBLE.caseCategories.map((c) => c.key)).toEqual([
      'collapse',
      'con',
      'meltdown',
      'turnaround',
      'empire',
    ])
  })
  test('an empty bible parses and is incomplete', () => {
    expect(ChannelBibleSchema.parse({})).toEqual(EMPTY_BIBLE)
    expect(isBibleComplete(EMPTY_BIBLE)).toBe(false)
    expect(
      isBibleComplete({
        ...FIRST_CHANNEL_BIBLE,
        caseCategories: [FIRST_CHANNEL_BIBLE.caseCategories[0]!],
      }),
    ).toBe(false)
  })
  test.each(['Settings', 'boom busters', '-boom', 'boom-', 'settings', 'new', 'a'.repeat(41)])(
    'slug %s is refused',
    (slug) => {
      expect(ChannelSlugSchema.safeParse(slug).success).toBe(false)
    },
  )
  test('a good slug is accepted', () => {
    expect(ChannelSlugSchema.safeParse('boom-busters').success).toBe(true)
  })
  test('slugFromName', () => {
    expect(slugFromName('Boom & Busters')).toBe('boom-busters')
    expect(slugFromName('  Psychology: The Mind!! ')).toBe('psychology-the-mind')
  })
})
