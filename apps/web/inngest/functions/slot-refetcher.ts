import { getShotSlot, setSlotResolution } from '@boom-busters/db'
import {
  BudgetExceededError,
  parseEventData,
  serialiseError,
  ShotBriefSchema,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { requireVisualKeys, resolveSlotBrief } from '@/lib/visual-assets'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markStageFailed, type GateContext } from '../lib/gates'

/**
 * slot-refetcher (build spec section 11.3, Visual board).
 *
 * `Edit brief & re-fetch` and `Regenerate` both land here as
 * `visuals/refetch.requested {slotId, note}` — one function, one resolution
 * path (`resolveSlotBrief`, shared with the runner's fan-out), so a re-fetch
 * can never behave differently from the pass that made the board.
 *
 * A separate function rather than a wait in the runner, for the reason
 * `voice-retaker` is (decision 27): the main run stays parked on the gate
 * throughout and never learns this happened — the gate re-reads the slot
 * statuses when the human finally approves.
 */

const FUNCTION_ID = 'slot-refetcher'

export const slotRefetcher = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Slot re-fetch',
    retries: 4,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await markStageFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsRefetchRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, slotId } = parseEventData('visuals/refetch.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const outcome = await step.run('refetch-slot', async () => {
      const slot = await getShotSlot(db, slotId)
      if (!slot) throw new NonRetriableError(`Shot slot ${slotId} no longer exists`)

      // Re-parsed rather than trusted: the brief was validated on write, but
      // this is the boundary where jsonb becomes typed again.
      const brief = ShotBriefSchema.parse(slot.brief)
      await requireVisualKeys(new Set([brief.type]))

      try {
        const resolution = await resolveSlotBrief({ projectId, brief })
        await setSlotResolution(db, slotId, resolution)
        return { status: resolution.status, candidates: resolution.candidates.length }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { overBudget: budgetGateData(error) }
        }
        throw error
      }
    })

    if ('overBudget' in outcome && outcome.overBudget) {
      await step.run('refetch-over-budget', () => markStageFailed(ctx, outcome.overBudget))
      return { projectId, slotId, outcome: 'over-budget' as const }
    }

    return { projectId, slotId, outcome: 'refetched' as const, ...outcome }
  },
)
