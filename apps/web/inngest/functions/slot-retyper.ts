import {
  getProject,
  getSettings,
  getShotSlot,
  retypeShotSlot,
  scriptableClaims,
  setSlotResolution,
  setSlotRetype,
  shotBriefHash,
} from '@boom-busters/db'
import {
  buildRetypeRequest,
  mockProvidersEnabled,
  mockRetypedBrief,
  parseRetypedBrief,
  stillStyleAnchors,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  convertBrief,
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
import { budgetGateData, markStageFailed, type GateContext } from '../lib/gates'

/**
 * slot-retyper (staged-visuals design, 2026-08-26).
 *
 * `visuals/retype.requested {slotId, targetType}` — the board's format
 * picker. The suggested type is a suggestion, not a lock: a still becomes a
 * stock search, a stock shot becomes a map.
 *
 * Text-driven targets (stock/archival/still) convert mechanically through
 * `convertBrief`; chart and map need structured data no template can supply,
 * so one small call on the shot-list model drafts it, and the schema
 * validates the draft (a chart may never cite nothing — the anti-slop rule
 * survives re-typing). Either way the slot returns to `unresolved` with its
 * old candidates cleared: they were fetched for a different kind of shot.
 *
 * In `board` phase the new brief resolves immediately (the owner is looking
 * at candidates and expects new ones); in `plan` phase it stops at the brief
 * — nothing is fetched until "Fetch visuals".
 *
 * A separate function rather than a wait in the runner, for the reason the
 * slot-refetcher is: the main run stays parked throughout.
 */

const FUNCTION_ID = 'slot-retyper'

export const slotRetyper = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Slot re-type',
    retries: 2,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      // A dead run must not leave the card saying "drafting" forever.
      const slotId = event.data.event.data['slotId']
      if (typeof slotId === 'string') {
        await setSlotRetype(db, slotId, null).catch(() => undefined)
      }
      await markStageFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsRetypeRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, slotId, targetType } = parseEventData('visuals/retype.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const converted = await step.run('convert-brief', async () => {
      const slot = await getShotSlot(db, slotId)
      if (!slot) throw new NonRetriableError(`Shot slot ${slotId} no longer exists`)

      const brief = ShotBriefSchema.parse(slot.brief)
      if (brief.type === targetType) {
        // Nothing to do — but the action stamped `drafting` before sending,
        // and a no-op must not leave that on the card.
        await setSlotRetype(db, slotId, null)
        return { changed: false as const }
      }

      const settings = await getSettings(db)

      // Mechanical when the target's fields derive from the description.
      let next: ShotBrief | null = convertBrief(brief, targetType, {
        stillStyleAnchors: stillStyleAnchors(settings.brandKit),
      })

      // Structured targets get a model draft — validated, refusable.
      if (!next) {
        if (targetType !== 'chart' && targetType !== 'map') {
          throw new NonRetriableError(`Re-typing to "${targetType}" is not available.`)
        }
        const claims = await scriptableClaims(db, projectId)
        const claimIds = claims.map((claim) => claim.id)

        try {
          if (mockProvidersEnabled()) {
            // The mock refuses the same way the real path does — a chart
            // citing no claims — so it must sit under the same catch.
            next = mockRetypedBrief({ brief, targetType, claimIds })
          } else {
            const project = await getProject(db, projectId)
            next = parseRetypedBrief(
              (
                await callLlm(
                  buildRetypeRequest({
                    caseTitle: project?.title ?? 'this case',
                    brief,
                    targetType,
                    claims: claims.map((claim) => ({
                      id: claim.id,
                      text: claim.text,
                      sourceUrl: claim.sourceUrl,
                      confidence: claim.confidence,
                    })),
                  }),
                  { projectId },
                )
              ).text,
              { targetType, claimIds },
            )
          }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            await setSlotRetype(db, slotId, null)
            return { changed: false as const, gate: budgetGateData(error) }
          }
          // A refusal or a malformed draft is an answer, not a crash: the
          // slot keeps its old brief and the card shows the reason until
          // it is dismissed.
          if (error instanceof ValidationError) {
            await setSlotRetype(db, slotId, {
              state: 'refused',
              target: targetType,
              reason: error.message,
            })
            return { changed: false as const, refused: error.message }
          }
          throw error
        }
      }

      await retypeShotSlot(db, slotId, targetType, next)
      const project = await getProject(db, projectId)
      return { changed: true as const, resolveNow: project?.visualsPhase === 'board' }
    })

    if ('gate' in converted && converted.gate) {
      await step.run('retype-over-budget', () => markStageFailed(ctx, converted.gate))
      return { projectId, slotId, outcome: 'over-budget' as const }
    }
    if ('refused' in converted && converted.refused) {
      return { projectId, slotId, outcome: 'refused' as const, reason: converted.refused }
    }
    if (!converted.changed) {
      return { projectId, slotId, outcome: 'unchanged' as const }
    }

    // Board phase: the owner is looking at candidate strips — resolve the
    // new brief now. Plan phase stops here; "Fetch visuals" pays later.
    if (converted.resolveNow) {
      const outcome = await step.run('resolve-retyped', async () => {
        const slot = await getShotSlot(db, slotId)
        if (!slot) throw new NonRetriableError(`Shot slot ${slotId} vanished mid-retype`)
        const brief = ShotBriefSchema.parse(slot.brief)
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
          throw error
        }
      })

      if ('overBudget' in outcome && outcome.overBudget) {
        await step.run('resolve-over-budget', () => markStageFailed(ctx, outcome.overBudget))
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
    }

    return { projectId, slotId, outcome: 'retyped' as const, targetType }
  },
)
