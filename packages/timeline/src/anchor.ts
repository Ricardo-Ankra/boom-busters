import { stripNarrationMarkup } from '@boom-busters/schemas'
import type { Caption } from '@boom-busters/schemas'
import { normalizeWord } from './snap'

/**
 * Put every slot on the words it covers (decision 255).
 *
 * The shot list is planned before a word of it has been timed: the model says
 * how many seconds it wants, and `plannedToRows` lays a paragraph's slots end
 * to end from the paragraph's start. Those seconds are a guess. A slot that
 * asks for two seconds more than its sentence takes pushes every slot behind
 * it two seconds late, and because the seam pass holds the outgoing shot
 * until the next one starts, what the viewer sees is the PREVIOUS image still
 * on screen while the narration has moved on to the next subject. The drift
 * resets at each paragraph, so it shows up on a paragraph's second and third
 * shots, never its first.
 *
 * By assembly the narration is timed word by word (snap-to-script), and every
 * brief quotes the sentences it plays under, so the slot's own `coversText`
 * says when it belongs on screen. That is what this module reads.
 *
 * Only the START moves here. Durations are settled afterwards by the seam
 * pass in the compiler: a shot holds until the next shot's words begin.
 */

export interface AnchorableSlot {
  startMs: number
  durationMs: number
  /** The sentence(s) the slot plays under, quoted from the script verbatim. */
  coversText?: string
}

/** One paragraph's span on the pre-shift clock, which bounds a slot's search. */
export interface ParagraphSpan {
  startMs: number
  endMs: number
}

/**
 * A quoted opening this short is not evidence of a position: three words is
 * where a fallback match stops being a coincidence.
 */
const MIN_ANCHOR_TOKENS = 3

/**
 * Anchor each slot to the first word of the text it covers.
 *
 * A slot keeps its planned start when its quote cannot be found, when it has
 * no quote at all, or when the match would pull it behind the slot before it:
 * the script repeats sentences, and a repeat must never drag a later shot
 * backwards. The search runs inside the slot's OWN paragraph, which is the
 * one thing the planner does get exactly right (paragraph spans are measured
 * take durations), so a quote that appears twice in the film cannot move a
 * shot into a different paragraph.
 */
export function anchorSlots<T extends AnchorableSlot>(
  slots: readonly T[],
  words: readonly Caption[],
  paragraphs: readonly ParagraphSpan[],
): T[] {
  if (slots.length === 0 || words.length === 0) return [...slots]

  const spoken = words.map((word) => normalizeWord(word.text))
  const anchored = [...slots]
  // Clock order, because the floor below is "wherever the previous shot went".
  const order = slots.map((_, index) => index).sort((a, b) => slots[a]!.startMs - slots[b]!.startMs)

  let floorMs = 0
  for (const index of order) {
    const slot = slots[index]!
    const span = paragraphAt(paragraphs, slot.startMs)
    const from = firstWordFrom(words, Math.max(span.startMs, floorMs))
    const until = firstWordFrom(words, span.endMs)
    const at = anchorIndex(spoken, coverTokens(slot.coversText), from, until)
    const startMs = at === -1 ? Math.max(slot.startMs, floorMs) : words[at]!.startMs
    anchored[index] = { ...slot, startMs }
    floorMs = startMs
  }
  return anchored
}

/** The quote as comparable tokens: performance tags and punctuation gone. */
function coverTokens(coversText: string | undefined): string[] {
  if (coversText === undefined) return []
  return stripNarrationMarkup(coversText)
    .split(/\s+/)
    .map((word) => normalizeWord(word))
    .filter((word) => word.length > 0)
}

/**
 * Where the quote starts in the spoken words, or -1.
 *
 * The whole quote first, since that is the case the prompt asks for ("EXACTLY
 * as written"); then its opening words, which survives a model that trimmed a
 * clause, merged two sentences or fixed a typo on the way past.
 */
function anchorIndex(
  spoken: readonly string[],
  tokens: readonly string[],
  from: number,
  until: number,
): number {
  if (tokens.length === 0) return -1
  const whole = findRun(spoken, tokens, from, until)
  if (whole !== -1) return whole
  const opening = Math.min(tokens.length, MIN_ANCHOR_TOKENS)
  if (opening === tokens.length) return -1
  return findRun(spoken, tokens.slice(0, opening), from, until)
}

function findRun(
  spoken: readonly string[],
  tokens: readonly string[],
  from: number,
  until: number,
): number {
  for (let start = from; start + tokens.length <= until; start += 1) {
    let hit = true
    for (let step = 0; step < tokens.length; step += 1) {
      if (spoken[start + step] !== tokens[step]) {
        hit = false
        break
      }
    }
    if (hit) return start
  }
  return -1
}

/** The paragraph a planned start falls in; the whole film when there are none. */
function paragraphAt(paragraphs: readonly ParagraphSpan[], tMs: number): ParagraphSpan {
  let found: ParagraphSpan | undefined
  for (const span of paragraphs) {
    if (span.startMs > tMs) break
    found = span
  }
  return found ?? paragraphs[0] ?? { startMs: 0, endMs: Number.MAX_SAFE_INTEGER }
}

/** Index of the first word at or after `tMs`; the end of the list if none. */
function firstWordFrom(words: readonly Caption[], tMs: number): number {
  for (let index = 0; index < words.length; index += 1) {
    if (words[index]!.startMs >= tMs) return index
  }
  return words.length
}
