import type { GraphicCodeWord } from './graphic-code'

/** How long a narrated graphic holds after its last word, so it can be read. */
export const READING_HOLD_MS = 2000
/** The same hold for a chart or a counter, which needs longer to take in. */
export const FIGURE_HOLD_MS = 2500
/** The most any one pause may be stretched to give a graphic its hold. */
export const READING_PAUSE_CAP_MS = 1500

/** A silent card shows its first word this long after it starts. */
export const CARD_FIRST_WORD_MS = 300
/** The gap between one card word and the next. */
export const CARD_WORD_STEP_MS = 250
/** The time the last card word takes to finish arriving. */
export const CARD_SETTLE_MS = 700
/** How long a finished card sits still before it leaves. */
export const CARD_REST_MS = 1500
/** No card is shorter than this. */
export const CARD_MIN_MS = 3200
/** How much of the card's end overlaps the next piece of the film. */
export const CARD_OVERLAP_MS = 900

/** A non-breaking space (U+00A0), built by code so it stays visible in source. */
const NBSP = String.fromCharCode(0xa0)
/** A run of whitespace other than the non-breaking space. */
const SPACE_RUN = new RegExp('[^\\S' + NBSP + ']+')

/**
 * The card title split into words, each timed at the silent reading pace. A word
 * ending in a full stop (an abbreviation: "Mr.", "U.S.") is glued to the word after
 * it with a non-breaking space, so the pair is one card word and never leaves a
 * stray word ending in "." that a label rule would read as a label. A title's last
 * word is left as written.
 */
export function cardWords(title: string): GraphicCodeWord[] {
  const tokens = title.split(SPACE_RUN).filter((text) => text.length > 0)
  const words: string[] = []
  let pending = ''
  tokens.forEach((token, i) => {
    const joined = pending + token
    if (i < tokens.length - 1 && joined.endsWith('.')) {
      pending = joined + NBSP
    } else {
      words.push(joined)
      pending = ''
    }
  })
  return words.map((text, i) => ({ text, atMs: CARD_FIRST_WORD_MS + CARD_WORD_STEP_MS * i }))
}

/** How long a card with this title needs on screen. */
export function cardDurationMs(title: string): number {
  const words = cardWords(title)
  const lastAt = words.length > 0 ? words[words.length - 1]!.atMs : CARD_FIRST_WORD_MS
  return Math.max(CARD_MIN_MS, lastAt + CARD_SETTLE_MS + CARD_REST_MS + CARD_OVERLAP_MS)
}

/** How much longer a graphic must stay up to give its last word the full hold. */
export function holdShortfallMs(lastWordAtMs: number, endMs: number, holdMs: number): number {
  return Math.max(0, holdMs - (endMs - lastWordAtMs))
}
