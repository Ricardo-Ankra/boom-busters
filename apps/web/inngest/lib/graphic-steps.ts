import type { NewShotSlot } from '@boom-busters/db'
import { BudgetExceededError, ChartBriefSchema, GraphicBriefSchema } from '@boom-busters/schemas'
import type { DesignableBrief } from '@boom-busters/schemas'
import { designGraphic, withDesign, type GraphicDesignContext } from '@/lib/graphic-design'
import { budgetGateData } from './gates'

/** `step.run`, as the helper needs it; the runners pass `(id, fn) => step.run(id, fn)`. */
export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>

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
 */
export async function designPlannedGraphics(
  run: StepRunner,
  input: {
    prefix: string
    rows: readonly NewShotSlot[]
    context: Omit<GraphicDesignContext, 'chapterTitle'>
    chapterTitle: string
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
    const outcome = await run(id, async () => {
      try {
        const result = await designGraphic(
          { ...input.context, chapterTitle: input.chapterTitle },
          {
            chapterId: row.chapterId,
            startMs: row.startMs,
            durationMs: row.durationMs,
            brief,
          },
        )
        return { ok: true as const, brief: withDesign(brief, result) }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        throw error
      }
    })
    if (!outcome.ok) return { ok: false, gate: outcome.gate }
    if (outcome.brief.designIssue !== undefined) undesigned += 1
    rows.push({ ...row, brief: outcome.brief })
  }
  return { ok: true, rows, undesigned }
}
