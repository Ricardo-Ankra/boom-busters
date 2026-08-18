import { describe, expect, it } from 'vitest'
import {
  buildDuckingCurve,
  DEFAULT_RELEASE_MS,
  DEFAULT_RISE_THRESHOLD_MS,
  gainAt,
  speechSpans,
} from './ducking'

const CONFIG = { bedGainDb: -25, duckDepthDb: -12 }
const DUCKED = -37

describe('speechSpans', () => {
  it('bridges pauses shorter than the rise threshold into one span', () => {
    const spans = speechSpans(
      [
        { startMs: 0, durationMs: 4000 },
        { startMs: 4500, durationMs: 3000 }, // 500 ms pause — a breath, not a break
        { startMs: 12_000, durationMs: 2000 }, // 4.5 s — a real break
      ],
      DEFAULT_RISE_THRESHOLD_MS,
    )
    expect(spans).toEqual([
      { startMs: 0, endMs: 7500 },
      { startMs: 12_000, endMs: 14_000 },
    ])
  })
})

describe('buildDuckingCurve', () => {
  it('ducks under narration and rises only in real silences', () => {
    const curve = buildDuckingCurve(
      [
        { startMs: 0, durationMs: 8000 },
        { startMs: 8200, durationMs: 6000 }, // merged: 200 ms gap
        { startMs: 18_000, durationMs: 4000 }, // real gap: rise between
      ],
      CONFIG,
    )

    // Mid-sentence: ducked. Mid-breath (8.1 s): still ducked, no swell.
    expect(gainAt(curve, 4000)).toBe(DUCKED)
    expect(gainAt(curve, 8100)).toBe(DUCKED)
    // In the real silence, after the release: back at bed level.
    expect(gainAt(curve, 14_200 + DEFAULT_RELEASE_MS)).toBe(CONFIG.bedGainDb)
    // Under the final chapter, ducked again; after it, the outro rises.
    expect(gainAt(curve, 20_000)).toBe(DUCKED)
    expect(gainAt(curve, 22_000 + DEFAULT_RELEASE_MS)).toBe(CONFIG.bedGainDb)
  })

  it('starts ducked when the narration starts at zero', () => {
    const curve = buildDuckingCurve([{ startMs: 0, durationMs: 5000 }], CONFIG)
    expect(curve[0]).toEqual({ tMs: 0, gainDb: DUCKED })
  })

  it('is strictly increasing in time — the schema and MusicBed both assume it', () => {
    const curve = buildDuckingCurve(
      [
        { startMs: 0, durationMs: 3000 },
        { startMs: 6000, durationMs: 3000 },
        { startMs: 12_000, durationMs: 3000 },
      ],
      CONFIG,
    )
    for (let index = 1; index < curve.length; index += 1) {
      expect(curve[index]!.tMs).toBeGreaterThan(curve[index - 1]!.tMs)
    }
  })

  it('holds the bed level with no narration at all', () => {
    expect(buildDuckingCurve([], CONFIG)).toEqual([{ tMs: 0, gainDb: CONFIG.bedGainDb }])
  })
})

describe('gainAt', () => {
  it('interpolates linearly between points', () => {
    const curve = [
      { tMs: 0, gainDb: -25 },
      { tMs: 1000, gainDb: -35 },
    ]
    expect(gainAt(curve, 500)).toBe(-30)
    expect(gainAt(curve, 2000)).toBe(-35)
  })
})
