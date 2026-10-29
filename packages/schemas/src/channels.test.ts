import { describe, expect, test } from 'vitest'
import {
  BIBLE_SECTIONS,
  ChannelBibleSchema,
  ChannelSlugSchema,
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  FIRST_CHANNEL_IN_USE,
  isBibleComplete,
  missingBibleFields,
  slugFromName,
} from './channels'
import { UlidSchema } from './ids'
import { PUBLISH_DISCLAIMER } from './publish'

/** The eleven keys stage A's migration 0037 wrote. */
const FIRST_CHANNEL_BIBLE_AT_0037_SHAPE = {
  subject: 'corporate collapses, frauds, meltdowns and turnarounds',
  whatACaseIs: 'A good case has a documented paper trail.',
  subjectKind: "the company's common name as Wikipedia titles it",
  audience: 'adults who watch long-form money documentaries',
  narrationRegister: 'plain, specific, unhurried',
  visualRegister: 'the Netflix money documentary.',
  titleStyle: 'Sober, specific, curiosity-driven',
  ctaLine: 'The full story is on the channel',
  caseCategories: [
    { key: 'collapse', label: 'Collapse' },
    { key: 'con', label: 'Con' },
  ],
  scriptRulesMd: '',
  directionRulesMd: '',
}

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
  test('a stage A bible parses with every new field defaulted', () => {
    const parsed = ChannelBibleSchema.parse(FIRST_CHANNEL_BIBLE_AT_0037_SHAPE)
    expect(parsed.examples).toEqual({})
    expect(parsed.youtubeCategoryId).toBeNull()
    expect(isBibleComplete(parsed)).toBe(false)
    expect(missingBibleFields(parsed)).toEqual(
      expect.arrayContaining([
        'subjectNoun.singular',
        'hedgingRules',
        'disclaimer',
        'auditionLine',
      ]),
    )
  })
  test('an unknown key is refused, not stripped', () => {
    expect(ChannelBibleSchema.safeParse({ ...FIRST_CHANNEL_BIBLE, tone: 'x' }).success).toBe(false)
  })
  test('every slot id in the list must have an entry', () => {
    expect(isBibleComplete(FIRST_CHANNEL_BIBLE, ['script-x'])).toBe(false)
    expect(missingBibleFields(FIRST_CHANNEL_BIBLE, ['script-x'])).toEqual(['examples.script-x'])
    expect(
      isBibleComplete({ ...FIRST_CHANNEL_BIBLE, examples: { 'script-x': 'y' } }, ['script-x']),
    ).toBe(true)
  })
  test("the first bible is complete and carries today's fixed strings", () => {
    expect(isBibleComplete(FIRST_CHANNEL_BIBLE)).toBe(true)
    expect(FIRST_CHANNEL_BIBLE.disclaimer).toBe(PUBLISH_DISCLAIMER)
    expect(FIRST_CHANNEL_BIBLE.subjectNoun).toEqual({ singular: 'company', plural: 'companies' })
    expect(FIRST_CHANNEL_IN_USE.bible).toBe(FIRST_CHANNEL_BIBLE)
  })
  test('every field belongs to exactly one section', () => {
    const keys = Object.values(BIBLE_SECTIONS).flat()
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual(Object.keys(ChannelBibleSchema.shape).sort())
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
