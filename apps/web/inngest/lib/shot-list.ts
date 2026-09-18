import { narrationUnits } from '@boom-busters/providers'
import type { ShotParagraph } from '@boom-busters/providers'
import { latestTakes, plannedBriefRejection, resolvePlannedBrief } from '@boom-busters/schemas'
import type { PlannedSlot, PlanningClaim, VoiceTakeStatus, WordTiming } from '@boom-busters/schemas'
import { anchorSlots, MIN_SHOT_MS, snapToScript } from '@boom-busters/timeline'
import type { AnchorWord } from '@boom-busters/timeline'
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
  /**
   * The paragraph's script words on the project clock, snapped to the take
   * that was heard (decision 255, amended). Empty when the take carries no
   * timings, and then slots keep the seconds the model asked for.
   */
  words: AnchorWord[]
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
  /** Word timings from the take, which is what puts a shot on its own words. */
  timings?: unknown
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
  const heard = new Map(
    input.takes.map((take) => [
      `${take.chapterId}:${take.paragraphIndex}:${take.takeNumber}`,
      take.timings,
    ]),
  )
  const takeNumbers = new Map(
    current.map((take) => [`${take.chapterId}:${take.paragraphIndex}`, take.takeNumber]),
  )

  let clock = 0
  return narrationUnits({ chapters: input.chapters }).map((unit) => {
    const key = `${unit.chapterId}:${unit.unitIndex}`
    const measured = durations.get(key)
    const durationMs = measured ?? estimateParagraphMs(unit.text)
    const paragraph: TimedParagraph = {
      chapterId: unit.chapterId,
      index: unit.unitIndex,
      text: unit.text,
      startMs: clock,
      durationMs,
      words: paragraphWords(unit.text, heard.get(`${key}:${takeNumbers.get(key) ?? -1}`), clock),
    }
    clock += durationMs
    return paragraph
  })
}

/**
 * One paragraph's script words on the project clock.
 *
 * Snapped to what was heard, exactly as assembly does it, so the times a shot
 * is planned against are the times it will be rendered against: the script is
 * the ground truth and the transcription only donates the clock. A take with
 * no stored timings contributes no words, which leaves its slots on the
 * planner's own arithmetic rather than guessing.
 */
function paragraphWords(text: string, timings: unknown, offsetMs: number): AnchorWord[] {
  if (!Array.isArray(timings) || timings.length === 0) return []
  const words = timings as WordTiming[]
  return snapToScript(text, words).captions.map((caption) => ({
    text: caption.text,
    startMs: caption.startMs + offsetMs,
  }))
}

/**
 * Where each slot belongs on the clock, and for how long (decision 255).
 *
 * The planner's per-slot seconds are a guess made before the narration was
 * timed; the brief's own `coversText` is not. Given the narration's words,
 * every slot moves to the first word of the text it covers, and then runs
 * until the next slot's words in the same paragraph, or to the end of that
 * paragraph. Same function the compiler anchors with, so what the board shows
 * and what the render cuts are the same times.
 *
 * Returns times in the order it was given them; callers apply them by index.
 */
export function anchoredTimes(
  items: readonly { startMs: number; durationMs: number; coversText?: string | null }[],
  paragraphs: readonly TimedParagraph[],
): { startMs: number; durationMs: number }[] {
  const planned = items.map((item) => ({ startMs: item.startMs, durationMs: item.durationMs }))
  const words = paragraphs.flatMap((paragraph) => paragraph.words)
  if (items.length === 0 || words.length === 0) return planned

  const spans = paragraphs.map((paragraph) => ({
    startMs: paragraph.startMs,
    endMs: paragraph.startMs + paragraph.durationMs,
  }))
  const times = anchorSlots(
    items.map((item) => ({
      startMs: item.startMs,
      durationMs: item.durationMs,
      ...(item.coversText ? { coversText: item.coversText } : {}),
    })),
    words,
    spans,
  ).map((slot) => ({ startMs: slot.startMs, durationMs: slot.durationMs }))

  // Ends, paragraph by paragraph: a shot holds until the next shot's words.
  // Scoped to the paragraph so that this agrees with the same call made over
  // one chapter (planning) or over the whole film (the board).
  const byParagraph = new Map<number, number[]>()
  for (const [index, time] of times.entries()) {
    const home = spans.findIndex(
      (span) => time.startMs >= span.startMs && time.startMs < span.endMs,
    )
    const key = home === -1 ? spans.length : home
    byParagraph.set(key, [...(byParagraph.get(key) ?? []), index])
  }
  for (const [key, indexes] of byParagraph) {
    const ordered = [...indexes].sort((a, b) => times[a]!.startMs - times[b]!.startMs)
    const endOfParagraph = spans[key]?.endMs
    for (const [position, index] of ordered.entries()) {
      const next = ordered[position + 1]
      const time = times[index]!
      const endMs =
        next !== undefined
          ? times[next]!.startMs
          : (endOfParagraph ?? time.startMs + time.durationMs)
      time.durationMs = Math.max(MIN_SHOT_MS, endMs - time.startMs)
    }
  }
  return times
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

/** How many headline cards one chapter may carry (decision 257). */
export const HEADLINES_PER_CHAPTER = 1

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
  /**
   * The claim list, IN PROMPT ORDER: its positions are the numbers the model
   * cited. Claims rather than ids because a headline slot may only cite a news
   * report with a readable source (decision 257).
   */
  claims: readonly PlanningClaim[]
  /** Slot index offset — indexes are unique per chapter, so the caller counts. */
  startIndex?: number
}): PlannedConversion {
  const spans = new Map(
    input.paragraphs
      .filter((paragraph) => paragraph.chapterId === input.chapterId)
      .map((paragraph) => [paragraph.index, paragraph]),
  )

  const rows: NewShotSlot[] = []
  const covers: (string | null)[] = []
  const rejected: PlannedConversion['rejected'] = []
  const cursors = new Map<number, number>()
  let index = input.startIndex ?? 0
  let headlines = 0

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

    const brief = resolvePlannedBrief(slot.brief, input.claims)
    if (!brief) {
      rejected.push({
        paragraphIndex: slot.paragraphIndex,
        reason:
          plannedBriefRejection(slot.brief, input.claims) ??
          'the slot cited a claim it may not cite',
      })
      continue
    }

    // One headline card a chapter (decision 257). It is a bright card in a
    // dark film and it works by being rare, so the surplus is dropped here
    // rather than left to the prompt: a rule with no enforcement is a
    // suggestion, and the model plans three the moment a chapter quotes three
    // articles.
    if (brief.type === 'headline') {
      if (headlines >= HEADLINES_PER_CHAPTER) {
        rejected.push({
          paragraphIndex: slot.paragraphIndex,
          reason: `chapter already has ${HEADLINES_PER_CHAPTER} headline shot, which is the cap`,
        })
        continue
      }
      headlines += 1
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
    covers.push(brief.coversText)

    cursors.set(slot.paragraphIndex, cursor + durationMs)
    index += 1
  }

  // The cursor above is the fallback, not the answer: where the narration has
  // been timed, every slot moves onto the words its brief quotes (decision
  // 255). Doing it here means the board's own times are the rendered times.
  const times = anchoredTimes(
    rows.map((row, at) => ({
      startMs: row.startMs,
      durationMs: row.durationMs,
      coversText: covers[at] ?? null,
    })),
    input.paragraphs,
  )

  return {
    rows: rows.map((row, at) => ({ ...row, ...times[at]! })),
    rejected,
  }
}

/** Fan-out width for slot resolution — same reasoning as `TTS_CONCURRENCY`. */
export const RESOLUTION_CONCURRENCY = 4
