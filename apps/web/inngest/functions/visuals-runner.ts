import {
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listShotSlots,
  listVoiceTakes,
  replaceShotList,
  scriptableClaims,
  setProjectStage,
  setSlotResolution,
  setVisualsPhase,
  shotBriefHash,
  shotSlotStatuses,
  slotNeedsResolution,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import {
  buildShotListRequest,
  mockProvidersEnabled,
  mockShotList,
  parseShotList,
  stillStyleAnchors,
} from '@boom-busters/providers'
import type { ScriptClaim } from '@boom-busters/providers'
import {
  BudgetExceededError,
  parseEventData,
  serialiseError,
  ShotBriefSchema,
  visualsCoverage,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { requireVisualKeys, resolveSlotBrief } from '@/lib/visual-assets'
import { inngest } from '../client'
import { events } from '../events'
import {
  budgetGateData,
  closeReviewGate,
  markStageFailed,
  openReviewGate,
  type GateContext,
} from '../lib/gates'
import { chunk, withinFailureTolerance } from '../lib/narration'
import {
  plannedToRows,
  promptParagraphs,
  RESOLUTION_CONCURRENCY,
  timedParagraphs,
} from '../lib/shot-list'

/**
 * visuals-runner (build spec section 7.4; staged-visuals design 2026-08-26).
 *
 * `gate/voice.approved` → shot-list generation per chapter → **PLAN park**
 * (the owner reviews and edits the briefs, re-types slots, nothing fetched,
 * nothing spent) → `visuals/plan.approved` → fan-out asset resolution for
 * the slots the plan still owes → gate 4 on the finished board.
 *
 * Generation is sequential per chapter (one cheap Haiku call each, claim list
 * as the shared cacheable prefix); resolution fans out, because fetching one
 * slot's candidates depends on nothing but its own brief. Every slot is its
 * own step, so a failure in slot forty does not re-fetch — or re-buy, for
 * generated stills — slots one to thirty-nine. Resolution also skips any
 * slot already resolved for its CURRENT brief (`resolvedBriefHash`), so a
 * per-slot pre-fetch during plan review is never bought twice.
 *
 * Both parks are real: the plan because a machine cannot judge whether a
 * still or a chart carries a story beat better, and the board (decision 99's
 * exception-based gating deliberately does not apply) because whether the
 * chosen clip actually fits the sentence is precisely what no metadata check
 * can answer.
 */

const FUNCTION_ID = 'visuals-runner'

export const visualsRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Visual planning',
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
    triggers: [events.voiceApproved],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('gate/voice.approved', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const setup = await step.run('load-narration', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      const sources = await latestScriptParagraphSources(db, projectId)
      if (sources.chapters.length === 0) {
        throw new NonRetriableError(
          'There is no script to plan visuals for. Approve a script and voice first.',
        )
      }

      const takes = await listVoiceTakes(db, projectId)
      const claims = await scriptableClaims(db, projectId)
      const settings = await getSettings(db)

      await setProjectStage(db, projectId, { stage: 'visuals', stageStatus: 'running' })

      return {
        caseTitle: project.title,
        chapters: sources.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
        paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
        claims: claims.map((claim) => ({
          id: claim.id,
          text: claim.text,
          sourceUrl: claim.sourceUrl,
          confidence: claim.confidence,
        })) satisfies ScriptClaim[],
        styleAnchors: stillStyleAnchors(settings.brandKit),
      }
    })

    const mocked = mockProvidersEnabled()
    // The order of this array IS the claim numbering every chapter's prompt
    // uses, and the numbering `plannedToRows` maps back to ids. One list,
    // computed once, so they cannot disagree.
    const claimIds = setup.claims.map((claim) => claim.id)

    // -----------------------------------------------------------------------
    // Shot-list generation, chapter by chapter
    // -----------------------------------------------------------------------

    const allRows: NewShotSlot[] = []
    let rejectedSlots = 0

    for (const [index, chapter] of setup.chapters.entries()) {
      const planned = await step.run(
        `shot-list-${index}`,
        async (): Promise<
          | { ok: true; rows: NewShotSlot[]; rejected: number }
          | { ok: false; gate: Record<string, unknown> }
        > => {
          const paragraphs = promptParagraphs(setup.paragraphs, chapter.id)
          if (paragraphs.length === 0) return { ok: true, rows: [], rejected: 0 }

          let slots
          // Slots the model planned but that could not be used — malformed
          // JSON shapes, charts citing claims that do not exist. Dropped and
          // counted rather than fatal: a gap on the board is repairable from
          // a card, a failed chapter kills the run.
          let dropped = 0
          if (mocked) {
            slots = mockShotList({ paragraphs, claimCount: setup.claims.length }).slots
          } else {
            try {
              const parsed = parseShotList(
                (
                  await callLlm(
                    buildShotListRequest({
                      caseTitle: setup.caseTitle,
                      chapterTitle: chapter.title,
                      paragraphs,
                      claims: setup.claims,
                      styleAnchors: setup.styleAnchors,
                    }),
                    { projectId },
                  )
                ).text,
              )
              slots = parsed.slots
              dropped += parsed.malformed.length
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              throw error
            }
          }

          const conversion = plannedToRows({
            chapterId: chapter.id,
            planned: slots,
            paragraphs: setup.paragraphs,
            claimIds,
          })

          return { ok: true, rows: conversion.rows, rejected: dropped + conversion.rejected.length }
        },
      )

      if (!planned.ok) {
        await step.run(`shot-list-${index}-over-budget`, () => markStageFailed(ctx, planned.gate))
        return { projectId, outcome: 'over-budget' as const }
      }

      allRows.push(...planned.rows)
      rejectedSlots += planned.rejected
    }

    if (allRows.length === 0) {
      await step.run('empty-plan', () =>
        markStageFailed(ctx, {
          message:
            'The shot-list model produced no usable slots. Re-run the visuals stage; if it ' +
            'happens again, the script may be too short to plan against.',
        }),
      )
      return { projectId, outcome: 'failed' as const }
    }

    // -----------------------------------------------------------------------
    // Save the board and park on the PLAN — nothing fetched, nothing spent
    // -----------------------------------------------------------------------

    await step.run('save-shot-list', async () => {
      await replaceShotList(db, projectId, allRows)
      await setVisualsPhase(db, projectId, 'plan')
    })

    const stillCount = allRows.filter((row) => row.type === 'still').length
    await step.run('open-plan-park', () =>
      openReviewGate(ctx, {
        stage: 'visuals',
        projectStage: 'visuals',
        summary:
          `Shot plan ready · ${allRows.length} slots` +
          (stillCount > 0 ? ` · ${stillCount} stills to generate` : '') +
          (rejectedSlots > 0
            ? ` · ${rejectedSlots} planned slots dropped — malformed or citing unknown claims`
            : '') +
          ' · nothing fetched yet — review the plan, then fetch',
      }),
    )

    const planApproval = await step.waitForEvent('await-plan-approval', {
      event: 'visuals/plan.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!planApproval) {
      await step.run('plan-timed-out', () =>
        markStageFailed(ctx, { message: 'The shot plan went 30 days without a decision.' }),
      )
      return { projectId, outcome: 'plan-timeout' as const }
    }

    // -----------------------------------------------------------------------
    // Fetch: only what the plan still owes (the no-waste guard)
    // -----------------------------------------------------------------------

    const board = await step.run('load-plan', async () => {
      await closeReviewGate(ctx, {
        stage: 'visuals',
        nextStage: 'visuals',
        message: 'Shot plan approved — fetching the visuals',
      })

      // Re-read, never reuse the generation-time rows: the whole point of
      // the park is that the briefs changed while the run slept.
      const slots = await listShotSlots(db, projectId)
      const owed = slots.filter((slot) => slotNeedsResolution(slot))

      // Before a single fetch: a plan needing stills with no key to make
      // them must fail here, naming Settings → Connections, not on slot
      // seventeen. Checked against the types the fetch will actually touch.
      await requireVisualKeys(new Set(owed.map((slot) => slot.type)))

      return owed.map((slot) => ({ id: slot.id, brief: slot.brief }))
    })

    // -----------------------------------------------------------------------
    // Resolution, in bounded parallel
    // -----------------------------------------------------------------------

    type SlotOutcome =
      | { ok: true; status: string }
      | { ok: false; gate: Record<string, unknown> }
      | { ok: false; error: string }

    const outcomes: SlotOutcome[] = []

    for (const batch of chunk(board, RESOLUTION_CONCURRENCY)) {
      const results = await Promise.all(
        batch.map((slot) =>
          step.run(`resolve-${slot.id}`, async (): Promise<SlotOutcome> => {
            try {
              const brief = ShotBriefSchema.parse(slot.brief)
              const resolution = await resolveSlotBrief({ projectId, brief })
              await setSlotResolution(db, slot.id, {
                ...resolution,
                // The fingerprint the no-waste guard compares against: this
                // resolution answers THIS brief; an edit changes the hash
                // and the next fetch pass picks the slot up again.
                briefHash: shotBriefHash(slot.brief),
              })
              return { ok: true, status: resolution.status }
            } catch (error) {
              if (error instanceof BudgetExceededError) {
                return { ok: false, gate: budgetGateData(error) }
              }
              /**
               * Swallowed for the same reason the voice fan-out swallows: the
               * tolerance needs per-item outcomes, and one thrown step would
               * take down siblings that succeeded. The slot is marked
               * `placeholder` so the board shows exactly what needs a human.
               */
              await setSlotResolution(db, slot.id, { candidates: [], status: 'placeholder' })
              return { ok: false, error: String(serialiseError(error).message ?? 'unknown') }
            }
          }),
        ),
      )

      outcomes.push(...results)

      // A budget cap hit part-way is not a per-item failure — park now.
      const overBudget = results.find((result) => !result.ok && 'gate' in result)
      if (overBudget && !overBudget.ok && 'gate' in overBudget) {
        await step.run('resolution-over-budget', () => markStageFailed(ctx, overBudget.gate))
        return { projectId, outcome: 'over-budget' as const, resolved: outcomes.length }
      }
    }

    const failed = outcomes.filter((outcome) => !outcome.ok).length

    if (!withinFailureTolerance(failed, outcomes.length)) {
      await step.run('resolution-failed', () =>
        markStageFailed(ctx, {
          message:
            `${failed} of ${outcomes.length} slots could not be resolved, which is over the ` +
            '15% tolerance. Nothing that succeeded was discarded — fix the cause and re-run ' +
            'the visuals stage.',
          failed,
          total: outcomes.length,
        }),
      )
      return { projectId, outcome: 'failed' as const, failed, total: outcomes.length }
    }

    // -----------------------------------------------------------------------
    // Gate 4 — always parked; a board is an aesthetic judgment
    // -----------------------------------------------------------------------

    await step.run('enter-board-phase', () => setVisualsPhase(db, projectId, 'board'))

    const summary = await step.run('finish-board', async () => {
      const coverage = visualsCoverage(await shotSlotStatuses(db, projectId))
      return { ...coverage, rejectedSlots }
    })

    await step.run('open-gate', () =>
      openReviewGate(ctx, {
        stage: 'visuals',
        projectStage: 'visuals',
        summary:
          `Visual board ready · ${summary.slots} slots · ${summary.resolved} resolved` +
          (summary.placeholder > 0 ? ` · ${summary.placeholder} placeholders` : '') +
          (summary.rejectedSlots > 0
            ? ` · ${summary.rejectedSlots} planned slots dropped — malformed or citing unknown claims`
            : ''),
      }),
    )

    const approval = await step.waitForEvent('await-visuals-gate', {
      event: 'gate/visuals.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!approval) {
      await step.run('gate-timed-out', () =>
        markStageFailed(ctx, { message: 'The visuals gate went 30 days without a decision.' }),
      )
      return { projectId, outcome: 'gate-timeout' as const }
    }

    await step.run('close-gate', () =>
      closeReviewGate(ctx, { stage: 'visuals', nextStage: 'assembly' }),
    )

    return { projectId, outcome: 'approved' as const, ...summary }
  },
)
