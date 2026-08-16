import { narrationUnits } from '@boom-busters/providers'
import type { ShotParagraph } from '@boom-busters/providers'
import { latestTakes, resolvePlannedBrief } from '@boom-busters/schemas'
import type { PlannedSlot, VoiceTakeStatus } from '@boom-busters/schemas'
import type { NewShotSlot } from '@boom-busters/db'

/**
 * The timeline arithmetic the shot-list model is never asked to do.
 *
 * The model anchors slots to paragraphs; this module owns the clock. Real
 * milliseconds come from the approved narration takes, laid end to end in
 * script order — the same order assembly will lay them in M6 — and each
 * paragraph's slots are allotted from its own span. Deterministic, so a
 * re-run over unchanged narration produces byte-identical timings.
 */

export interface TimedParagraph {
  chapterId: string
  /** The paragraph's index within its chapter — the `paragraph_index` column. */
  index: number
  text: string
  startMs: number
  durationMs: number
}

/** ~150 words a minute — the fallback when a paragraph has no measured take. */
function estimateParagraphMs(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.max(2_000, words * 400)
}

export interface TakeDuration {
  chapterId: string
  paragraphIndex: number
  takeNumber: number
  status: string
  durationMs: number | null
}

/**
 * Every paragraph of the script with its position on the narration clock.
 *
 * Durations come from each paragraph's CURRENT take (highest take number —
 * the same `latestTakes` the voice gate counted). A paragraph without audio
 * still gets a span, estimated from its words: the visuals stage runs after
 * the voice gate so this should not happen, but a fan-out that tolerated a
 * failed paragraph must not collapse the whole clock behind it to zero.
 */
export function timedParagraphs(input: {
  chapters: readonly { id: string; title: string; contentMd: string }[]
  takes: readonly TakeDuration[]
}): TimedParagraph[] {
  const current = latestTakes(
    input.takes.map((take) => ({
      chapterId: take.chapterId,
      paragraphIndex: take.paragraphIndex,
      takeNumber: take.takeNumber,
      status: take.status as VoiceTakeStatus,
      durationMs: take.durationMs,
    })),
  )
  const durations = new Map(
    current.map((take) => [`${take.chapterId}:${take.paragraphIndex}`, take.durationMs]),
  )

  let clock = 0
  return narrationUnits({ chapters: input.chapters }).map((unit) => {
    const measured = durations.get(`${unit.chapterId}:${unit.unitIndex}`)
    const durationMs = measured ?? estimateParagraphMs(unit.text)
    const paragraph: TimedParagraph = {
      chapterId: unit.chapterId,
      index: unit.unitIndex,
      text: unit.text,
      startMs: clock,
      durationMs,
    }
    clock += durationMs
    return paragraph
  })
}

/** The paragraphs of one chapter, shaped for the shot-list prompt. */
export function promptParagraphs(
  paragraphs: readonly TimedParagraph[],
  chapterId: string,
): ShotParagraph[] {
  return paragraphs
    .filter((paragraph) => paragraph.chapterId === chapterId)
    .map((paragraph) => ({
      index: paragraph.index,
      text: paragraph.text,
      seconds: paragraph.durationMs / 1000,
    }))
}

/** A slot may never be shorter than this — a one-frame flash is an error, not a shot. */
export const MIN_SLOT_MS = 2_000

export interface PlannedConversion {
  rows: NewShotSlot[]
  /** Chart slots that cited claims outside the list — dropped, and named. */
  rejected: { paragraphIndex: number; reason: string }[]
}

/**
 * One chapter's planned slots become storable rows with real times.
 *
 * Slots are laid out inside their paragraph's span in the order the model
 * emitted them: each takes the seconds it asked for, clamped to what remains
 * of the paragraph, and never less than `MIN_SLOT_MS` — a plan that overruns
 * its paragraph is squeezed rather than silently reordered, and the timeline
 * compiler in M6 owns any final reconciliation.
 *
 * Chart briefs have their claim numbers swapped for ids here; a chart citing
 * a claim that does not exist is REJECTED and reported, never stored as a
 * chart with invented sourcing (build spec section 7.4).
 */
export function plannedToRows(input: {
  chapterId: string
  planned: readonly PlannedSlot[]
  paragraphs: readonly TimedParagraph[]
  claimIds: readonly string[]
  /** Slot index offset — indexes are unique per chapter, so the caller counts. */
  startIndex?: number
}): PlannedConversion {
  const spans = new Map(
    input.paragraphs
      .filter((paragraph) => paragraph.chapterId === input.chapterId)
      .map((paragraph) => [paragraph.index, paragraph]),
  )

  const rows: NewShotSlot[] = []
  const rejected: PlannedConversion['rejected'] = []
  const cursors = new Map<number, number>()
  let index = input.startIndex ?? 0

  // Stable order: by paragraph, then as emitted within it.
  const ordered = [...input.planned].sort((a, b) => a.paragraphIndex - b.paragraphIndex)

  for (const slot of ordered) {
    const paragraph = spans.get(slot.paragraphIndex)
    if (!paragraph) {
      rejected.push({
        paragraphIndex: slot.paragraphIndex,
        reason: `paragraph ${slot.paragraphIndex} does not exist in this chapter`,
      })
      continue
    }

    const brief = resolvePlannedBrief(slot.brief, input.claimIds)
    if (!brief) {
      rejected.push({
        paragraphIndex: slot.paragraphIndex,
        reason: 'chart cited a claim number outside the claim list',
      })
      continue
    }

    const cursor = cursors.get(slot.paragraphIndex) ?? paragraph.startMs
    const paragraphEnd = paragraph.startMs + paragraph.durationMs
    const asked = Math.round(slot.seconds * 1000)
    const durationMs = Math.max(MIN_SLOT_MS, Math.min(asked, paragraphEnd - cursor))

    rows.push({
      chapterId: input.chapterId,
      index,
      type: brief.type,
      brief,
      startMs: cursor,
      durationMs,
    })

    cursors.set(slot.paragraphIndex, cursor + durationMs)
    index += 1
  }

  return { rows, rejected }
}

/** Fan-out width for slot resolution — same reasoning as `TTS_CONCURRENCY`. */
export const RESOLUTION_CONCURRENCY = 4
