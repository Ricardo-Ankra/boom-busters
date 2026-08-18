import type { Caption } from '@boom-busters/schemas'

/**
 * Snap-to-script (build spec section 6): the transcriber hears the audio, the
 * script is ground truth. Transcribed words are aligned to script words with
 * Needleman-Wunsch (case/punctuation-insensitive), and the output captions
 * take their TIMINGS from the transcription and their TEXT from the script —
 * so a caption can never contain a mistranscription.
 *
 * Script words with no transcribed match get interpolated timings from their
 * matched neighbours; a run of unmatched words spanning more than 1.5 s of
 * audio is returned as a gap for the QC report, because that much unheard
 * script usually means the audio and the script genuinely disagree.
 */

export interface AlignedWord {
  text: string
  startMs: number
  endMs: number
}

export interface SnapGap {
  startMs: number
  endMs: number
  /** How many script words sit in the unheard stretch. */
  scriptWords: number
}

export interface SnapResult {
  captions: Caption[]
  gaps: SnapGap[]
}

export const MAX_UNMATCHED_GAP_MS = 1500

/**
 * Narration text carries bracketed performance tags — [pause], [sighs] —
 * which the narrator interprets and the viewer must never read. They are
 * direction, not content, so they are not script words.
 */
const TAG = /^\[[^\]]+\]$/

function scriptTokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0 && !TAG.test(token))
}

/** Case- and punctuation-insensitive comparison form. */
export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

const MATCH = 2
const MISMATCH = -1
const GAP = -1

/**
 * Global alignment over normalised tokens. O(n·m) — a chapter is a few
 * hundred words, so the table stays small; assembly aligns per chapter.
 */
function align(script: string[], heard: string[]): (number | null)[] {
  const n = script.length
  const m = heard.length
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i += 1) score[i]![0] = i * GAP
  for (let j = 1; j <= m; j += 1) score[0]![j] = j * GAP

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const diagonal = score[i - 1]![j - 1]! + (script[i - 1] === heard[j - 1] ? MATCH : MISMATCH)
      const up = score[i - 1]![j]! + GAP
      const left = score[i]![j - 1]! + GAP
      score[i]![j] = Math.max(diagonal, up, left)
    }
  }

  // Traceback: for each script index, the heard index it aligned to (or null).
  const matched: (number | null)[] = new Array<number | null>(n).fill(null)
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const diagonal = score[i - 1]![j - 1]! + (script[i - 1] === heard[j - 1] ? MATCH : MISMATCH)
    if (score[i]![j] === diagonal) {
      // A diagonal move donates its timing even when the tokens differ: a
      // same-position different-spelling pair ("nineteen" vs "19") is exactly
      // the mistranscription the snap exists to survive — right moment,
      // wrong letters, and the letters come from the script anyway.
      matched[i - 1] = j - 1
      i -= 1
      j -= 1
    } else if (score[i]![j] === score[i - 1]![j]! + GAP) {
      i -= 1
    } else {
      j -= 1
    }
  }

  return matched
}

export function snapToScript(scriptText: string, heard: AlignedWord[]): SnapResult {
  const words = scriptTokens(scriptText)
  const matched = align(
    words.map(normalizeWord),
    heard.map((word) => normalizeWord(word.text)),
  )

  const captions: Caption[] = []
  const gaps: SnapGap[] = []

  // Pass 1: matched words carry real timings.
  const timings: ({ startMs: number; endMs: number } | null)[] = matched.map((index) =>
    index === null ? null : { startMs: heard[index]!.startMs, endMs: heard[index]!.endMs },
  )

  // Pass 2: interpolate unmatched runs between their matched neighbours.
  let index = 0
  while (index < words.length) {
    if (timings[index] !== null) {
      index += 1
      continue
    }
    const runStart = index
    while (index < words.length && timings[index] === null) index += 1
    const runEnd = index // exclusive

    const previous = runStart > 0 ? timings[runStart - 1] : null
    const next = runEnd < words.length ? timings[runEnd] : null
    const spanStart = previous ? previous.endMs : (heard[0]?.startMs ?? 0)
    const spanEnd = next ? next.startMs : (heard[heard.length - 1]?.endMs ?? spanStart)
    const span = Math.max(0, spanEnd - spanStart)
    const count = runEnd - runStart

    for (let k = 0; k < count; k += 1) {
      timings[runStart + k] = {
        startMs: Math.round(spanStart + (span * k) / count),
        endMs: Math.round(spanStart + (span * (k + 1)) / count),
      }
    }

    if (span > MAX_UNMATCHED_GAP_MS) {
      gaps.push({ startMs: spanStart, endMs: spanEnd, scriptWords: count })
    }
  }

  for (let w = 0; w < words.length; w += 1) {
    const timing = timings[w]!
    captions.push({
      text: words[w]!,
      startMs: timing.startMs,
      endMs: Math.max(timing.endMs, timing.startMs),
      timestampMs: Math.round((timing.startMs + Math.max(timing.endMs, timing.startMs)) / 2),
      confidence: null,
    })
  }

  return { captions, gaps }
}

/**
 * Merge per-paragraph snap results onto the project clock: each paragraph's
 * captions are shifted by its narration segment's start.
 */
export function offsetCaptions(captions: readonly Caption[], offsetMs: number): Caption[] {
  return captions.map((caption) => ({
    ...caption,
    startMs: caption.startMs + offsetMs,
    endMs: caption.endMs + offsetMs,
    timestampMs: caption.timestampMs === null ? null : caption.timestampMs + offsetMs,
  }))
}
