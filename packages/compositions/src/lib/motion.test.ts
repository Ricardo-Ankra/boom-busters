import { describe, expect, it } from 'vitest'
import { dbToGain, kenburnsScale, mediaUrl, msToFrames, transitionOpacity } from './motion'

describe('kenburnsScale', () => {
  it('pushes in from 1 to 1 + intensity', () => {
    expect(kenburnsScale('in', 0.1, 0)).toBe(1)
    expect(kenburnsScale('in', 0.1, 1)).toBeCloseTo(1.1)
  })

  it('pulls out from 1 + intensity back to 1', () => {
    expect(kenburnsScale('out', 0.16, 0)).toBeCloseTo(1.16)
    expect(kenburnsScale('out', 0.16, 1)).toBeCloseTo(1)
  })

  it('is monotonic — no wobble mid-slot', () => {
    let last = kenburnsScale('in', 0.1, 0)
    for (let t = 0.1; t <= 1.001; t += 0.1) {
      const next = kenburnsScale('in', 0.1, t)
      expect(next).toBeGreaterThanOrEqual(last)
      last = next
    }
  })
})

describe('dbToGain', () => {
  it('maps 0 dB to unity and -20 dB to a tenth', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-20)).toBeCloseTo(0.1)
  })
})

describe('msToFrames', () => {
  it('rounds to the nearest frame at the composition fps', () => {
    expect(msToFrames(1000, 30)).toBe(30)
    expect(msToFrames(1017, 30)).toBe(31)
  })
})

describe('mediaUrl', () => {
  it('prefers the materialised url, falls back to the stable external one', () => {
    expect(mediaUrl({ r2Key: 'k', url: 'https://signed.example/a' })).toBe(
      'https://signed.example/a',
    )
    expect(mediaUrl({ externalUrl: 'https://cdn.example/b' })).toBe('https://cdn.example/b')
  })

  it('refuses an unmaterialised reference loudly', () => {
    expect(() => mediaUrl({ r2Key: 'boom-busters/media/abc' })).toThrow(/unmaterialised/)
  })
})

describe('transitionOpacity', () => {
  it('cuts are instant, dissolves ramp over 500 ms', () => {
    expect(transitionOpacity('cut', 0)).toBe(1)
    expect(transitionOpacity('dissolve', 0)).toBe(0)
    expect(transitionOpacity('dissolve', 250)).toBeCloseTo(0.5)
    expect(transitionOpacity('dissolve', 800)).toBe(1)
  })
})
