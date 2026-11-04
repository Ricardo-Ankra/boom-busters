import { describe, expect, test } from 'vitest'
import {
  BIBLE_SECTIONS,
  ChannelBibleReadSchema,
  ChannelBibleSchema,
  ChannelSlugSchema,
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  FIRST_CHANNEL_IN_USE,
  isBibleComplete,
  missingBibleFields,
  slugFromName,
  upgradeStoredBible,
} from './channels'
import { defaultFormat } from './formats'
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

describe('bible language', () => {
  const parse = (language: string) => ChannelBibleSchema.safeParse({ language })

  test('accepts empty and well-formed codes, and trims', () => {
    for (const ok of ['', 'en', 'pt-BR', 'zh-Hans-CN', 'fil']) {
      expect(parse(ok).success).toBe(true)
    }
    expect(ChannelBibleSchema.parse({ language: ' en-GB ' }).language).toBe('en-GB')
  })

  test('refuses a language name or a malformed code on write', () => {
    for (const bad of ['English', 'e', 'en_GB', 'en-', '12']) {
      expect(parse(bad).success).toBe(false)
    }
  })

  test('a stored invalid language reads as empty', () => {
    expect(
      ChannelBibleReadSchema.parse({ ...FIRST_CHANNEL_BIBLE, language: 'English' }).language,
    ).toBe('')
    expect(ChannelBibleReadSchema.parse({ ...FIRST_CHANNEL_BIBLE, language: 'en' }).language).toBe(
      'en',
    )
  })
})

/** Boom & Busters' version 1 as production holds it: before formats, hashtag and footer. */
function storedFirstBible(): Record<string, unknown> {
  const { formats: _f, channelHashtag: _h, channelFooter: _t, ...rest } = FIRST_CHANNEL_BIBLE
  return {
    ...rest,
    keywordContext: 'documentary',
    channelTags: [],
    caseCategories: FIRST_CHANNEL_BIBLE.caseCategories.map(({ key, label }) => ({ key, label })),
  }
}

describe('upgradeStoredBible', () => {
  test('the stored first bible reads with one Documentary format and no keywordContext', () => {
    const read = ChannelBibleReadSchema.parse(storedFirstBible())
    expect(read.formats).toEqual([defaultFormat('Documentary')])
    expect(read.formats[0]?.runtime).toEqual({ default: 15, min: 3, max: 30 })
    expect(read.caseCategories.every((c) => c.keywords.length === 0)).toBe(true)
    expect(read).not.toHaveProperty('keywordContext')
  })
  test('the upgraded first bible equals FIRST_CHANNEL_BIBLE field for field, examples aside', () => {
    const { examples: _a, ...read } = ChannelBibleReadSchema.parse(storedFirstBible())
    const { examples: _b, ...first } = FIRST_CHANNEL_BIBLE
    expect(read).toEqual(first)
  })
  test('a blank stored bible upgrades to a Main format and stays incomplete', () => {
    const { formats: _f, channelHashtag: _h, channelFooter: _t, ...rest } = EMPTY_BIBLE
    const read = ChannelBibleReadSchema.parse({ ...rest, keywordContext: '' })
    expect(read.formats).toEqual([defaultFormat('Main')])
    expect(isBibleComplete(read)).toBe(false)
  })
  test('a bible that already has formats passes through unchanged', () => {
    const bible = { ...FIRST_CHANNEL_BIBLE }
    expect(upgradeStoredBible(bible)).toBe(bible)
    expect(ChannelBibleReadSchema.parse(bible)).toEqual(bible)
  })
  test('anything that is not an object passes through', () => {
    expect(upgradeStoredBible(null)).toBeNull()
    expect(upgradeStoredBible('x')).toBe('x')
  })
})

describe('bible formats, hashtag and footer', () => {
  test('keywordContext is refused', () => {
    expect(ChannelBibleSchema.safeParse({ keywordContext: 'documentary' }).success).toBe(false)
  })
  test('the channel hashtag takes letters and digits only', () => {
    for (const bad of ['#history', 'history sleep', 'history,', 'a'.repeat(31)]) {
      expect(ChannelBibleSchema.safeParse({ channelHashtag: bad }).success).toBe(false)
    }
    expect(ChannelBibleSchema.safeParse({ channelHashtag: 'HistoryForSleep' }).success).toBe(true)
    expect(ChannelBibleSchema.safeParse({ channelHashtag: '' }).success).toBe(true)
  })
  test('the empty bible starts with one default format', () => {
    expect(EMPTY_BIBLE.formats).toEqual([defaultFormat()])
    expect(EMPTY_BIBLE.channelFooter).toBe('')
  })
  test('a category takes up to six keywords', () => {
    const category = { key: 'a', label: 'A' }
    expect(
      ChannelBibleSchema.safeParse({
        caseCategories: [{ ...category, keywords: ['1', '2', '3', '4', '5', '6', '7'] }],
      }).success,
    ).toBe(false)
    expect(
      ChannelBibleSchema.parse({ caseCategories: [category] }).caseCategories[0]?.keywords,
    ).toEqual([])
  })
})
