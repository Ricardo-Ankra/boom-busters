import { SHORT_RULES } from '@boom-busters/schemas'
import { isCuedGraphic, paceGraphicShots } from './point-graphics'
import type { GraphicPaceReport, PaceableShot } from './point-graphics'
import { endsClause } from './reading-hold'

/**
 * A point Short's pictures, paced to the narration's phrasing (decision 475).
 *
 * The owner: pictures may move faster than the long form's, but never flash
 * past, and the cuts should keep the narration's beat. So a picture's cut
 * lands where a phrase starts, not mid-phrase, and a picture left shorter
 * than `shotMinMs` is folded into its neighbour. Designed graphics are paced
 * first, by their words (`paceGraphicShots`); a picture never moves into a
 * graphic's hold.
 */

/** How far, in words, a cut may move to reach the start of a phrase. */
export const PHRASE_SNAP_WORDS = 3

export interface PicturePaceReport {
  /** Picture cuts moved to the start of a phrase. */
  snapped: number
  /** Pictures shorter than the rule book's least, folded into a neighbour. */
  folded: number
}

type Word = { text: string; startMs: number }

/** True when the word opens a phrase: the first word, or one after a clause's end. */
function opensPhrase(words: readonly Word[], at: number): boolean {
  return at === 0 || (words[at - 1] !== undefined && endsClause(words[at - 1]!.text))
}

/**
 * Pace every picture of a plan already paced for its graphics. Until nothing
 * changes:
 *
 * 1. a picture that starts mid-phrase moves to the nearest phrase start within
 *    `PHRASE_SNAP_WORDS` words (the later one on a tie), staying after the
 *    shot before it and before the shot after it, and never earlier when the
 *    shot before is a graphic, whose hold it would cut into;
 * 2. a picture shorter than `shotMinMs` is folded into the shot before it, which
 *    runs on over its words; a first picture that short takes in the picture
 *    after it instead. A graphic is never folded.
 *
 * Shots are returned as copies; the input is not changed. Pacing a paced plan
 * changes nothing.
 */
export function pacePictureShots<T extends PaceableShot>(
  input: readonly T[],
  words: readonly Word[],
  narrationEndMs: number,
): { shots: T[]; report: PicturePaceReport } {
  const shots = input.map((shot) => ({ ...shot }))
  const report: PicturePaceReport = { snapped: 0, folded: 0 }
  const startMsOf = (at: number): number =>
    at === 0 ? 0 : (words[shots[at]!.startWord]?.startMs ?? narrationEndMs)
  const endMsOf = (at: number): number =>
    at + 1 < shots.length ? startMsOf(at + 1) : narrationEndMs

  const snap = (): boolean => {
    let changed = false
    for (let at = 1; at < shots.length; at += 1) {
      const shot = shots[at]!
      if (isCuedGraphic(shot.slot) || opensPhrase(words, shot.startWord)) continue
      const before = shots[at - 1]!
      const after = shots[at + 1]
      const lo = isCuedGraphic(before.slot) ? shot.startWord : before.startWord + 1
      const hi = (after ? after.startWord : words.length) - 1
      for (let distance = 1; distance <= PHRASE_SNAP_WORDS; distance += 1) {
        const found = [shot.startWord + distance, shot.startWord - distance].find(
          (word) => word >= lo && word <= hi && opensPhrase(words, word),
        )
        if (found !== undefined) {
          shot.startWord = found
          report.snapped += 1
          changed = true
          break
        }
      }
    }
    return changed
  }

  const fold = (): boolean => {
    for (let at = 0; at < shots.length; at += 1) {
      const shot = shots[at]!
      if (isCuedGraphic(shot.slot)) continue
      if (endMsOf(at) - startMsOf(at) >= SHORT_RULES.shotMinMs) continue
      if (at > 0) {
        shots.splice(at, 1)
        report.folded += 1
        return true
      }
      const next = shots[1]
      if (next !== undefined && !isCuedGraphic(next.slot)) {
        shots.splice(1, 1)
        report.folded += 1
        return true
      }
    }
    return false
  }

  for (;;) {
    const snapped = snap()
    const folded = fold()
    if (!snapped && !folded) break
  }
  return { shots, report }
}

/**
 * A point Short's whole pacing: its designed graphics by their words, then its
 * pictures by the narration's phrasing, again until neither changes anything:
 * a folded picture can leave one graphic's two shots side by side, which the
 * graphics pass then joins. The plan's planner, the assembly and the compiler
 * all pace through this, so each sees the same cut.
 */
export function pacePointShots<T extends PaceableShot>(
  input: readonly T[],
  words: readonly Word[],
  narrationEndMs: number,
): { shots: T[]; report: GraphicPaceReport & PicturePaceReport } {
  const report = { merged: 0, held: 0, dropped: 0, moved: 0, snapped: 0, folded: 0 }
  let shots: T[] = [...input]
  // Every pass that changes something removes a shot or fixes a cut on a
  // phrase start, so this ends; the bound only guards against a bug.
  for (let pass = 0; pass < input.length + 2; pass += 1) {
    const graphics = paceGraphicShots(shots, words, narrationEndMs)
    const pictures = pacePictureShots(graphics.shots, words, narrationEndMs)
    shots = pictures.shots
    for (const [key, value] of Object.entries({ ...graphics.report, ...pictures.report })) {
      report[key as keyof typeof report] += value
    }
    if (pictures.report.snapped === 0 && pictures.report.folded === 0) break
  }
  return { shots, report }
}
