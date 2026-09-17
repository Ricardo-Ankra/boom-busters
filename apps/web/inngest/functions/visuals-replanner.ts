import {
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listVoiceTakes,
  replaceShotList,
  scriptableClaims,
  listCastMembers,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import { BANNED_PROMPT_WORDS, stillStyleAnchors } from '@boom-busters/providers'
import type { ScriptClaim } from '@boom-busters/providers'
import {
  BudgetExceededError,
  DirectorsBookSchema,
  parseEventData,
  planWarnings,
  serialiseError,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { inngest } from '../client'
import { events } from '../events'
import { draftDirectorsBook, planChapterSlots } from '../lib/direction'
import { budgetGateData, markSideJobFailed, type GateContext } from '../lib/gates'
import { timedParagraphs } from '../lib/shot-list'

/**
 * visuals-replanner (decision 252). The plan screen's two model-backed
 * buttons: Redraft direction (replaces the book; the owner's edits go) and
 * Re-plan shot list (replaces every slot from the stored book; anything
 * pre-fetched during plan review is discarded). Both run only while the
 * project sits at the plan checkpoint, and the parked visuals-runner is
 * untouched: it re-reads the slots when the plan is approved, exactly as the
 * staged-visuals design already requires.
 *
 * A separate function rather than a wait in the runner, for the reason the
 * slot-retyper is: the main run stays parked throughout.
 */

const FUNCTION_ID = 'visuals-replanner'

export const visualsReplanner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Visual re-plan',
    retries: 2,
    // One re-plan per project at a time; a double click cancels the re-plan
    // it duplicates, so it is never paid for twice (decision 233, amended).
    singleton: { key: 'event.data.projectId', mode: 'cancel' },
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const projectId = event.data.event.data['projectId']
      if (typeof projectId !== 'string') return
      // Words, not a stage failure: the plan park stays open (decision 234).
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The re-plan failed',
        serialiseError(event.data.error),
      )
    },
    triggers: [events.visualsReplanRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, op } = parseEventData('visuals/replan.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const inPlan = await step.run('check-phase', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      return project.visualsPhase === 'plan'
    })
    if (!inPlan) return { projectId, op, outcome: 'not-in-plan' as const }

    // -----------------------------------------------------------------------
    // Redraft the book, and nothing else
    // -----------------------------------------------------------------------

    if (op === 'direction') {
      const drafted = await step.run('redraft-book', async () => {
        try {
          await draftDirectorsBook(projectId)
          return { ok: true as const }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      })
      if (!drafted.ok) {
        await step.run('redraft-over-budget', () =>
          markSideJobFailed(ctx, 'The redraft stopped', drafted.gate),
        )
        return { projectId, op, outcome: 'over-budget' as const }
      }
      return { projectId, op, outcome: 'redrafted' as const }
    }

    // -----------------------------------------------------------------------
    // Re-plan every chapter from the stored book
    // -----------------------------------------------------------------------

    const setup = await step.run('load-plan-inputs', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
      const book = DirectorsBookSchema.safeParse(project.direction)
      const sources = await latestScriptParagraphSources(db, projectId)
      const takes = await listVoiceTakes(db, projectId)
      const claims = await scriptableClaims(db, projectId)
      const settings = await getSettings(db)
      return {
        caseTitle: project.title,
        direction: book.success ? book.data : null,
        chapters: sources.chapters.map((chapter) => ({ id: chapter.id, title: chapter.title })),
        paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
        claims: claims.map((claim) => ({
          id: claim.id,
          text: claim.text,
          sourceUrl: claim.sourceUrl,
          confidence: claim.confidence,
        })) satisfies ScriptClaim[],
        styleAnchors: stillStyleAnchors(settings.brandKit),
        // Who the producer has photographed (decision 253, amended). Their
        // prompts name them and carry no physical description, because the
        // photograph is the likeness.
        photographed: (await listCastMembers(db, projectId))
          .filter((member) => member.photos.length > 0)
          .map((member) => member.name),
      }
    })
    const claimIds = setup.claims.map((claim) => claim.id)

    const rows: NewShotSlot[] = []
    let rejected = 0
    for (const [index, chapter] of setup.chapters.entries()) {
      const planned = await step.run(`replan-${index}`, async () => {
        try {
          const result = await planChapterSlots({
            projectId,
            caseTitle: setup.caseTitle,
            chapter: { id: chapter.id, title: chapter.title, number: index + 1 },
            paragraphs: setup.paragraphs,
            claims: setup.claims,
            claimIds,
            styleAnchors: setup.styleAnchors,
            direction: setup.direction,
            photographed: setup.photographed,
          })
          return { ok: true as const, ...result }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      })
      if (!planned.ok) {
        await step.run(`replan-${index}-over-budget`, () =>
          markSideJobFailed(ctx, 'The re-plan stopped', planned.gate),
        )
        return { projectId, op, outcome: 'over-budget' as const }
      }
      rows.push(...planned.rows)
      rejected += planned.rejected
    }

    if (rows.length === 0) {
      await step.run('replan-empty', () =>
        markSideJobFailed(ctx, 'The re-plan produced no slots', {
          message: 'The shot-list model produced no usable slots; the old plan was kept.',
        }),
      )
      return { projectId, op, outcome: 'empty' as const }
    }

    await step.run('replace-plan', async () => {
      await replaceShotList(db, projectId, rows)
      const warnings = planWarnings(
        rows.map((row) => ({ brief: row.brief })),
        BANNED_PROMPT_WORDS,
      )
      await notify({
        kind: 'heads-up',
        title: 'Shot plan re-planned',
        body:
          `${rows.length} slots planned from the saved direction` +
          (rejected > 0 ? `, ${rejected} dropped as malformed` : '') +
          (warnings.length > 0 ? `, ${warnings.length} craft notes` : '') +
          '.',
        href: `/projects/${projectId}`,
      })
    })

    return { projectId, op, outcome: 'replanned' as const, slots: rows.length }
  },
)
