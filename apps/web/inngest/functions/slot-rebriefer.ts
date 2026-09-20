import {
  getProject,
  getShotSlot,
  scriptableClaims,
  setSlotResolution,
  setSlotRetype,
  updateSlotBrief,
} from '@boom-busters/db'
import {
  buildRebriefRequest,
  buildRetypeRequest,
  mockProvidersEnabled,
  mockRebriefedBrief,
  mockRetypedBrief,
  parseRebriefedBrief,
  parseRetypedBrief,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  DirectorsBookSchema,
  parseEventData,
  serialiseError,
  ShotBriefSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { requireVisualKeys, resolveSlotBrief } from '@/lib/visual-assets'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markSideJobFailed, type GateContext } from '../lib/gates'

/**
 * slot-rebriefer (decision 258). "Draft a different brief": the owner has
 * rejected this slot's idea and wants another, optionally saying what they are
 * picturing.
 *
 * The gap it fills: the board could edit a brief by hand or re-plan every slot
 * in the film, with nothing in between. Re-typing is not the same question —
 * that changes what KIND of shot this is, and the format picker owns it.
 *
 * Two prompt paths, one button, because two kinds of brief exist:
 *
 * - stock, real footage and AI image briefs are ideas, so `buildRebriefRequest`
 *   asks for another one under the same Director's Book craft rules.
 * - chart and map briefs are data, so they go back through the re-type drafting
 *   path with the target set to the type they already have. That is not a
 *   shortcut: it is how the claim-number validation stays exactly where it is,
 *   and a redrawn chart still cannot cite numbers the dossier does not hold.
 *
 * A headline card never comes here at all. Every string on it is read from the
 * article, so there is no idea to have again; changing which article it quotes
 * is the chooser's job (decision 257).
 *
 * A separate function, like the slot-retyper and the slot-redirector: the main
 * run stays parked throughout.
 */

const FUNCTION_ID = 'slot-rebriefer'

export const slotRebriefer = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Slot re-brief',
    retries: 2,
    // One re-brief per slot at a time; a double-fired request cancels the one
    // it duplicates, so it is never paid for twice over.
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
      // A dead run must not leave the card saying it is drafting forever.
      const slotId = event.data.event.data['slotId']
      if (typeof slotId === 'string') {
        await setSlotRetype(db, slotId, null).catch(() => undefined)
      }
      // Words, not a stage failure: this runs while the visuals gate is parked
      // open, and the review room must survive it (decision 234).
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-brief failed',
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsRebriefRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, slotId, guidance } = parseEventData('visuals/rebrief.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const drafted = await step.run('draft-brief', async () => {
      const slot = await getShotSlot(db, slotId)
      if (!slot) throw new NonRetriableError(`Shot slot ${slotId} no longer exists`)

      const current = ShotBriefSchema.safeParse(slot.brief)
      if (!current.success) {
        throw new NonRetriableError('This brief no longer matches its schema.')
      }
      const brief = current.data

      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      /**
       * Refused in words rather than thrown. The board does not offer the
       * button on these, so a request for one is a stale tab, and a throw
       * would leave the card drafting something that is never coming.
       */
      if (brief.type === 'headline' || brief.type === 'hero') {
        const reason =
          brief.type === 'headline'
            ? 'Every word on a headline card is read from the article, so there is no brief to draft. Change which article it quotes instead.'
            : 'An AI-video slot cannot be re-briefed.'
        await setSlotRetype(db, slotId, { state: 'rebrief-refused', reason })
        return { ok: false as const, refused: reason }
      }

      let next: ShotBrief
      try {
        if (brief.type === 'chart' || brief.type === 'map') {
          const claims = await scriptableClaims(db, projectId)
          next = mockProvidersEnabled()
            ? mockRetypedBrief({
                brief,
                targetType: brief.type,
                claimIds: claims.map((claim) => claim.id),
                ...(guidance === undefined ? {} : { guidance }),
              })
            : parseRetypedBrief(
                (
                  await callLlm(
                    buildRetypeRequest({
                      caseTitle: project.title,
                      brief,
                      targetType: brief.type,
                      claims: claims.map((claim) => ({
                        id: claim.id,
                        text: claim.text,
                        sourceUrl: claim.sourceUrl,
                        confidence: claim.confidence,
                      })),
                      ...(guidance === undefined ? {} : { guidance }),
                    }),
                    { projectId },
                  )
                ).text,
                { targetType: brief.type, claims },
              )
        } else {
          const book = DirectorsBookSchema.safeParse(project.direction)
          next = mockProvidersEnabled()
            ? mockRebriefedBrief(brief, guidance)
            : parseRebriefedBrief(
                (
                  await callLlm(
                    buildRebriefRequest({
                      caseTitle: project.title,
                      brief,
                      ...(guidance === undefined ? {} : { guidance }),
                      direction: book.success ? book.data : null,
                    }),
                    { projectId },
                  )
                ).text,
                brief,
              )
        }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        // A refusal or a malformed draft is an answer, not a crash: the slot
        // keeps the brief it has and the card shows why, until it is dismissed.
        if (error instanceof ValidationError) {
          await setSlotRetype(db, slotId, { state: 'rebrief-refused', reason: error.message })
          return { ok: false as const, refused: error.message }
        }
        throw error
      }

      await updateSlotBrief(db, slotId, next)
      // `updateSlotBrief` clears a refusal but not this, and the pending state
      // has to end on the write that answers it.
      await setSlotRetype(db, slotId, null)
      return { ok: true as const, resolveNow: project.visualsPhase === 'board' }
    })

    if (!drafted.ok) {
      if ('gate' in drafted && drafted.gate) {
        await step.run('rebrief-over-budget', async () => {
          // The card carries it the same way a model refusal does, and the
          // failure stays off the parked stage (decision 234).
          await setSlotRetype(db, slotId, {
            state: 'rebrief-refused',
            reason: String(drafted.gate['message'] ?? 'Over budget'),
          })
          await markSideJobFailed(ctx, 'The re-brief stopped', drafted.gate)
        })
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
      return {
        projectId,
        slotId,
        outcome: 'refused' as const,
        reason: 'refused' in drafted ? drafted.refused : undefined,
      }
    }

    // Board phase: the owner is looking at candidate strips, so fetch for the
    // new brief now. Plan phase stops at the brief; "Fetch visuals" pays later.
    if (drafted.resolveNow) {
      const outcome = await step.run('resolve-rebriefed', async () => {
        const slot = await getShotSlot(db, slotId)
        if (!slot) throw new NonRetriableError(`Shot slot ${slotId} vanished mid-re-brief`)
        const brief = ShotBriefSchema.parse(slot.brief)
        await requireVisualKeys(new Set([brief.type]))
        try {
          const resolution = await resolveSlotBrief({ projectId, brief })
          await setSlotResolution(db, slotId, {
            ...resolution,
          })
          return { status: resolution.status }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { overBudget: budgetGateData(error) }
          }
          throw error
        }
      })

      if ('overBudget' in outcome && outcome.overBudget) {
        await step.run('resolve-over-budget', () =>
          markSideJobFailed(ctx, 'The re-briefed slot could not be resolved', outcome.overBudget),
        )
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
    }

    return { projectId, slotId, outcome: 'rebriefed' as const }
  },
)
