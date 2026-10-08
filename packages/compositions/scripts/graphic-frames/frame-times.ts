import { graphicChangeTimes } from '@boom-busters/schemas'
import type { GraphicTimingScene } from '@boom-busters/schemas'
import { msToFrames } from '../../src/lib/motion'

export const FPS = 30
/** The first look: before most entrances, so the empty or half-built card shows. */
export const FIRST_LOOK_MS = 300
/** An entrance takes 600 ms and a bar's growth 700, so this shows each change settled. */
export const SETTLE_MS = 700

/**
 * The frames worth looking at in a graphic of this length: 0.3 s, every
 * change (an entrance, an exit, a timed bar, an emphasis, a camera move;
 * decision 290) plus 700 ms, and the last frame. Clamped inside the slot,
 * distinct and ascending.
 */
export function framesToRender(scene: GraphicTimingScene, durationMs: number): number[] {
  const last = Math.max(0, msToFrames(durationMs, FPS) - 1)
  const wanted = [
    msToFrames(FIRST_LOOK_MS, FPS),
    ...graphicChangeTimes(scene).map((atMs) => msToFrames(atMs + SETTLE_MS, FPS)),
    last,
  ]
  return [...new Set(wanted.map((frame) => Math.min(last, Math.max(0, frame))))].sort(
    (a, b) => a - b,
  )
}
