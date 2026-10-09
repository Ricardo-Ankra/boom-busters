import {
  getProject,
  getShotSlot,
  listLogos,
  retypeShotSlot,
  scriptableClaims,
  setSlotResolution,
  setSlotRetype,
  updateSlotBrief,
} from '@boom-busters/db'
import {
  buildRetypeRequest,
  mockProvidersEnabled,
  mockRetypedBrief,
  parseRetypedBrief,
} from '@boom-busters/providers'
import type { Repair } from '@boom-busters/providers'
import {
  BudgetExceededError,
  convertBrief,
  GraphicBriefSchema,
  parseEventData,
  serialiseError,
  ShotBriefSchema,
  StillRouteSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { designGraphic, loadGraphicContext, withDesign } from '@/lib/graphic-design'
import { callForAnswer, type Answer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { recordRepairs } from '@/lib/notices'
import { requireVisualKeys, resolveSlotBrief } from '@/lib/visual-assets'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markSideJobFailed, slotSubject, type GateContext } from '../lib/gates'

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
    // One re-type per slot at a time; different slots still run in parallel.
    // A double-fired request cancels the one it duplicates, so it is never
    // paid for twice over (decision 233, amended).
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
      // A dead run must not leave the card saying "drafting" forever.
      const slotId = event.data.event.data['slotId']
      if (typeof slotId === 'string') {
        await setSlotRetype(db, slotId, null).catch(() => undefined)
        // A slot retyped to a graphic holds an intent and no design until the
        // designer answers; a dead run must not leave it reading "being
        // designed" forever (decision 289).
        await (async () => {
          const slot = await getShotSlot(db, slotId)
          const brief = GraphicBriefSchema.safeParse(slot?.brief)
          if (!brief.success || brief.data.scene || brief.data.designIssue) return
          await updateSlotBrief(
            db,
            slotId,
            withDesign(brief.data, {
              ok: false,
              issue: 'the design step failed; press Redesign graphic to try again',
            }),
          )
        })().catch(() => undefined)
      }
      // Words, not a stage failure: a re-type runs while the visuals gate is
      // parked open, and the review room must survive it (decision 234).
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-type failed',
        serialiseError(event.data.error),
        slotSubject(slotId),
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

      // Mechanical when the target's fields derive from the description.
      let next: ShotBrief | null = convertBrief(brief, targetType)
      // What the model's draft repaired; a mechanical conversion has none.
      let repairs: Repair[] | undefined

      // Structured targets get a model draft — validated, refusable.
      if (!next) {
        if (targetType !== 'chart' && targetType !== 'map' && targetType !== 'graphic') {
          /**
           * A headline card quotes a claim the OWNER picks, and the board
           * writes that brief itself (decision 257) — no request for one
           * should ever arrive here. One that does is a stale tab, and it
           * gets words on the card rather than a crash, because a thrown
           * error would leave the slot stamped `drafting` for a draft that
           * is never coming.
           */
          const reason =
            targetType === 'headline'
              ? 'A headline card has to quote one of this project’s news claims. Choose the article on the card.'
              : `Re-typing to "${targetType}" is not available.`
          await setSlotRetype(db, slotId, { state: 'refused', target: targetType, reason })
          return { changed: false as const, refused: reason }
        }
        const claims = await scriptableClaims(db, projectId)
        const claimIds = claims.map((claim) => claim.id)
        // The logo library's index (decision 268, Plan B): a graphic drafted
        // here may name a mark the producer already holds.
        const logos = (await listLogos(db)).map((row) => ({ id: row.id, title: row.title ?? '' }))

        let answer: Answer<ShotBrief>
        try {
          if (mockProvidersEnabled()) {
            // The mock refuses as the live parser does (a chart citing no
            // claims), so its refusal lands on the card the same way below.
            answer = {
              ok: true,
              value: mockRetypedBrief({
                brief,
                targetType,
                claimIds,
                claimTexts: claims.map((claim) => claim.text),
                logoTitles: logos.map((logo) => logo.title),
              }),
              calls: 1,
            }
          } else {
            const project = await getProject(db, projectId)
            answer = await callForAnswer({
              request: buildRetypeRequest({
                caseTitle: project?.title ?? 'this case',
                brief,
                targetType,
                claims: claims.map((claim) => ({
                  id: claim.id,
                  text: claim.text,
                  sourceUrl: claim.sourceUrl,
                  confidence: claim.confidence,
                })),
                logos: logos.map((logo) => logo.title),
              }),
              parse: (text, note) => parseRetypedBrief(text, { targetType, claims, logos }, note),
              complete: completeForProject(projectId),
            })
          }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            await setSlotRetype(db, slotId, null)
            return { changed: false as const, gate: budgetGateData(error) }
          }
          if (!(error instanceof ValidationError)) throw error
          answer = { ok: false, issue: error.message, calls: 1 }
        }

        // A refusal after its retry, a decline in the model's own words or the
        // provider's content refusal (decision 293): the slot keeps its old
        // brief and the card shows the reason until it is dismissed.
        if (!answer.ok) {
          await setSlotRetype(db, slotId, {
            state: 'refused',
            target: targetType,
            reason: answer.issue,
          })
          return { changed: false as const, refused: answer.issue }
        }
        next = answer.value
        repairs = answer.repairs
      }

      await retypeShotSlot(db, slotId, targetType, next)
      // The new brief's repairs on this slot's card. Any retype retires the
      // notes the old brief carried (decision 293).
      await recordRepairs({ projectId, subject: 'slot', subjectId: slotId }, repairs)
      // A graphic is not done until it is designed, in the next step: keep
      // the card saying "drafting" until then, so the format picker and
      // Redesign stay locked while the design call is in flight (final
      // review I4). The design step clears it on every outcome.
      if (targetType === 'graphic') {
        await setSlotRetype(db, slotId, { state: 'drafting', target: 'graphic' })
      }
      const project = await getProject(db, projectId)
      return { changed: true as const, resolveNow: project?.visualsPhase === 'board' }
    })

    if ('gate' in converted && converted.gate) {
      await step.run('retype-over-budget', async () => {
        // The card carries the refusal (the same channel a model refusal
        // uses), and the failure stays off the parked stage (decision 234).
        await setSlotRetype(db, slotId, {
          state: 'refused',
          target: targetType,
          reason: String(converted.gate['message'] ?? 'Over budget'),
        })
        await markSideJobFailed(ctx, 'The re-type stopped', converted.gate, slotSubject(slotId))
      })
      return { projectId, slotId, outcome: 'over-budget' as const }
    }
    if ('refused' in converted && converted.refused) {
      return { projectId, slotId, outcome: 'refused' as const, reason: converted.refused }
    }
    if (!converted.changed) {
      return { projectId, slotId, outcome: 'unchanged' as const }
    }

    // A slot retyped to a graphic arrives with an intent and no design
    // (decision 289); the designer composes it in a step of its own.
    if (targetType === 'graphic') {
      const designed = await step.run('design-graphic', async () => {
        const slot = await getShotSlot(db, slotId)
        if (!slot) throw new NonRetriableError(`Shot slot ${slotId} vanished mid-retype`)
        const parsed = GraphicBriefSchema.safeParse(slot.brief)
        if (!parsed.success || slot.type !== 'graphic') {
          throw new NonRetriableError(`Shot slot ${slotId} is no longer a graphic`)
        }
        const brief = parsed.data
        /**
         * The design lands only on a slot that is still a graphic (final
         * review I4). A second retype cancels this run, but a step already
         * in flight still finishes; written blind, its graphic brief would
         * sit on a slot of another type. Then the drafting marker goes, but
         * only this run's: a newer retype's marker is that run's to clear.
         */
        const land = async (designed: Parameters<typeof withDesign>[1]) => {
          const latest = await getShotSlot(db, slotId)
          if (latest?.type !== 'graphic') return
          await updateSlotBrief(db, slotId, withDesign(brief, designed))
          const marker = latest.retype
          if (marker?.['state'] === 'drafting' && marker['target'] === 'graphic') {
            await setSlotRetype(db, slotId, null)
          }
        }
        try {
          const context = await loadGraphicContext(projectId, slot.chapterId)
          const result = await designGraphic(context, {
            chapterId: slot.chapterId,
            startMs: slot.startMs,
            durationMs: slot.durationMs,
            brief,
          })
          await land(result)
          return { ok: true as const }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            const gate = budgetGateData(error)
            // The slot has an intent and no design; say why on the brief, or
            // the card reads "being designed" for good.
            await land({ ok: false, issue: String(gate['message'] ?? 'Over budget') })
            return { ok: false as const, gate }
          }
          throw error
        }
      })
      if (!designed.ok) {
        await step.run('design-over-budget', () =>
          markSideJobFailed(
            ctx,
            'The graphic could not be designed',
            designed.gate,
            slotSubject(slotId),
          ),
        )
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
    }

    // Board phase: the owner is looking at candidate strips — resolve the
    // new brief now. Plan phase stops here; "Fetch visuals" pays later.
    if (converted.resolveNow) {
      const outcome = await step.run('resolve-retyped', async () => {
        const slot = await getShotSlot(db, slotId)
        if (!slot) throw new NonRetriableError(`Shot slot ${slotId} vanished mid-retype`)
        const brief = ShotBriefSchema.parse(slot.brief)
        await requireVisualKeys(new Set([brief.type]))
        const route = StillRouteSchema.nullable().safeParse(slot.route)
        try {
          const resolution = await resolveSlotBrief({
            projectId,
            brief,
            route: route.success ? route.data : null,
          })
          await setSlotResolution(
            db,
            slotId,
            resolution.status === 'resolved'
              ? { ...resolution, answered: { brief: slot.brief, route: slot.route } }
              : resolution,
          )
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
          markSideJobFailed(
            ctx,
            'The re-typed slot could not be resolved',
            outcome.overBudget,
            slotSubject(slotId),
          ),
        )
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
    }

    return { projectId, slotId, outcome: 'retyped' as const, targetType }
  },
)
