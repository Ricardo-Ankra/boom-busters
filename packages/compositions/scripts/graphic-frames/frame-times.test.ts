import { describe, expect, it } from 'vitest'
import { framesToRender } from './frame-times'

const scene = (...atMs: number[]) => ({
  elements: atMs.map((at, index) => ({ id: `e${index}`, enter: { atMs: at } })),
})

describe('framesToRender', () => {
  it('takes 0.3 s, each entrance plus 700 ms, and the last frame', () => {
    // 4 s at 30 fps is 120 frames, so the last is 119.
    expect(framesToRender(scene(0, 300, 900), 4000)).toEqual([
      9, // 0.3 s
      21, // 0 + 700 ms
      30, // 300 + 700 ms
      48, // 900 + 700 ms
      119,
    ])
  })

  it('counts a scene that times nothing by its stagger', () => {
    // Untimed elements enter 180 ms apart: 0, 180, 360.
    expect(framesToRender(scene(0, 0, 0), 4000)).toEqual([9, 21, 26, 32, 119])
  })

  it('drops duplicates, so two elements entering together cost one frame', () => {
    expect(framesToRender(scene(500, 500), 4000)).toEqual([9, 36, 119])
  })

  it('clamps a late entrance to the last frame, and a short slot to its own length', () => {
    expect(framesToRender(scene(3900), 4000)).toEqual([9, 119])
    expect(framesToRender(scene(0), 200)).toEqual([5])
  })
})
