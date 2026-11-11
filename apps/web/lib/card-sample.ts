import type { GraphicCodeWord } from '@boom-busters/schemas'

/**
 * True when the sample has no label line: no word before the last ends a
 * sentence. A card drawn from a labelled sample would show the label where
 * the film has only a title to give it.
 */
export function isTitleOnlySample(words: readonly GraphicCodeWord[]): boolean {
  return !words.slice(0, -1).some((word) => word.text.endsWith('.'))
}
