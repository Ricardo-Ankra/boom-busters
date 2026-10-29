import { parseShotList, withoutBannedWords } from '@boom-busters/providers'
import type { PlannedSlot } from '@boom-busters/schemas'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import {
  chapterFindingContext,
  chapterShotListRequest,
  repairPlannedChapter,
  type CompleteFn,
  type PlanChapterInput,
} from '@/lib/plan-shared'
import { planStretchWith } from '@/lib/plan-stretch'
import { plannedToRows } from '@/inngest/lib/shot-list'
import { cutStretch, type StretchRow } from '@/inngest/lib/stretch'
import { repairStretches, timingFindings } from '@/inngest/lib/timing-findings'

export { chapterShotListRequest, type CompleteFn, type PlanChapterInput } from '@/lib/plan-shared'

/**
 * One automatic timing repair of a freshly planned chapter (the stretch
 * re-plan design, 3.2). The brief repair cannot move a sentence between
 * shots, so each run of shots with a timing finding (too short, or a sentence
 * quoted twice) is re-planned as a stretch, with the findings as its reason.
 *
 * One pass, never a loop: whatever the pass leaves flagged stays flagged and
 * shows as a timing note. A stretch that stops, or any failure, budget
 * included, keeps its slots exactly as planned, as the brief repair does.
 * Narration without word timings cannot be cut into a stretch, and its
 * chapter keeps its plan.
 */
async function repairChapterTiming(
  complete: CompleteFn,
  input: PlanChapterInput,
  slots: PlannedSlot[],
): Promise<PlannedSlot[]> {
  const conversion = plannedToRows({
    chapterId: input.chapter.id,
    planned: slots,
    paragraphs: input.paragraphs,
    claims: input.claims,
    logos: input.logos,
  })
  // Synthetic ids: these rows are not stored yet, and a cut needs only to
  // tell them apart.
  const rows: StretchRow[] = conversion.rows.map((row, at) => ({
    id: String(at),
    chapterId: input.chapter.id,
    index: at,
    type: row.type,
    brief: row.brief,
    startMs: row.startMs ?? 0,
    durationMs: row.durationMs ?? 0,
    coversText: slots[conversion.from[at]!]!.brief.coversText ?? null,
  }))
  const findings = timingFindings(rows, input.paragraphs)
  const stretches = repairStretches(findings)
  if (stretches.length === 0) return slots

  const repairs: { at: number; replaced: Set<number>; slots: PlannedSlot[] }[] = []
  // Rows already re-planned, so a later stretch reads the chapter as it will be.
  const replacedRows = new Set<number>()
  let headlineAdded = false
  // Last stretch first. The splice below does not depend on the order; the
  // headline bookkeeping does, and reads whatever was re-planned before it.
  for (const indexes of [...stretches].reverse()) {
    const cut = cutStretch({
      chapterRows: rows,
      selectedIds: indexes.map(String),
      paragraphs: input.paragraphs,
    })
    if (!cut.ok) continue
    const inside = new Set(indexes)
    const headlineElsewhere =
      headlineAdded ||
      rows.some((row, at) => !inside.has(at) && !replacedRows.has(at) && row.type === 'headline')
    const reason = findings
      .filter((finding) => finding.stretch.every((at) => inside.has(at)))
      .map((finding) => finding.message)
      .join('; ')
    try {
      const outcome = await planStretchWith(complete, {
        ...input,
        stretch: cut.stretch,
        before: cut.before?.brief ?? null,
        after: cut.after?.brief ?? null,
        headlineAllowed: !headlineElsewhere,
        reason,
        startIndex: 0,
        // The planned rows outside the stretch, so the last new shot is
        // judged against the shot that follows it.
        context: rows.filter((_, at) => !inside.has(at)),
      })
      if (!outcome.ok) {
        console.warn('[visuals] timing repair kept the plan as planned', outcome.issue)
        continue
      }
      const replaced = new Set(indexes.map((at) => conversion.from[at]!))
      repairs.push({ at: Math.min(...replaced), replaced, slots: outcome.slots })
      for (const at of indexes) replacedRows.add(at)
      if (outcome.rows.some((row) => row.type === 'headline')) headlineAdded = true
    } catch (error) {
      console.warn('[visuals] timing repair kept the plan as planned', error)
    }
  }

  // One splice over the planned order: each answer goes where the first slot
  // it replaces was, and every slot it replaces goes. Done in a single pass
  // because a model may emit a later paragraph's slot between two of an
  // earlier one's, so two stretches' planned positions can interleave.
  const replaced = new Set(repairs.flatMap((repair) => [...repair.replaced]))
  const answers = new Map(repairs.map((repair) => [repair.at, repair.slots]))
  return slots.flatMap((slot, at) => [
    ...(answers.get(at) ?? []),
    ...(replaced.has(at) ? [] : [slot]),
  ])
}

export async function planChapterWith(
  complete: CompleteFn,
  input: PlanChapterInput,
): Promise<{ slots: PlannedSlot[]; malformed: number } | null> {
  const request = chapterShotListRequest(input)
  if (!request) return null
  // At most two calls (decision 292): a cut-off asked once more at double the
  // budget, a refusal once more with its reason, then the chapter stops with
  // the reason. The step never restarts the ladder: the stop is non-retriable.
  const parsed = answerOrStop(
    await callForAnswer({
      request,
      parse: parseShotList,
      complete: (asked, call) => complete(asked, call === 'answer' ? 'plan' : call),
    }),
    `Chapter ${input.chapter.number} could not be planned`,
  )
  const slots = await repairPlannedChapter(complete, {
    request,
    slots: parsed.slots.map((slot) => ({ ...slot, brief: withoutBannedWords(slot.brief) })),
    chapterNumber: input.chapter.number,
    context: chapterFindingContext(input),
    bible: input.bible,
  })
  return {
    slots: await repairChapterTiming(complete, input, slots),
    malformed: parsed.malformed.length,
  }
}
