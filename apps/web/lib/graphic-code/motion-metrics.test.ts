// @vitest-environment node

import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { FrameShot } from './frames'
import {
  FROZEN_THRESHOLD,
  METRICS_WIDTH,
  decodeGrey,
  frameChange,
  metricsFromChanges,
  motionMetrics,
} from './motion-metrics'

/**
 * Measured motion (spec 2026-11-04, section 10.1): the dense shots of one
 * orientation compared neighbour to neighbour, as numbers for the critic.
 */

const black = () =>
  sharp({ create: { width: 320, height: 180, channels: 3, background: '#000' } })
    .jpeg()
    .toBuffer()

const struck = async () =>
  sharp(await black())
    .composite([
      {
        input: { create: { width: 160, height: 180, channels: 3, background: '#fff' } },
        left: 0,
        top: 0,
      },
    ])
    .jpeg()
    .toBuffer()

describe('metricsFromChanges', () => {
  it('sums frozen pairs, finds the longest run, and flags it past the still limit', () => {
    const m = metricsFromChanges(
      [
        { atMs: 500, change: 0 },
        { atMs: 1000, change: 30 },
        { atMs: 1500, change: 0 },
      ],
      2000,
      400,
    )
    expect(m).toMatchObject({
      frozenMs: 1000,
      longestFrozenMs: 500,
      frozenCritical: true,
      holdAfterLastMs: 1000,
      simultaneity: 1,
    })
    expect(m.speedProfile).toEqual([
      { atMs: 500, change: 0 },
      { atMs: 1000, change: 30 },
      { atMs: 1500, change: 0 },
    ])
  })

  it('shares the change across the busiest 250 ms', () => {
    const m = metricsFromChanges(
      [
        { atMs: 100, change: 10 },
        { atMs: 200, change: 10 },
        { atMs: 300, change: 10 },
        { atMs: 2000, change: 10 },
      ],
      3000,
      6000,
    )
    expect(m.simultaneity).toBeCloseTo(0.75)
    expect(m.frozenMs).toBe(0)
    expect(m.frozenCritical).toBe(false)
    expect(m.holdAfterLastMs).toBe(1000)
  })

  it('joins consecutive frozen pairs into one run', () => {
    const m = metricsFromChanges(
      [
        { atMs: 250, change: 0 },
        { atMs: 500, change: 1 },
        { atMs: 750, change: FROZEN_THRESHOLD },
        { atMs: 1000, change: 0 },
      ],
      1200,
      6000,
    )
    // The pair ending at 750 changes; the two before it are one run of 500 ms.
    expect(m).toMatchObject({ frozenMs: 750, longestFrozenMs: 500, holdAfterLastMs: 450 })
  })

  it('reports no change as all frozen with the hold at the whole slot', () => {
    expect(metricsFromChanges([{ atMs: 1000, change: 0 }], 4000, 6000)).toMatchObject({
      frozenMs: 1000,
      longestFrozenMs: 1000,
      simultaneity: 0,
      holdAfterLastMs: 4000,
    })
  })
})

describe('decodeGrey and frameChange', () => {
  it('decodes a JPEG to 160 px greyscale and measures the change between two frames', async () => {
    const a = await decodeGrey((await black()).toString('base64'))
    const b = await decodeGrey((await struck()).toString('base64'))
    expect(a.width).toBe(METRICS_WIDTH)
    expect(a.height).toBe(90)
    expect(a.data.length).toBe(METRICS_WIDTH * 90)
    expect(frameChange(a.data, a.data)).toBe(0)
    expect(frameChange(a.data, b.data)).toBeGreaterThan(100)
    expect(() => frameChange(a.data, a.data.slice(1))).toThrow()
  })
})

describe('motionMetrics', () => {
  it('measures the landscape shots only, in time order, and needs two', async () => {
    const dark = (await black()).toString('base64')
    const lit = (await struck()).toString('base64')
    const shots: FrameShot[] = [
      { orientation: 'landscape', atMs: 1000, jpeg: dark },
      { orientation: 'portrait', atMs: 500, jpeg: lit },
      { orientation: 'landscape', atMs: 0, jpeg: dark },
      { orientation: 'landscape', atMs: 500, jpeg: lit },
    ]
    const m = await motionMetrics(shots, 2000, 6000)
    expect(m?.speedProfile.map((p) => p.atMs)).toEqual([500, 1000])
    expect(m?.speedProfile.every((p) => p.change > 100)).toBe(true)
    expect(m?.frozenMs).toBe(0)
    expect(await motionMetrics([shots[0]!], 2000, 6000)).toBeNull()
    expect(await motionMetrics([shots[1]!, shots[0]!], 2000, 6000)).toBeNull()
  })
})
