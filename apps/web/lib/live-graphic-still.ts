import { longestStill } from '@boom-busters/schemas'
import type { GraphicScene } from '@boom-busters/schemas'

/**
 * A designed graphic's longest still stretch, for the live harness's record
 * (decision 290): where nothing on screen changes, and how many words the
 * narrator speaks meanwhile. A long stretch with words in it is dead air.
 */
export function stillOf(
  scene: GraphicScene,
  durationMs: number,
  words: readonly { offsetMs: number }[],
): { fromMs: number; toMs: number; words: number } {
  const still = longestStill(scene, durationMs)
  return {
    ...still,
    words: words.filter((word) => word.offsetMs >= still.fromMs && word.offsetMs < still.toMs)
      .length,
  }
}
