import { describe, expect, it } from 'vitest'
import { DEFAULT_MOTION_IDENTITY } from './motion-identity'
import {
  denseFrameTimes,
  MotionIdentityDraftSchema,
  MotionReferenceInputSchema,
  overviewFrameTimes,
  ReferenceReadingSchema,
  referenceExtension,
  referenceKind,
} from './motion-references'

/**
 * Motion references (spec 2026-11-04, sections 5.1 to 5.3, 6 and 7): the
 * form the owner fills, the two frame clocks the browser and the finalise
 * share, the reading's shape and the identity draft's.
 */

const clip = {
  kind: 'video',
  title: 'A',
  purpose: 'mechanism',
  carryOver: 'borrow the hold, not the glow',
} as const

describe('MotionReferenceInputSchema', () => {
  it('refuses a window shorter than a second or longer than four', () => {
    expect(
      MotionReferenceInputSchema.safeParse({ ...clip, windowStartMs: 0, windowEndMs: 900 }).success,
    ).toBe(false)
    expect(
      MotionReferenceInputSchema.safeParse({ ...clip, windowStartMs: 0, windowEndMs: 4001 })
        .success,
    ).toBe(false)
    const ok = MotionReferenceInputSchema.safeParse({
      ...clip,
      windowStartMs: 2000,
      windowEndMs: 5000,
    })
    expect(ok.success).toBe(true)
  })

  it('names the window rule in its refusal', () => {
    const r = MotionReferenceInputSchema.safeParse({ ...clip, windowStartMs: 0, windowEndMs: 900 })
    expect(r.success).toBe(false)
    expect(r.error!.issues[0]!.message).toBe('The window is one to four seconds')
  })

  it('gives a still no window and reads an empty link as null', () => {
    const r = MotionReferenceInputSchema.parse({
      kind: 'image',
      title: 'A',
      purpose: 'look',
      carryOver: 'x',
      sourceUrl: '',
      windowStartMs: null,
      windowEndMs: null,
    })
    expect(r.sourceUrl).toBeNull()
    expect(r.rights).toBe('Reference only')
    expect(r.negative).toBe(false)
    expect(r.avoid).toBe('')
    expect(
      MotionReferenceInputSchema.safeParse({
        kind: 'image',
        title: 'A',
        purpose: 'look',
        carryOver: 'x',
        windowStartMs: 0,
        windowEndMs: 2000,
      }).success,
    ).toBe(false)
  })

  it('refuses a carry-over line over 300 characters', () => {
    expect(
      MotionReferenceInputSchema.safeParse({
        kind: 'image',
        title: 'A',
        purpose: 'look',
        carryOver: 'x'.repeat(301),
      }).success,
    ).toBe(false)
  })
})

describe('the frame clocks', () => {
  it('spaces dense frames a twelfth of a second apart across the window, at most 48', () => {
    expect(denseFrameTimes(1000, 2000)).toHaveLength(12)
    expect(denseFrameTimes(1000, 2000).slice(0, 3)).toEqual([1000, 1083, 1167])
    expect(denseFrameTimes(0, 4000)).toHaveLength(48)
    expect(denseFrameTimes(0, 9000)).toHaveLength(48)
  })

  it('spaces overview frames half a second apart across the clip, at most 180', () => {
    expect(overviewFrameTimes(3000)).toEqual([0, 500, 1000, 1500, 2000, 2500])
    expect(overviewFrameTimes(90_000)).toHaveLength(180)
    expect(overviewFrameTimes(200_000)).toHaveLength(180)
  })
})

describe('the mime helpers', () => {
  it('knows a clip from a still and its extension', () => {
    expect(referenceKind('video/quicktime')).toBe('video')
    expect(referenceExtension('video/quicktime')).toBe('mov')
    expect(referenceKind('image/webp')).toBe('image')
    expect(referenceExtension('image/jpeg')).toBe('jpg')
  })
})

describe('ReferenceReadingSchema', () => {
  const reading = {
    medium: 'x',
    type: 'x',
    enters: 'x',
    exits: 'x',
    motion: 'x',
    absent: 'x',
    palette: [],
    notes: '',
    readAt: new Date().toISOString(),
    model: 'm',
  }

  it('refuses a reading line over its limit and a palette over six', () => {
    expect(ReferenceReadingSchema.safeParse(reading).success).toBe(true)
    expect(ReferenceReadingSchema.safeParse({ ...reading, motion: 'y'.repeat(401) }).success).toBe(
      false,
    )
    expect(
      ReferenceReadingSchema.safeParse({ ...reading, palette: Array(7).fill('#fff') }).success,
    ).toBe(false)
  })
})

describe('MotionIdentityDraftSchema', () => {
  it('reads a draft through the identity schema', () => {
    expect(MotionIdentityDraftSchema.parse({ identity: {}, why: 'house' }).identity).toEqual(
      DEFAULT_MOTION_IDENTITY,
    )
    expect(
      MotionIdentityDraftSchema.safeParse({ identity: { techniques: ['stat-counter'] }, why: '' })
        .success,
    ).toBe(false)
  })
})
