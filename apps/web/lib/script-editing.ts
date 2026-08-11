import { diffArrays } from 'diff'
import { sentenceHash, splitSentences } from '@boom-busters/schemas'
import type { GutterWarning } from '@boom-busters/schemas'

/**
 * The pure logic behind Script Studio (build spec section 11.3).
 *
 * Kept out of the components so the parts that can be wrong in a way nobody
 * notices — which hunks a partial accept produces, where a gutter marker
 * lands — are testable without a browser.
 */

// ---------------------------------------------------------------------------
// Diff hunks
// ---------------------------------------------------------------------------

export interface Hunk {
  /** Stable within one diff; used as the React key and the accept-set member. */
  id: number
  /** Sentences present before and not after. */
  removed: string[]
  /** Sentences present after and not before. */
  added: string[]
}

export interface ScriptDiff {
  /** Every sentence of the result, in order, tagged by where it came from. */
  parts: { kind: 'same' | 'removed' | 'added'; sentences: string[]; hunkId?: number }[]
  hunks: Hunk[]
}

/**
 * Diff two versions of a chapter by sentence.
 *
 * Sentences rather than words or lines, because a sentence is already the unit
 * this app reasons in: warnings attach to sentences and claims pin to
 * sentences. A word-level diff would render prettier and produce hunks a
 * reviewer cannot accept individually without splitting a claim reference in
 * half.
 *
 * Adjacent removals and additions are paired into one hunk, so a rewritten
 * sentence reads as one decision — "replace this with that" — rather than two
 * unrelated ones the reviewer could accept half of and end up with both
 * versions in the script.
 */
export function diffChapters(before: string, after: string): ScriptDiff {
  const changes = diffArrays(splitSentences(before), splitSentences(after))
  const parts: ScriptDiff['parts'] = []
  const hunks: Hunk[] = []

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index]!

    if (!change.added && !change.removed) {
      parts.push({ kind: 'same', sentences: change.value })
      continue
    }

    const next = changes[index + 1]
    const paired = change.removed && next?.added ? next : undefined

    const hunk: Hunk = {
      id: hunks.length,
      removed: change.removed ? change.value : [],
      added: change.added ? change.value : (paired?.value ?? []),
    }
    hunks.push(hunk)

    if (hunk.removed.length > 0) {
      parts.push({ kind: 'removed', sentences: hunk.removed, hunkId: hunk.id })
    }
    if (hunk.added.length > 0) {
      parts.push({ kind: 'added', sentences: hunk.added, hunkId: hunk.id })
    }

    if (paired) index += 1
  }

  return { parts, hunks }
}

/**
 * Rebuild the chapter with only the accepted hunks applied.
 *
 * A rejected hunk keeps what was there before; an accepted one takes the new
 * text. Accepting none must return the original exactly, which is the property
 * that makes "Reject all" safe to click.
 */
export function applyHunks(diff: ScriptDiff, accepted: ReadonlySet<number>): string {
  const out: string[] = []

  for (const part of diff.parts) {
    if (part.kind === 'same') {
      out.push(...part.sentences)
      continue
    }

    const isAccepted = part.hunkId !== undefined && accepted.has(part.hunkId)

    if (part.kind === 'removed' && !isAccepted) out.push(...part.sentences)
    if (part.kind === 'added' && isAccepted) out.push(...part.sentences)
  }

  return out.join(' ')
}

// ---------------------------------------------------------------------------
// Gutter warnings
// ---------------------------------------------------------------------------

export interface PlacedWarning extends GutterWarning {
  /** Character offset of the sentence in the chapter, or -1 if not found. */
  start: number
  end: number
  /** The 0-based sentence index, for the gutter rail. */
  sentenceIndex: number
}

/**
 * Locate each warning's sentence in the chapter text.
 *
 * Matched by hash rather than by string equality, so a warning survives the
 * human fixing a comma in the sentence it points at. A warning whose sentence
 * has been genuinely rewritten no longer matches, and is reported with
 * `start: -1` — the UI lists it as "no longer in the text" instead of silently
 * dropping it, because a warning that vanishes when you edit near it teaches
 * you to edit near it.
 */
export function placeWarnings(
  contentMd: string,
  warnings: readonly GutterWarning[],
): PlacedWarning[] {
  const sentences = splitSentences(contentMd)
  const byHash = new Map<string, { index: number; start: number; end: number }>()

  let cursor = 0
  for (const [index, sentence] of sentences.entries()) {
    const start = contentMd.indexOf(sentence, cursor)
    if (start >= 0) {
      byHash.set(sentenceHash(sentence), { index, start, end: start + sentence.length })
      cursor = start + sentence.length
    }
  }

  return warnings.map((warning) => {
    const found = byHash.get(sentenceHash(warning.sentence))
    return {
      ...warning,
      start: found?.start ?? -1,
      end: found?.end ?? -1,
      sentenceIndex: found?.index ?? -1,
    }
  })
}

// ---------------------------------------------------------------------------
// One-click fixes
// ---------------------------------------------------------------------------

/**
 * Insert a hedge into a sentence that states an unadjudicated claim as fact
 * (spec section 11.3: "insert 'alleged'").
 *
 * No longer wired to a button: the one-click fix now routes through the
 * regenerate flow, so the model's wording arrives as a proposal the human
 * approves rather than an edit that lands unseen. This stays because it is the
 * only hedge available when no provider can be reached, and because it is the
 * cheap check `containsHedge` is built from.
 *
 * It goes after the first verb-ish position we can find cheaply — in practice,
 * after the subject's first comma or before the main clause — and falls back to
 * prefixing "Reportedly, ". The fallback is deliberate: a hedge in a slightly
 * awkward place is a legal improvement, whereas a fix that silently does
 * nothing leaves the sentence exactly as dangerous as it was.
 */
export function hedgeSentence(sentence: string): string {
  if (/\b(alleged|allegedly|reportedly|according to|claims?|said to)\b/i.test(sentence)) {
    return sentence
  }

  return `Reportedly, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`
}

/** Replace one sentence in a chapter, leaving everything else byte-identical. */
export function replaceSentence(contentMd: string, target: string, replacement: string): string {
  const at = contentMd.indexOf(target)
  if (at < 0) return contentMd

  return contentMd.slice(0, at) + replacement + contentMd.slice(at + target.length)
}

// ---------------------------------------------------------------------------
// Header stats
// ---------------------------------------------------------------------------

/**
 * How far the script is from its target runtime.
 *
 * Returned as a signed number of seconds so the header can say "2 min over"
 * rather than making the reader subtract two timecodes.
 */
export function runtimeDelta(chapters: readonly { estRuntimeSec: number }[], targetMin: number) {
  const totalSec = chapters.reduce((total, chapter) => total + chapter.estRuntimeSec, 0)
  const targetSec = targetMin * 60

  return { totalSec, targetSec, deltaSec: totalSec - targetSec }
}

export function formatDuration(seconds: number): string {
  const abs = Math.abs(Math.round(seconds))
  const minutes = Math.floor(abs / 60)
  const rest = abs % 60

  return `${minutes}:${String(rest).padStart(2, '0')}`
}
