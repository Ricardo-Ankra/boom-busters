import type { Database, RenderRow } from '@boom-busters/db'
import { settle, unsettledRenderLedgerId } from '@boom-busters/cost'
import { RenderPartsSchema, settleRenderParts } from '@boom-busters/schemas'

/**
 * Close the reservation of a film rendered in parts that ended without its own
 * settle step (a Stop, or the run dying). An unsettled ledger row counts at the
 * full estimate against the monthly ceiling, so left open it overstates the
 * spend by every part that never ran. Parts still rendering count at their
 * share: they ran on the broker and are paid for.
 *
 * A single render (no parts) keeps its old behaviour and is left alone, as is
 * a row whose reservation has settled already. Returns whether it settled one.
 */
export async function settleRenderLedger(db: Database, render: RenderRow): Promise<boolean> {
  if (!render.parts) return false
  const parts = RenderPartsSchema.parse(render.parts)
  const totalFrames = parts.reduce(
    (sum, part) => sum + (part.frameRange[1] - part.frameRange[0] + 1),
    0,
  )
  const estimate = Number(render.costUsd)
  if (!Number.isFinite(estimate) || totalFrames <= 0) return false
  const ledgerId = await unsettledRenderLedgerId(db, 'render-master', render.id)
  if (!ledgerId) return false
  await settle(
    db,
    ledgerId,
    settleRenderParts(parts, estimate, totalFrames, { countRendering: true }),
  )
  return true
}
