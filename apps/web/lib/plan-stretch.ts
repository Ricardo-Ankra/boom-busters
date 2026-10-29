import { buildStretchRequest, parseShotList, withoutBannedWords } from '@boom-busters/providers'
import { ValidationError } from '@boom-busters/schemas'
import type { PlannedSlot } from '@boom-busters/schemas'
import type { NewShotSlot } from '@boom-busters/db'
import { callForAnswer } from '@/lib/answer'
import {
  chapterFindingContext,
  chapterShotListRequest,
  repairPlannedChapter,
  type CompleteFn,
  type PlanChapterInput,
} from '@/lib/plan-shared'
import { plannedToRows } from '@/inngest/lib/shot-list'
import { stretchAnswerIssue, type Stretch, type StretchRow } from '@/inngest/lib/stretch'

export interface PlanStretchInput extends PlanChapterInput {
  stretch: Stretch
  before: unknown | null
  after: unknown | null
  headlineAllowed: boolean
  note?: string
  reason?: string
  /** Index the new rows start from; `replaceStretch` renumbers anyway. */
  startIndex: number
  /**
   * The chapter's rows outside the stretch, screen order, anchored times: the
   * timing check judges the new shots among them (`stretchAnswerIssue`).
   */
  context?: readonly StretchRow[]
}

export type StretchOutcome =
  { ok: true; slots: PlannedSlot[]; rows: NewShotSlot[] } | { ok: false; issue: string }

const NO_NARRATION = 'this chapter has no narration to plan'

/** The planned slots as rows on the clock, anchored to the words they quote. */
function convert(input: PlanStretchInput, slots: readonly PlannedSlot[]) {
  return plannedToRows({
    chapterId: input.chapter.id,
    planned: slots,
    paragraphs: input.paragraphs,
    claims: input.claims,
    logos: input.logos,
    startIndex: input.startIndex,
  })
}

/**
 * Re-plans a run of neighbouring shots in one chapter (the stretch re-plan
 * design, 3.3), under the chapter's own request and context.
 *
 * The answer is judged after `plannedToRows`, on the slots that survive
 * conversion: a slot dropped there, or malformed in the answer, is a broken
 * answer, because a missing slot would let the shot before the stretch hold
 * on into it. A broken answer is asked once more with its reason (decision
 * 292). Timing findings refuse only the first answer, so a second answer that
 * still has a short shot is kept, and the shot carries its timing note.
 *
 * A stopped answer is an outcome, not a throw: the caller keeps the old shots
 * and shows the reason. A budget stop and any error the call itself throws go
 * through, as they do for chapter planning.
 */
export async function planStretchWith(
  complete: CompleteFn,
  input: PlanStretchInput,
): Promise<StretchOutcome> {
  const base = chapterShotListRequest(input)
  if (!base) return { ok: false, issue: NO_NARRATION }
  const request = buildStretchRequest(base, {
    bible: input.bible,
    pieces: input.stretch.pieces,
    opening: input.stretch.opening,
    before: input.before,
    after: input.after,
    headlineAllowed: input.headlineAllowed,
    ...(input.note ? { note: input.note } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  })

  let parses = 0
  const answer = await callForAnswer({
    request,
    parse: (text) => {
      const strictTiming = parses === 0
      parses += 1
      const parsed = parseShotList(text)
      const slots = parsed.slots.map((slot) => ({ ...slot, brief: withoutBannedWords(slot.brief) }))
      const conversion = convert(input, slots)
      const issue = stretchAnswerIssue({
        stretch: input.stretch,
        rows: conversion.rows.map((row, at) => ({
          type: row.type,
          startMs: row.startMs ?? 0,
          durationMs: row.durationMs ?? 0,
          coversText: slots[conversion.from[at]!]!.brief.coversText ?? null,
        })),
        planned: slots.length + parsed.malformed.length,
        rejected: [...parsed.malformed, ...conversion.rejected],
        paragraphs: input.paragraphs,
        headlineAllowed: input.headlineAllowed,
        strictTiming,
        ...(input.context ? { context: input.context } : {}),
      })
      if (issue) throw new ValidationError(issue, { field: 'stretch' })
      return { slots, rows: conversion.rows }
    },
    complete: (asked, call) => complete(asked, call === 'answer' ? 'stretch' : call),
  })
  if (!answer.ok) return { ok: false, issue: answer.issue }

  // Craft findings get the automatic brief repair, as in chapter planning.
  // It never changes a type or a quote, so the accepted rows still hold; only
  // their briefs are taken again from the repaired slots.
  const slots = await repairPlannedChapter(complete, {
    request: base,
    slots: answer.value.slots,
    chapterNumber: input.chapter.number,
    context: chapterFindingContext(input),
    bible: input.bible,
  })
  if (slots === answer.value.slots) return { ok: true, ...answer.value }
  const repaired = convert(input, slots)
  return repaired.rows.length === answer.value.rows.length
    ? { ok: true, slots, rows: repaired.rows }
    : { ok: true, ...answer.value }
}
