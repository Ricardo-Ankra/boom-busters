import type { NewShotSlot } from '@boom-busters/db'
import { BudgetExceededError, GraphicBriefSchema } from '@boom-busters/schemas'
import { designGraphic, withDesign, type GraphicDesignContext } from '@/lib/graphic-design'
import { budgetGateData } from './gates'

/** `step.run`, as the helper needs it; the runners pass `(id, fn) => step.run(id, fn)`. */
export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>

/**
 * Each planned graphic designed in its own step (decision 289), so an
 * Inngest retry repeats one graphic and never the chapter. A graphic the
 * designer could not compose keeps its intent and says why; it is never
 * dropped and never stops the plan. Running out of budget stops it.
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
  let n = 0
  for (const row of input.rows) {
    const brief = GraphicBriefSchema.safeParse(row.brief)
    if (row.type !== 'graphic' || !brief.success || brief.data.scene) {
      rows.push(row)
      continue
    }
    const outcome = await run(`${input.prefix}-${n}`, async () => {
      try {
        const result = await designGraphic(
          { ...input.context, chapterTitle: input.chapterTitle },
          {
            chapterId: row.chapterId,
            startMs: row.startMs,
            durationMs: row.durationMs,
            brief: brief.data,
          },
        )
        return { ok: true as const, brief: withDesign(brief.data, result) }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        throw error
      }
    })
    n += 1
    if (!outcome.ok) return { ok: false, gate: outcome.gate }
    if (!outcome.brief.scene) undesigned += 1
    rows.push({ ...row, brief: outcome.brief })
  }
  return { ok: true, rows, undesigned }
}
