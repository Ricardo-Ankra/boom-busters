import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOTION_IDENTITY,
  HOUSE_NEVER,
  MotionIdentitySchema,
  motionNeverList,
  motionNumbers,
  resolveMotionIdentity,
} from './motion-identity'
import { DEFAULT_SETTINGS, SettingsPatchSchema, SettingsSchema } from './settings'
import { CHOOSABLE_TECHNIQUES, LAST_RESORT_TECHNIQUES, TECHNIQUES } from './techniques'

/**
 * The channel motion identity (spec 2026-11-04, section 8.1): every taste
 * value the designer used to carry in its prompt, per channel, with the
 * house values as the defaults so a settings row saved before it reads
 * unchanged.
 */
describe('the motion identity', () => {
  it('reads a row without motion as the house identity', () => {
    const stored = { ...DEFAULT_SETTINGS } as Record<string, unknown>
    delete stored['motion']
    expect(SettingsSchema.parse(stored).motion).toEqual(DEFAULT_MOTION_IDENTITY)
  })

  it('holds the house values: the ban list, every technique, the cadence and the still limit', () => {
    expect(DEFAULT_MOTION_IDENTITY.never).toEqual(HOUSE_NEVER)
    expect(DEFAULT_MOTION_IDENTITY.techniques).toEqual([...CHOOSABLE_TECHNIQUES])
    expect(DEFAULT_MOTION_IDENTITY.techniques).not.toContain('film-title')
    expect(TECHNIQUES).toContain('film-title')
    expect(DEFAULT_MOTION_IDENTITY.changeEveryMs).toBe(1500)
    expect(DEFAULT_MOTION_IDENTITY.stillMaxMs).toBe(6000)
    expect(DEFAULT_MOTION_IDENTITY.overshoot).toBe('hair')
    expect(DEFAULT_MOTION_IDENTITY.signatureEase).toBe('soft')
    expect(DEFAULT_MOTION_IDENTITY.entrance).toBe('rise')
  })

  it('keeps a phrase in both lists, and allow takes it out of never (final review, issue 3)', () => {
    const result = MotionIdentitySchema.safeParse({ never: ['Glows'], allow: ['glows '] })
    expect(result.success).toBe(true)
    expect(motionNeverList(result.data!)).toEqual([])
    expect(resolveMotionIdentity({ motion: result.data! }).allow).toEqual(['glows'])
  })

  it('turns the identity into the numbers the tokens are built from', () => {
    expect(motionNumbers(DEFAULT_MOTION_IDENTITY).ms.enter).toBe(450)
    expect(motionNumbers({ ...DEFAULT_MOTION_IDENTITY, overshoot: 'none' }).spring.hero).toEqual({
      damping: 200,
    })
  })

  it('refuses a still limit under the cadence', () => {
    expect(MotionIdentitySchema.safeParse({ changeEveryMs: 2000, stillMaxMs: 1500 }).success).toBe(
      false,
    )
    expect(MotionIdentitySchema.safeParse({ changeEveryMs: 2000, stillMaxMs: 2000 }).success).toBe(
      true,
    )
  })

  it('keeps the two last resorts in the list', () => {
    expect(LAST_RESORT_TECHNIQUES).toEqual(['kinetic-word-stack', 'bar-chart'])
    expect(MotionIdentitySchema.safeParse({ techniques: ['stat-counter'] }).success).toBe(false)
    expect(MotionIdentitySchema.safeParse({ techniques: [] }).success).toBe(false)
    expect(
      MotionIdentitySchema.safeParse({ techniques: ['kinetic-word-stack', 'bar-chart'] }).success,
    ).toBe(true)
  })

  it('bounds the lengths, the lists and the style guide', () => {
    expect(MotionIdentitySchema.safeParse({ ms: { enter: 20 } }).success).toBe(false)
    expect(MotionIdentitySchema.safeParse({ ms: { enter: 900 } }).data?.ms).toEqual({ enter: 900 })
    expect(MotionIdentitySchema.safeParse({ never: Array(17).fill('x') }).success).toBe(false)
    expect(MotionIdentitySchema.safeParse({ styleGuideMd: 'x'.repeat(4001) }).success).toBe(false)
    expect(MotionIdentitySchema.safeParse({ cameraRule: 'x'.repeat(201) }).success).toBe(false)
  })

  it('resolves allow against never', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      motion: { ...DEFAULT_MOTION_IDENTITY, allow: ['Glows'] },
    }
    const resolved = resolveMotionIdentity(settings)
    expect(resolved.never).not.toContain('glows')
    expect(resolved.never).toContain('particle bursts')
    expect(resolved.allow).toEqual(['Glows'])
    expect(motionNeverList(settings.motion)).toEqual(resolved.never)
  })

  it('accepts a motion patch and leaves an absent key absent', () => {
    expect(SettingsPatchSchema.parse({ motion: { overshoot: 'none' } }).motion).toEqual({
      overshoot: 'none',
    })
  })

  it("techniques accept a channel's own key beside the catalogue (spec 8.5)", () => {
    const own = MotionIdentitySchema.safeParse({ techniques: [...TECHNIQUES, 'ledger-wipe'] })
    expect(own.success).toBe(true)
    expect(own.data!.techniques).toContain('ledger-wipe')
    expect(
      MotionIdentitySchema.safeParse({ techniques: [...TECHNIQUES, 'Ledger Wipe'] }).success,
    ).toBe(false)
    expect(
      MotionIdentitySchema.safeParse({ techniques: ['kinetic-word-stack', 'ledger-wipe'] }).success,
    ).toBe(false)
  })
})
