import { anchorWordRanges } from '@boom-busters/timeline'
import type { TimedParagraph } from './shot-list'
import { timingFindings } from './timing-findings'

/**
 * Cutting a stretch of neighbouring shots out of a chapter, and checking a
 * re-plan's answer against it (the stretch re-plan design, 3.3). A pure
 * module: the caller supplies anchored rows and timed paragraphs.
 */

export interface StretchPiece {
  /** The paragraph's `index` within its chapter. */
  paragraphIndex: number
  text: string
  seconds: number
}

export interface Stretch {
  chapterId: string
  /** Inclusive indexes into paragraphs.flatMap((p) => p.words). */
  firstWord: number
  lastWord: number
  startMs: number
  endMs: number
  pieces: StretchPiece[]
  /** The stretch's opening words, which the first new quote must start with. */
  opening: string
}

export interface StretchRow {
  id: string
  chapterId: string
  index: number
  type: string
  brief: unknown
  startMs: number
  durationMs: number
  coversText: string | null
}

const NEIGHBOURS_ONLY = 'Re-plan works on neighbouring shots in one chapter.'
const NO_TIMINGS =
  'This narration has no word timings, so a stretch cannot be cut. Use Re-plan shot list instead.'

const refuse = (refused: string) => ({ ok: false as const, refused })

export function cutStretch(input: {
  /** Every row of the selected chapter, screen order, anchored times. */
  chapterRows: readonly StretchRow[]
  selectedIds: readonly string[]
  paragraphs: readonly TimedParagraph[]
}):
  | { ok: true; stretch: Stretch; before: StretchRow | null; after: StretchRow | null }
  | { ok: false; refused: string } {
  const { chapterRows, selectedIds, paragraphs } = input
  const positions = [...new Set(selectedIds)].map((id) =>
    chapterRows.findIndex((row) => row.id === id),
  )
  if (positions.length === 0 || positions.includes(-1)) return refuse(NEIGHBOURS_ONLY)
  const low = Math.min(...positions)
  const high = Math.max(...positions)
  if (high - low + 1 !== positions.length) return refuse(NEIGHBOURS_ONLY)

  const first = chapterRows[low]!
  const before = chapterRows[low - 1] ?? null
  const after = chapterRows[high + 1] ?? null
  const chapterId = first.chapterId

  const chapterParagraphs = paragraphs.filter((paragraph) => paragraph.chapterId === chapterId)
  const lastParagraph = chapterParagraphs[chapterParagraphs.length - 1]
  if (!lastParagraph) return refuse(NO_TIMINGS)
  const endMs = after ? after.startMs : lastParagraph.startMs + lastParagraph.durationMs

  // One entry per word of the flat array, so word indexes agree with the
  // ones `anchorWordRanges` and `timingFindings` use.
  const flat = paragraphs.flatMap((paragraph, at) => paragraph.words.map((word) => ({ word, at })))
  const firstWord = flat.findIndex((entry) => entry.word.startMs >= first.startMs)
  let lastWord = -1
  flat.forEach((entry, i) => {
    if (entry.word.startMs < endMs) lastWord = i
  })
  if (firstWord === -1 || lastWord < firstWord) return refuse(NO_TIMINGS)

  const pieces: StretchPiece[] = []
  for (let i = firstWord; i <= lastWord;) {
    const { at } = flat[i]!
    let end = i
    while (end + 1 <= lastWord && flat[end + 1]!.at === at) end += 1
    const paragraph = paragraphs[at]!
    const next = end + 1 <= lastWord ? flat[end + 1]! : null
    const pieceEnd = next
      ? next.word.startMs
      : Math.min(paragraph.startMs + paragraph.durationMs, endMs)
    pieces.push({
      paragraphIndex: paragraph.index,
      text: flat
        .slice(i, end + 1)
        .map((entry) => entry.word.text)
        .join(' '),
      seconds: (pieceEnd - flat[i]!.word.startMs) / 1000,
    })
    i = end + 1
  }

  return {
    ok: true,
    before,
    after,
    stretch: {
      chapterId,
      firstWord,
      lastWord,
      startMs: flat[firstWord]!.word.startMs,
      endMs,
      pieces,
      opening: flat
        .slice(firstWord, firstWord + 6)
        .map((entry) => entry.word.text)
        .join(' '),
    },
  }
}

const quoteOpening = (text: string | null): string => {
  const opening = (text ?? '').split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
  return opening ? `the shot quoting "${opening}..."` : 'a new shot with no quote'
}

/** Why an answer cannot replace the stretch, or null when it can. */
export function stretchAnswerIssue(input: {
  stretch: Stretch
  rows: readonly { type: string; startMs: number; durationMs: number; coversText: string | null }[]
  /** Slots the answer held before conversion, and why any were dropped. */
  planned: number
  rejected: readonly { reason: string }[]
  paragraphs: readonly TimedParagraph[]
  headlineAllowed: boolean
  /** Timing findings refuse the answer only on the first attempt (spec 3.3). */
  strictTiming: boolean
}): string | null {
  const { stretch, rows, planned, rejected, paragraphs } = input

  if (planned !== rows.length) {
    const reasons = rejected.map((entry) => entry.reason).join('; ')
    return `${planned - rows.length} of your ${planned} shots were dropped${reasons ? `: ${reasons}` : ''}. Every shot must be valid`
  }

  const ranges = anchorWordRanges(
    rows.map((row) => ({
      startMs: row.startMs,
      durationMs: row.durationMs,
      ...(row.coversText ? { coversText: row.coversText } : {}),
    })),
    paragraphs.flatMap((paragraph) => paragraph.words),
    paragraphs.map((paragraph) => ({
      startMs: paragraph.startMs,
      endMs: paragraph.startMs + paragraph.durationMs,
    })),
  )

  for (const [i, range] of ranges.entries()) {
    if (!range)
      return `${quoteOpening(rows[i]!.coversText)} quotes words that are not in the narration`
  }
  for (const [i, range] of ranges.entries()) {
    if (range!.first < stretch.firstWord || range!.last > stretch.lastWord) {
      return `${quoteOpening(rows[i]!.coversText)} starts or ends outside the stretch`
    }
  }
  const head = ranges[0]
  if (head && head.first !== stretch.firstWord) {
    return `the first shot must quote the stretch's opening words, "${stretch.opening}"`
  }
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i - 1]!.last >= ranges[i]!.first) {
      return `${quoteOpening(rows[i]!.coversText)} overlaps or comes before the shot ahead of it; quotes must follow the narration in order, with no sentence in two shots`
    }
  }
  if (!input.headlineAllowed && rows.some((row) => row.type === 'headline')) {
    return 'this chapter already has its news headline shot, so none of the new shots may be a headline'
  }
  if (input.strictTiming) {
    const findings = timingFindings(
      rows.map((row) => ({ chapterId: stretch.chapterId, ...row })),
      paragraphs,
    )
    if (findings[0]) return findings[0].message
  }
  return null
}
