import { describe, expect, it } from 'vitest'
import { crossfadeGain, loopCopies, outroGain } from './music-loop'

/** 30fps: a 100-frame bed is 3.3s, a 30-frame crossfade is one second. */
const CROSSFADE = 30

describe('loopCopies', () => {
  it('starts each copy a crossfade before the one before it ends', () => {
    // Bed 100, crossfade 30: 70 frames are kept and a copy starts every 40.
    const copies = loopCopies({ bedFrames: 100, totalFrames: 200, crossfadeFrames: CROSSFADE })
    expect(copies.map((copy) => copy.fromFrames)).toEqual([0, 40, 80, 120, 160])
    // Every copy stops short of the file's end, where its fade-out lives.
    expect(copies[0]!.durationInFrames).toBe(70)
    // Each copy overlaps the next by exactly one crossfade.
    expect(copies[0]!.fromFrames + copies[0]!.durationInFrames - copies[1]!.fromFrames).toBe(
      CROSSFADE,
    )
  })

  it('covers the film to its last frame and no further', () => {
    const copies = loopCopies({ bedFrames: 100, totalFrames: 200, crossfadeFrames: CROSSFADE })
    const last = copies[copies.length - 1]!
    expect(last.fromFrames + last.durationInFrames).toBe(200)
    expect(last.fromFrames).toBeLessThan(200)
  })

  it('does not loop a bed that outlasts the film', () => {
    expect(loopCopies({ bedFrames: 500, totalFrames: 200, crossfadeFrames: CROSSFADE })).toEqual([])
  })

  it('does not loop a bed with nothing between two seams', () => {
    expect(loopCopies({ bedFrames: 80, totalFrames: 400, crossfadeFrames: CROSSFADE })).toEqual([])
  })
})

describe('crossfadeGain', () => {
  const shape = (localFrame: number, copyIndex: number) =>
    crossfadeGain({ localFrame, copyIndex, keptFrames: 70, crossfadeFrames: CROSSFADE })

  it('opens the film at full and every later copy from silence', () => {
    expect(shape(0, 0)).toBe(1)
    expect(shape(0, 1)).toBe(0)
    expect(shape(CROSSFADE, 1)).toBeCloseTo(1)
  })

  it('holds the whole middle of a copy at full', () => {
    expect(shape(35, 1)).toBeCloseTo(1)
  })

  it('falls to silence by the end of every copy', () => {
    expect(shape(40, 1)).toBeCloseTo(1)
    expect(shape(70, 1)).toBeCloseTo(0)
  })

  it('holds the loudness across a seam, which linear crossfades do not', () => {
    // Halfway through the overlap the outgoing copy is 55 frames in and the
    // incoming 15; equal power means the squares sum to one, not the gains.
    const outgoing = shape(55, 1)
    const incoming = shape(15, 2)
    expect(outgoing ** 2 + incoming ** 2).toBeCloseTo(1)
    expect(outgoing + incoming).toBeGreaterThan(1)
  })
})

describe('outroGain', () => {
  it('leaves the film alone until its last seconds', () => {
    expect(outroGain(0, 300, 60)).toBe(1)
    expect(outroGain(240, 300, 60)).toBe(1)
  })

  it('takes the bed to silence on the final frame', () => {
    expect(outroGain(270, 300, 60)).toBeCloseTo(Math.cos(Math.PI / 4))
    expect(outroGain(300, 300, 60)).toBeCloseTo(0)
  })

  it('does nothing when no fade was asked for', () => {
    expect(outroGain(300, 300, 0)).toBe(1)
  })
})
