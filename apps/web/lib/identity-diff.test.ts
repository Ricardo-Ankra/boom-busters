import { DEFAULT_MOTION_IDENTITY } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { identityDiff } from './identity-diff'

describe('identityDiff (spec 2026-11-04, section 8.4)', () => {
  it("lists only the fields that change, in the tab's words", () => {
    const d = identityDiff(DEFAULT_MOTION_IDENTITY, {
      ...DEFAULT_MOTION_IDENTITY,
      overshoot: 'none',
      ms: { enter: 900 },
    })
    expect(d.map((change) => change.label)).toEqual(['Lengths', 'Overshoot'])
    expect(d[0]).toMatchObject({ field: 'ms', current: 'house', proposed: 'enter 900' })
    expect(d[1]).toMatchObject({ current: 'hair', proposed: 'none' })
  })

  it('is empty for an identical proposal', () => {
    expect(identityDiff(DEFAULT_MOTION_IDENTITY, { ...DEFAULT_MOTION_IDENTITY })).toEqual([])
  })

  it('writes lists as comma-separated phrases and a switch as on or off', () => {
    const d = identityDiff(DEFAULT_MOTION_IDENTITY, {
      ...DEFAULT_MOTION_IDENTITY,
      allow: ['glows', 'lens flares'],
      blurFollowsSpeed: false,
      techniques: ['kinetic-word-stack', 'bar-chart'],
    })
    expect(d.find((c) => c.field === 'allow')).toMatchObject({
      current: 'none',
      proposed: 'glows, lens flares',
    })
    expect(d.find((c) => c.field === 'blurFollowsSpeed')).toMatchObject({
      current: 'on',
      proposed: 'off',
    })
    expect(d.find((c) => c.field === 'techniques')?.proposed).toBe('kinetic-word-stack, bar-chart')
  })
})
