import type { Caption } from '@boom-busters/schemas'
import { READING_PAUSE_CAP_MS } from '@boom-busters/schemas'
import type { ParagraphSpan, WordRange } from './anchor'

export {
  FIGURE_HOLD_MS,
  holdShortfallMs,
  READING_HOLD_MS,
  READING_PAUSE_CAP_MS,
} from '@boom-busters/schemas'

/**
 * The reading pause: when the next shot would cut away before a graphic has
 * been on screen long enough after its last word, the narration waits. This
 * module only plans where and for how long; the compiler inserts the pauses
 * into its piecewise clock shift, so captions, music and slots follow.
 */

/** True when the word closes a clause, so a pause after it sounds like a breath. */
export function endsClause(text: string): boolean {
  return /[.!?;:,]["'”’)\]]*$/.test(text)
}

export interface ReadingPause {
  /** Index into the slots given to `planReadingPauses`. */
  slotIndex: number
  /** Where the narration is cut, on the pre-shift clock. */
  cutMs: number
  pauseMs: number
  /** True when the cut is the start of the next paragraph, whose gap it joins. */
  paragraphEnd: boolean
}

export interface ReadingHoldReport {
  pauses: number
  addedMs: number
  /** Slots left short because their last word sits mid-clause. */
  midClause: number
  /** Slots whose next shot starts before their last word. */
  overlapped: number
}

export interface PlanReadingPausesInput {
  /** Anchored starts on the pre-shift clock, in any order. */
  slots: readonly { startMs: number; holdMs?: number }[]
  /** Each slot's covered words, as `anchorWordRanges` gives them. */
  ranges: readonly (WordRange | null)[]
  words: readonly Caption[]
  spans: readonly ParagraphSpan[]
  /** The pre-shift to shifted clock with only paragraph and chapter gaps in it. */
  shiftAt: (tMs: number) => number
}

export function planReadingPauses(input: PlanReadingPausesInput): {
  pauses: ReadingPause[]
  report: ReadingHoldReport
} {
  const { slots, ranges, words, spans, shiftAt } = input
  const pauses: ReadingPause[] = []
  const report: ReadingHoldReport = { pauses: 0, addedMs: 0, midClause: 0, overlapped: 0 }

  const order = slots.map((_, index) => index).sort((a, b) => slots[a]!.startMs - slots[b]!.startMs)
  order.forEach((index, position) => {
    const slot = slots[index]!
    const range = ranges[index]
    if (slot.holdMs === undefined || range === null || range === undefined) return
    const last = words[range.last]
    if (last === undefined) return
    const nextIndex = order[position + 1]
    // The film's last slot has nothing to wait for: the compiler extends it.
    if (nextIndex === undefined) return
    const next = slots[nextIndex]!.startMs
    if (last.startMs >= next) {
      report.overlapped += 1
      return
    }
    const available = next + shiftAt(next) - (last.startMs + shiftAt(last.startMs))
    const shortfall = slot.holdMs - available
    if (shortfall <= 0) return
    if (!endsClause(last.text)) {
      report.midClause += 1
      return
    }
    const spanIndex = spanIndexAt(spans, last.startMs)
    const span = spans[spanIndex]
    const following = words[range.last + 1]
    const paragraphEnd =
      span === undefined || following === undefined || following.startMs >= span.endMs
    let cutMs: number
    if (paragraphEnd) {
      // The last paragraph of the film has no next paragraph to carry the pause.
      const nextSpan = spans[spanIndex + 1]
      if (nextSpan === undefined) return
      cutMs = nextSpan.startMs
    } else {
      cutMs = Math.round((last.endMs + following.startMs) / 2)
    }
    // The next shot starts before the cut (it was never anchored to a word), so
    // the pause would play as dead air under it and the hold would not be given.
    if (cutMs > next) {
      report.overlapped += 1
      return
    }
    const pauseMs = Math.min(shortfall, READING_PAUSE_CAP_MS)
    pauses.push({ slotIndex: index, cutMs, pauseMs, paragraphEnd })
    report.pauses += 1
    report.addedMs += pauseMs
  })

  return { pauses, report }
}

function spanIndexAt(spans: readonly ParagraphSpan[], tMs: number): number {
  let found = 0
  for (let i = 0; i < spans.length; i += 1) {
    if (spans[i]!.startMs > tMs) break
    found = i
  }
  return found
}
