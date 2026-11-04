// @vitest-environment jsdom

import { denseFrameTimes } from '@boom-busters/schemas'
import { describe, expect, it, vi } from 'vitest'
import { fittedWidth, grabFrames, referenceFrameSets, type FrameGrabber } from './client-video'

/**
 * Frames taken from a clip in the owner's browser (spec 2026-11-04, section
 * 7.2). The seek and the draw are the two things jsdom cannot do, so they
 * sit behind `FrameGrabber`; everything around them runs for real.
 */

const size = { width: 640, height: 360 }

function fakeGrabber(failAt?: number): FrameGrabber & { seeks: number[] } {
  const seeks: number[] = []
  return {
    seeks,
    async seek(atMs) {
      if (failAt !== undefined && seeks.length >= failAt) {
        throw new Error(`the clip did not seek to ${(atMs / 1000).toFixed(2)} s`)
      }
      seeks.push(atMs)
    },
    async draw() {
      return new Blob([new Uint8Array([1])], { type: 'image/jpeg' })
    },
  }
}

describe('fittedWidth', () => {
  it('fits a 1920 by 1080 frame to 640 wide', () => {
    expect(fittedWidth(1920, 1080, 640)).toEqual({ width: 640, height: 360 })
  })

  it('never enlarges a small frame and keeps even sides', () => {
    expect(fittedWidth(321, 181, 640)).toEqual({ width: 320, height: 180 })
  })
})

describe('grabFrames', () => {
  it('grabs a frame per time in order and reports progress', async () => {
    const grabber = fakeGrabber()
    const progress = vi.fn()
    const frames = await grabFrames(grabber, [0, 83, 167], size, progress)
    expect(grabber.seeks).toEqual([0, 83, 167])
    expect(frames.map((frame) => frame.atMs)).toEqual([0, 83, 167])
    expect(frames[0]).toMatchObject({ width: 640, height: 360 })
    expect(frames[0]!.blob.size).toBe(1)
    expect(progress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('reports a grab that returns fewer frames than asked', async () => {
    await expect(grabFrames(fakeGrabber(31), denseFrameTimes(0, 4000), size)).rejects.toThrow(
      'Only 31 of 48 frames could be taken',
    )
  })
})

describe('referenceFrameSets', () => {
  it('counts the dense window and the overview of the whole clip', () => {
    const sets = referenceFrameSets({ startMs: 1000, endMs: 3500 }, 10_000)
    expect(sets.dense).toHaveLength(30)
    expect(sets.overview).toHaveLength(20)
  })
})
