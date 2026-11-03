import { describe, expect, test } from 'vitest'
import {
  ChannelFormatSchema,
  FormatsSchema,
  defaultFormat,
  formatIsDefault,
  leadKeyword,
  resolveFormat,
  type ChannelFormat,
} from './formats'

const base = (over: Partial<ChannelFormat> = {}): ChannelFormat => ({ ...defaultFormat(), ...over })
const sleep = base({ key: 'sleep', name: 'Sleep', primary: false })

describe('ChannelFormatSchema', () => {
  test('defaultFormat parses and carries every default', () => {
    const f = defaultFormat()
    expect(ChannelFormatSchema.parse(f)).toEqual(f)
    expect(f).toEqual({
      key: 'main',
      name: 'Main',
      primary: true,
      keywords: [],
      intent: 'tension',
      runtime: { default: 15, min: 3, max: 60 },
      wordsPerMinute: 150,
      shotHold: 1,
      titleTemplate: '',
      titleRequiredSlots: [],
      introRule: '',
      introLine: '',
      outroLine: '',
      shorts: true,
    })
  })

  test('a stored format without shorts parses to true, and false is kept', () => {
    const { shorts: _shorts, ...stored } = defaultFormat()
    expect(ChannelFormatSchema.parse(stored).shorts).toBe(true)
    expect(ChannelFormatSchema.parse({ ...stored, shorts: false }).shorts).toBe(false)
  })

  test.each([
    ['min below the outer floor', { default: 2, min: 2, max: 60 }],
    ['default above max', { default: 70, min: 3, max: 60 }],
    ['max above the outer ceiling', { default: 15, min: 3, max: 181 }],
  ])('refuses runtime: %s', (_label, runtime) => {
    expect(ChannelFormatSchema.safeParse(base({ runtime })).success).toBe(false)
  })

  test('accepts a longest runtime of 180 minutes and names 180 in the refusal of 181', () => {
    expect(
      ChannelFormatSchema.safeParse(base({ runtime: { default: 60, min: 3, max: 180 } })).success,
    ).toBe(true)
    const refused = ChannelFormatSchema.safeParse(
      base({ runtime: { default: 15, min: 3, max: 181 } }),
    )
    expect(refused.success).toBe(false)
    expect(JSON.stringify(refused.error?.issues)).toContain('<= 180')
  })

  test.each([79, 201])('refuses wordsPerMinute %i', (wordsPerMinute) => {
    expect(ChannelFormatSchema.safeParse(base({ wordsPerMinute })).success).toBe(false)
  })

  test.each([1.25, 4.5])('refuses shotHold %f', (shotHold) => {
    expect(ChannelFormatSchema.safeParse(base({ shotHold })).success).toBe(false)
  })

  test('accepts half-step shot holds', () => {
    expect(ChannelFormatSchema.safeParse(base({ shotHold: 1.5 })).success).toBe(true)
  })

  test('refuses a required slot the template lacks, accepts one it has', () => {
    const bad = base({ titleTemplate: '{topic} for Sleep', titleRequiredSlots: ['pillar'] })
    expect(ChannelFormatSchema.safeParse(bad).success).toBe(false)
    const ok = base({ titleTemplate: '{topic} for Sleep', titleRequiredSlots: ['topic'] })
    expect(ChannelFormatSchema.safeParse(ok).success).toBe(true)
  })

  test('refuses a seventh keyword and a 61 character keyword', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(ChannelFormatSchema.safeParse(base({ keywords: seven })).success).toBe(false)
    expect(ChannelFormatSchema.safeParse(base({ keywords: ['x'.repeat(61)] })).success).toBe(false)
  })
})

describe('FormatsSchema', () => {
  const main = defaultFormat()
  test('accepts one primary with unique keys', () => {
    expect(FormatsSchema.safeParse([main, sleep]).success).toBe(true)
  })
  test.each([
    ['empty', []],
    ['two primaries', [main, { ...sleep, primary: true }]],
    ['no primary', [{ ...main, primary: false }]],
    ['duplicate keys', [main, { ...sleep, key: 'main' }]],
    [
      'seven formats',
      Array.from({ length: 7 }, (_, i) => ({ ...main, key: `f${i}`, primary: i === 0 })),
    ],
  ])('refuses %s', (_label, formats) => {
    expect(FormatsSchema.safeParse(formats).success).toBe(false)
  })
})

describe('helpers', () => {
  const main = defaultFormat()
  test('resolveFormat picks the keyed format, else the primary', () => {
    expect(resolveFormat([main, sleep], 'sleep').key).toBe('sleep')
    expect(resolveFormat([main, sleep], 'gone').key).toBe('main')
    expect(resolveFormat([main], null).key).toBe('main')
    expect(resolveFormat([sleep, main], undefined).key).toBe('main')
  })
  test('leadKeyword is the first keyword or null', () => {
    expect(leadKeyword(base({ keywords: ['history for sleep', 'x'] }))).toBe('history for sleep')
    expect(leadKeyword(defaultFormat())).toBeNull()
  })
  test('formatIsDefault ignores key, name and primary only', () => {
    expect(formatIsDefault(defaultFormat('Documentary'))).toBe(true)
    expect(formatIsDefault(sleep)).toBe(true)
    expect(formatIsDefault(base({ keywords: ['a'] }))).toBe(false)
    expect(formatIsDefault(base({ shorts: false }))).toBe(false)
    expect(formatIsDefault(base({ runtime: { default: 15, min: 3, max: 61 } }))).toBe(false)
  })
})
