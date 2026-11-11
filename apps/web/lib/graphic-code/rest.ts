import type { GraphicCodeWord } from '@boom-busters/schemas'

/** The last word's entrance is given this long to finish before the graphic must be at rest. */
const SETTLE_MS = 700

/**
 * Whether a graphic is at rest after its last word (the reading hold): the
 * render keeps a finished graphic up so it can be read, which only works if
 * nothing is still arriving. Every sample from the last word plus the settle
 * time on must show the same text as the final sample; the issue names when
 * the final text arrived. Text is all a dry run
 * can see, so a draw or a move that changes no text is not caught here.
 */
export function restIssue(
  textSamples: readonly string[],
  words: readonly GraphicCodeWord[],
  sampleMs: number,
): string | null {
  const lastWord = words.at(-1)
  const final = textSamples.at(-1)
  if (lastWord === undefined || final === undefined) return null
  const restFromMs = lastWord.atMs + SETTLE_MS
  let lastChangeMs: number | null = null
  textSamples.forEach((text, index) => {
    const atMs = index * sampleMs
    if (atMs >= restFromMs && text !== final) lastChangeMs = atMs + sampleMs
  })
  if (lastChangeMs === null) return null
  return `the graphic is still changing ${lastChangeMs - lastWord.atMs} ms after its last word; after the last word lands, only the camera may move`
}
