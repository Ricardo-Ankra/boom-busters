/**
 * The overlap check: a drafted example that repeats a run of a source video's
 * words is too close to it to keep (the bible's drafting guard). Words are
 * compared after Unicode, case, quote and punctuation differences are removed,
 * so a copy cannot hide behind them.
 */

/** The words of a text, lower case, with punctuation and quote styles removed. */
export function overlapWords(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .split(/[^\p{L}\p{N}']+/u)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word.length > 0)
}

export interface OverlapSource {
  label: string
  text: string
}

export interface TooClose {
  source: string
  run: string
}

/**
 * The first run of `minWords` consecutive words the text shares with any
 * source, or null. `run` is those words joined by spaces. Words inside a run
 * that also appears in one of the `ignore` texts (wording a text must keep)
 * count towards no run.
 */
export function tooCloseTo(
  text: string,
  sources: readonly OverlapSource[],
  minWords = 8,
  ignore: readonly string[] = [],
): TooClose | null {
  const mine = overlapWords(text)
  if (mine.length < minWords) return null
  const allowed = new Set<string>()
  for (const allowedText of ignore) {
    const words = overlapWords(allowedText)
    for (let i = 0; i + minWords <= words.length; i++) {
      allowed.add(words.slice(i, i + minWords).join(' '))
    }
  }
  const shingles = new Map<string, string>()
  for (const source of sources) {
    const words = overlapWords(source.text)
    // Words inside an allowed run are craft wording: they count towards no run.
    const craft = new Array<boolean>(words.length).fill(false)
    for (let i = 0; i + minWords <= words.length; i++) {
      if (allowed.has(words.slice(i, i + minWords).join(' '))) craft.fill(true, i, i + minWords)
    }
    for (let i = 0; i + minWords <= words.length; i++) {
      if (craft.slice(i, i + minWords).some(Boolean)) continue
      const key = words.slice(i, i + minWords).join(' ')
      if (!shingles.has(key)) shingles.set(key, source.label)
    }
  }
  for (let i = 0; i + minWords <= mine.length; i++) {
    const run = mine.slice(i, i + minWords).join(' ')
    const source = shingles.get(run)
    if (source !== undefined) return { source, run }
  }
  return null
}
