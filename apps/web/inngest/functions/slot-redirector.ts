import {
  getProject,
  getShotSlot,
  setSlotRefusal,
  setSlotResolution,
  shotBriefHash,
  updateSlotBrief,
} from '@boom-busters/db'
import {
  buildRedirectRequest,
  mockProvidersEnabled,
  mockRedirectedBrief,
  parseRedirectedBrief,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  ContentPolicyError,
  DirectorsBookSchema,
  parseEventData,
  serialiseError,
  StillBriefSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { StillBrief } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { requireVisualKeys, resolveSlotBrief } from '@/lib/visual-assets'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markSideJobFailed, type GateContext } from '../lib/gates'

/**
 * slot-redirector (decision 252). An image model refused a still, usually a
 * likeness. "Redirect the scene" asks the shot-list model for the same beat
 * without the person (the empty chair, the podium after the speech, an
 * anonymous figure), stores the new brief (which clears the refusal), and
 * in board phase resolves it at once. A redirect the model cannot honestly
 * make, or one the image model refuses again, lands back on the row as a
 * refusal in words, never a dead spinner.
 *
 * A separate function, like the slot-retyper: the main run stays parked.
 */

const FUNCTION_ID = 'slot-redirector'

export const slotRedirector = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Slot redirect',
    retries: 2,
    singleton: { key: 'event.data.slotId', mode: 'cancel' },
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The redirect failed',
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsRedirectRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, slotId } = parseEventData('visuals/redirect.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const redirected = await step.run('redirect-brief', async () => {
      const slot = await getShotSlot(db, slotId)
      if (!slot) throw new NonRetriableError(`Shot slot ${slotId} no longer exists`)
      const brief = StillBriefSchema.safeParse(slot.brief)
      if (!brief.success) {
        throw new NonRetriableError('Only an AI image slot can be redirected.')
      }
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      const book = DirectorsBookSchema.safeParse(project.direction)
      const reason = String(
        (slot.refusal as { reason?: unknown } | null)?.reason ?? 'the image model declined it',
      )

      let next: StillBrief
      try {
        next = mockProvidersEnabled()
          ? mockRedirectedBrief(brief.data)
          : parseRedirectedBrief(
              (
                await callLlm(
                  buildRedirectRequest({
                    caseTitle: project.title,
                    brief: brief.data,
                    reason,
                    direction: book.success ? book.data : null,
                  }),
                  { projectId },
                )
              ).text,
              brief.data,
            )
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        if (error instanceof ValidationError) {
          await setSlotRefusal(db, slotId, {
            reason: `Redirect refused: ${error.message}`,
            at: new Date().toISOString(),
          })
          return { ok: false as const, refused: error.message }
        }
        throw error
      }

      // The brief write clears the refusal: the refused prompt no longer exists.
      await updateSlotBrief(db, slotId, next)
      return { ok: true as const, resolveNow: project.visualsPhase === 'board' }
    })

    if (!redirected.ok) {
      if ('gate' in redirected) {
        await step.run('redirect-over-budget', () =>
          markSideJobFailed(ctx, 'The redirect stopped', redirected.gate),
        )
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
      return { projectId, slotId, outcome: 'refused' as const, reason: redirected.refused }
    }

    // Board phase: the owner is looking at candidate strips; resolve now.
    // Plan phase stops here, and "Fetch visuals" pays later.
    if (redirected.resolveNow) {
      const outcome = await step.run('resolve-redirected', async () => {
        const slot = await getShotSlot(db, slotId)
        if (!slot) throw new NonRetriableError(`Shot slot ${slotId} vanished mid-redirect`)
        const brief = StillBriefSchema.parse(slot.brief)
        await requireVisualKeys(new Set([brief.type]))
        try {
          const resolution = await resolveSlotBrief({ projectId, brief })
          await setSlotResolution(db, slotId, {
            ...resolution,
            briefHash: shotBriefHash(slot.brief),
          })
          return { status: resolution.status }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { overBudget: budgetGateData(error) }
          }
          if (error instanceof ContentPolicyError) {
            await setSlotResolution(db, slotId, { candidates: [], status: 'placeholder' })
            await setSlotRefusal(db, slotId, {
              reason: error.message,
              at: new Date().toISOString(),
            })
            return { refusedAgain: error.message }
          }
          throw error
        }
      })

      if ('overBudget' in outcome && outcome.overBudget) {
        await step.run('resolve-over-budget', () =>
          markSideJobFailed(ctx, 'The redirected slot could not be resolved', outcome.overBudget),
        )
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
      if ('refusedAgain' in outcome && outcome.refusedAgain) {
        return { projectId, slotId, outcome: 'refused' as const, reason: outcome.refusedAgain }
      }
    }

    return { projectId, slotId, outcome: 'redirected' as const }
  },
)
