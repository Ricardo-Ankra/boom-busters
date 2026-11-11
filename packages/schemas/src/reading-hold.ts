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

/** The card title split into words, each timed at the silent reading pace. */
export function cardWords(title: string): GraphicCodeWord[] {
  return title
    .split(/\s+/)
    .filter((text) => text.length > 0)
    .map((text, i) => ({ text, atMs: CARD_FIRST_WORD_MS + CARD_WORD_STEP_MS * i }))
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
