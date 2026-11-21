import { SHORT_RULES } from '@boom-busters/schemas'
import type { GraphicCodeWord, TimelineSlot } from '@boom-busters/schemas'

/**
 * A point Short's designed graphics, paced by their words.
 *
 * A designed graphic is choreographed on spoken words: each beat lands when
 * the narration says its label. The long form gives it the words its slot
 * covers and holds it after the last (decision 465). A Short lifts the same
 * code, so it must do the same on its own clock: the graphic's cues are the
 * Short's words from its first word to its last cue word, it stays up until
 * that word has landed and been held, and it is never cut into pieces that
 * replay its entrance.
 */

/** What pacing needs of a shot; the plan's and the compiler's shots both fit. */
export interface PaceableShot {
  startWord: number
  slot: TimelineSlot | null
  cueEndWord?: number
}

export interface GraphicPaceReport {
  /** Back-to-back shots of one graphic joined into one. */
  merged: number
  /** Graphics whose next cut came too early and was moved later. */
  held: number
  /** Shots that started inside a hold and were dropped. */
  dropped: number
  /** Shots that started inside a hold and now start at its end. */
  moved: number
}

/** True for a graphic whose motion is timed to words: the designer's code. */
export function isCuedGraphic(slot: TimelineSlot | null): boolean {
  return slot !== null && slot.payload.kind === 'graphic-code'
}

/** The same designed graphic: the same code drawing the same title and data. */
export function sameGraphic(a: TimelineSlot | null, b: TimelineSlot | null): boolean {
  if (a === null || b === null) return false
  if (a.payload.kind !== 'graphic-code' || b.payload.kind !== 'graphic-code') return false
  return (
    a.payload.compiled === b.payload.compiled &&
    a.payload.title === b.payload.title &&
    JSON.stringify(a.payload.data ?? null) === JSON.stringify(b.payload.data ?? null)
  )
}

/**
 * The last cue word of the shot at `at`: its stored one, else the word before
 * the next shot (or the Short's last word), never before its own first word
 * nor at or after the next shot's first.
 */
function cueEndOf(shots: readonly PaceableShot[], at: number, wordCount: number): number {
  const shot = shots[at]!
  const next = shots[at + 1]
  const limit = next ? next.startWord - 1 : wordCount - 1
  const first = at === 0 ? 0 : shot.startWord
  const cue = shot.cueEndWord ?? limit
  return Math.max(first, Math.min(cue, limit))
}

/**
 * Pace every designed graphic by its words. In order, for each graphic:
 *
 * 1. a following shot of the same graphic is joined to it, and its words join
 *    the cues, so one graphic plays once and never replays its entrance;
 * 2. its last cue word is written on the shot, so a later cut never moves it;
 * 3. if the next shot would cut before the last cue word plus the settle and
 *    the hold, the cut moves to the first word at or after that time. Shots
 *    starting inside the hold are dropped, except the last, which takes over
 *    at the new cut when at least `shotMinMs` of it remains. Another shot of
 *    the same graphic inside the hold, or next once the hold's shots are
 *    dropped, joins it, as in 1. A graphic that ends up longer than
 *    `graphicShotMaxMs` is left whole; the rule book reports it.
 *
 * Shots are returned as copies with `startWord` and `cueEndWord` updated; the
 * input is not changed. Pacing a paced plan changes nothing.
 */
export function paceGraphicShots<T extends PaceableShot>(
  input: readonly T[],
  words: readonly { startMs: number }[],
  narrationEndMs: number,
): { shots: T[]; report: GraphicPaceReport } {
  const R = SHORT_RULES
  const shots = input.map((shot) => ({ ...shot }))
  const report: GraphicPaceReport = { merged: 0, held: 0, dropped: 0, moved: 0 }
  const startMsOf = (at: number): number =>
    at === 0 ? 0 : (words[shots[at]!.startWord]?.startMs ?? 0)

  for (let at = 0; at < shots.length; at += 1) {
    const shot = shots[at]!
    if (!isCuedGraphic(shot.slot)) continue

    let held = false
    for (;;) {
      // 1. Join the same graphic when it comes straight after.
      while (sameGraphic(shots[at + 1]?.slot ?? null, shot.slot)) {
        const cue = cueEndOf(shots, at + 1, words.length)
        shots.splice(at + 1, 1)
        shot.cueEndWord = cue
        report.merged += 1
      }

      // 2. Fix the cues before any cut moves.
      const cue = cueEndOf(shots, at, words.length)
      shot.cueEndWord = cue

      const next = shots[at + 1]
      if (next === undefined) break
      // The hold is never cut short: a graphic too long for the rule book is a
      // finding for the owner, not a graphic cut off before it can be read.
      const cueMs = words[cue]?.startMs ?? startMsOf(at)
      const holdEndMs = cueMs + R.graphicSettleMs + R.graphicHoldMs
      const nextStartMs = words[next.startWord]?.startMs ?? narrationEndMs
      if (nextStartMs >= holdEndMs) break

      // 3. The next cut comes too early. Find the shots that start inside the hold.
      let cutWord = -1
      for (let w = cue + 1; w < words.length; w += 1) {
        if (words[w]!.startMs >= holdEndMs) {
          cutWord = w
          break
        }
      }
      let end = at + 1
      while (end < shots.length && (cutWord === -1 || shots[end]!.startWord < cutWord)) end += 1
      const inside = shots.slice(at + 1, end)

      // The same graphic again inside the hold: its words are cues too.
      const again = inside.map((s) => sameGraphic(s.slot, shot.slot)).lastIndexOf(true)
      if (again !== -1) {
        const cueAgain = cueEndOf(shots, at + 1 + again, words.length)
        report.dropped += again
        report.merged += 1
        shots.splice(at + 1, again + 1)
        shot.cueEndWord = cueAgain
        continue
      }

      held = true
      const last = inside.at(-1)
      const followingMs = shots[end]
        ? (words[shots[end]!.startWord]?.startMs ?? narrationEndMs)
        : narrationEndMs
      const keepLast =
        last !== undefined && cutWord !== -1 && followingMs - words[cutWord]!.startMs >= R.shotMinMs
      const replacement = keepLast ? [{ ...last, startWord: cutWord }] : []
      // A moved graphic's cues are worked out again from its new start.
      if (keepLast) delete replacement[0]!.cueEndWord
      report.dropped += inside.length - replacement.length
      report.moved += replacement.length
      shots.splice(at + 1, inside.length, ...replacement)
      // Look again: with the dropped shots gone, the same graphic may come next.
    }
    if (held) report.held += 1
  }
  return { shots, report }
}

/** Where a paced graphic shot plays on the Short's clock (`pointGraphicWindow`). */
export interface PointGraphicWindow {
  /** The shot's start: 0 for the first shot, else its first word's. */
  startMs: number
  /** The next shot's start, or the narration's end for the last. */
  endMs: number
  /** The first of its cue words: 0 for the first shot, else its own first word. */
  firstWord: number
  /** The last of its cue words, never past the word before the next shot. */
  cueEndWord: number
  /** The code's planned length: until its last cue has landed and settled, within the shot. */
  plannedMs: number
}

/**
 * Where the paced graphic shot at `at` plays, as `compileShortMaster` lays it
 * out: the compile reads it to time the code, and a Short's own design
 * (decision 476) is written to the same window, so the code is designed for
 * exactly the words and the length the render plays it on. A shot's planned
 * length ends once its last cue has landed and settled; the shot runs on
 * through the hold.
 */
export function pointGraphicWindow(
  shots: readonly PaceableShot[],
  at: number,
  words: readonly { startMs: number }[],
  narrationEndMs: number,
): PointGraphicWindow {
  const shot = shots[at]!
  const next = shots[at + 1]
  const startMs = at === 0 ? 0 : (words[shot.startWord]?.startMs ?? 0)
  const endMs = next ? (words[next.startWord]?.startMs ?? narrationEndMs) : narrationEndMs
  const firstWord = at === 0 ? 0 : shot.startWord
  const lastWord = next ? next.startWord - 1 : words.length - 1
  const cueEndWord = Math.max(firstWord, Math.min(shot.cueEndWord ?? lastWord, lastWord))
  const cueMs = Math.max(0, (words[cueEndWord]?.startMs ?? startMs) - startMs)
  const plannedMs = Math.max(1, Math.min(endMs - startMs, cueMs + SHORT_RULES.graphicSettleMs))
  return { startMs, endMs, firstWord, cueEndWord, plannedMs }
}

/**
 * A graphic's words on its own clock: its cue words from its first word to
 * `cueEndWord`, offset from its start. Words of the same graphic's earlier
 * appearances come first at 0 ms, as already said, so a graphic shown again
 * opens on what the Short has told so far rather than waiting for it.
 */
export function graphicCueWords(input: {
  words: readonly { text: string; startMs: number }[]
  firstWord: number
  cueEndWord: number
  startMs: number
  earlier: readonly string[]
}): GraphicCodeWord[] {
  const said = input.earlier.map((text) => ({ text, atMs: 0 }))
  const cues = input.words
    .slice(input.firstWord, input.cueEndWord + 1)
    .map((word) => ({ text: word.text, atMs: Math.max(0, word.startMs - input.startMs) }))
  return [...said, ...cues]
}
