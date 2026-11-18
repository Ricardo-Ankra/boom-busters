import { getShotSlot, updateSlotBrief } from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import { BudgetExceededError, ChartBriefSchema, GraphicBriefSchema } from '@boom-busters/schemas'
import type { DesignableBrief } from '@boom-busters/schemas'
import type { AnswerRetry } from '@/lib/answer'
import { db } from '@/lib/db'
import {
  designGraphic,
  loadGraphicContext,
  reviewGraphic,
  withDesign,
  type GraphicDesignContext,
} from '@/lib/graphic-design'
import { budgetGateData } from './gates'

/**
 * The designer's side jobs (Redesign through the rebriefer, a retype to
 * graphic or chart) share one environment-wide limit of executing steps
 * (decision 471). A step that waits for a place is held by Inngest before it
 * starts, so its 240 s never begin; without the limit a burst of Redesigns
 * queued at the subscription bridge (8 calls at a time) and spent the
 * deadline there. Five leaves the bridge room for the pipeline, a derive and
 * every other call. Every function that uses it must pass this same value.
 */
export const DESIGNER_SIDE_JOBS_CONCURRENCY = {
  scope: 'env',
  key: '"graphics-designer-side-jobs"',
  limit: 5,
} as const

/** `step.run`, as the helper needs it; the runners pass `(id, fn) => step.run(id, fn)`. */
export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>

/**
 * How many more steps may come back for one attempt's answer while the
 * bridge is still writing it (decision 472). Each holds the call up to 165 s,
 * so with the first that is about 14 minutes, inside the bridge's 15-minute
 * limit on a job.
 */
export const DESIGN_COLLECTS_MAX = 4

/** What a slot says when the bridge had still not answered after every collect. */
export const GAVE_UP_ISSUE =
  'the designer took too long (no answer after about 14 minutes); press Redesign to try again'

/**
 * One designer attempt over as many steps as its answer needs (decision 472):
 * `id` asks; while the bridge is still writing, `<id>-collect-<n>` asks again
 * with the same options, which collects the answer the moment it exists and
 * leaves that step the whole 240 s for the checks. The outcome after the last
 * collect may still be pending; the caller says so on the slot.
 */
export async function untilAnswered<T>(
  run: StepRunner,
  id: string,
  attempt: () => Promise<T>,
): Promise<T> {
  let outcome = await run(id, attempt)
  for (let n = 1; isPending(outcome) && n <= DESIGN_COLLECTS_MAX; n += 1) {
    outcome = await run(`${id}-collect-${n}`, attempt)
  }
  return outcome
}

function isPending(outcome: unknown): boolean {
  return (
    typeof outcome === 'object' &&
    outcome !== null &&
    (outcome as { pending?: unknown }).pending === true
  )
}

/**
 * The brief the designer writes for (decision 295): a graphic's or a chart's,
 * as its own schema reads it. Null for any other row, or one that no longer
 * parses.
 */
export function designableBrief(row: { type: string; brief: unknown }): DesignableBrief | null {
  if (row.type === 'graphic') {
    const parsed = GraphicBriefSchema.safeParse(row.brief)
    return parsed.success ? parsed.data : null
  }
  if (row.type === 'chart') {
    const parsed = ChartBriefSchema.safeParse(row.brief)
    return parsed.success ? parsed.data : null
  }
  return null
}

/**
 * Each planned graphic and chart designed in its own step (decisions 289,
 * 295), so an Inngest retry repeats one design and never the chapter. A
 * design the designer could not write keeps its brief and says why; it is
 * never dropped and never stops the plan. Running out of budget stops it.
 *
 * Graphics keep the step ids they had before charts were designed
 * (`<prefix>-<n>`, counting graphics only) and charts take their own
 * (`<prefix>-chart-<n>`), so a run planning across the deploy replays every
 * graphic step it already holds against the row it belongs to. A result
 * replayed from before the deploy carries a scene, not code, so the count of
 * undesigned rows reads `designIssue`, which both kinds of result set alike.
 *
 * Each design that lands is then reviewed in a step of its own
 * (`<id>-review`, decision 389), with that step's whole time to itself; a
 * skipped review leaves the design as it was.
 */
export async function designPlannedGraphics(
  run: StepRunner,
  input: {
    prefix: string
    rows: readonly NewShotSlot[]
    context: Omit<GraphicDesignContext, 'chapterTitle'>
    chapterTitle: string
    /**
     * The Inngest run, which names each attempt's bridge job (decision 472).
     * Absent, each call runs as before, held to one step's 240 s.
     */
    runId?: string
  },
): Promise<
  | { ok: true; rows: NewShotSlot[]; undesigned: number }
  | { ok: false; gate: Record<string, unknown> }
> {
  const rows: NewShotSlot[] = []
  let undesigned = 0
  let graphics = 0
  let charts = 0
  for (const row of input.rows) {
    const brief = designableBrief(row)
    if (!brief || brief.code) {
      rows.push(row)
      continue
    }
    const id =
      brief.type === 'chart' ? `${input.prefix}-chart-${charts}` : `${input.prefix}-${graphics}`
    if (brief.type === 'chart') charts += 1
    else graphics += 1
    const design =
      (options: { firstOnly: true } | { resume: AnswerRetry }, scope: string) => async () => {
        try {
          const result = await designGraphic(
            { ...input.context, chapterTitle: input.chapterTitle },
            {
              chapterId: row.chapterId,
              startMs: row.startMs,
              durationMs: row.durationMs,
              brief,
            },
            input.runId ? { ...options, bridgeJobScope: `${input.runId}/${scope}` } : options,
          )
          // Still being written on the bridge: nothing to keep yet (decision 472).
          if (!result.ok && result.pending) return { ok: true as const, pending: true as const }
          return {
            ok: true as const,
            brief: withDesign(brief, result),
            ...(!result.ok && result.retry ? { retry: result.retry } : {}),
          }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      }
    // The first answer, and the retry it earned in a step of its own with a
    // fresh 240 s (decision 470, after 461): two Opus answers never fit one.
    // Each is collected over further steps while the bridge is still writing
    // it (decision 472). A run parked on these steps before a deploy replays
    // outcomes with neither `retry` nor `pending`, so it goes on as it did.
    const first = await untilAnswered(run, id, design({ firstOnly: true }, id))
    const second =
      first.ok && 'retry' in first && first.retry
        ? await untilAnswered(run, `${id}-retry`, design({ resume: first.retry }, `${id}-retry`))
        : first
    if (!second.ok) return { ok: false, gate: second.gate }
    const outcome =
      'pending' in second
        ? { brief: withDesign(brief, { ok: false, issue: GAVE_UP_ISSUE }) }
        : second
    if (outcome.brief.designIssue !== undefined) undesigned += 1
    let designed = outcome.brief
    if (designed.code && !designed.code.review) {
      const timing = { chapterId: row.chapterId, startMs: row.startMs, durationMs: row.durationMs }
      const reviewed = await run(`${id}-review`, async () => {
        const result = await reviewGraphic(
          { ...input.context, chapterTitle: input.chapterTitle },
          { ...timing, brief: designed },
        )
        return result.outcome === 'skipped'
          ? null
          : withDesign(designed, { ok: true, code: result.code })
      })
      if (reviewed) designed = reviewed
    }
    rows.push({ ...row, brief: designed })
  }
  return { ok: true, rows, undesigned }
}

/**
 * The review of a design already stored on its slot (decision 389), for the
 * side jobs (Redesign, retype) to run in a step after the design's own. It
 * lands only on the design it reviewed: a newer redesign or retype in the
 * meantime wins, and a design already reviewed is left alone, so a retried
 * step never reviews twice.
 */
export async function reviewStoredGraphic(
  projectId: string,
  slotId: string,
  options: { guidance?: string } = {},
): Promise<{ outcome: 'kept' | 'revised' | 'skipped' | 'superseded' }> {
  const slot = await getShotSlot(db, slotId)
  const brief = slot ? designableBrief(slot) : null
  if (!slot || !brief?.code || brief.code.review) return { outcome: 'skipped' }
  const context = await loadGraphicContext(projectId, slot.chapterId)
  const result = await reviewGraphic(
    context,
    { chapterId: slot.chapterId, startMs: slot.startMs, durationMs: slot.durationMs, brief },
    options,
  )
  if (result.outcome === 'skipped') return { outcome: 'skipped' }
  const latest = await getShotSlot(db, slotId)
  const now = latest ? designableBrief(latest) : null
  if (!latest || latest.type !== slot.type || now?.code?.source !== brief.code.source) {
    return { outcome: 'superseded' }
  }
  await updateSlotBrief(db, slotId, withDesign(now, { ok: true, code: result.code }))
  return { outcome: result.outcome }
}
