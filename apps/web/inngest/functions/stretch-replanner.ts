import {
  getProject,
  listShotSlots,
  releaseSlotJob,
  replaceStretch,
  setSlotJob,
} from '@boom-busters/db'
import { mockProvidersEnabled, mockStretchPlan } from '@boom-busters/providers'
import {
  BudgetExceededError,
  newId,
  parseEventData,
  serialiseError,
} from '@boom-busters/schemas'
import type { SlotJob } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { notify } from '@/lib/notify'
import type { CompleteFn } from '@/lib/plan-shared'
import { planStretchWith } from '@/lib/plan-stretch'
import { inngest } from '../client'
import { events } from '../events'
import { budgetGateData, markSideJobFailed, slotSubject, type GateContext } from '../lib/gates'
import { designPlannedGraphics } from '../lib/graphic-steps'
import { releaseFailedStretchJob } from '../lib/jobs'
import { loadPlanInputs } from '../lib/plan-inputs'
import { cutStretch } from '../lib/stretch'
import { anchoredChapterRows } from '../lib/stretch-rows'

/**
 * stretch-replanner (the stretch re-plan design, 3.3). Re-plans a run of
 * neighbouring shots the owner selected in one chapter, on the plan screen or
 * on the board, and replaces only those rows. Everything outside the stretch
 * stays exactly as it was.
 *
 * Its own function rather than an op on the visuals-replanner: two stretches
 * may be re-planned at once, so it cannot share that function's per-project
 * singleton, which cancels the duplicate. Instead one chapter's stretches
 * queue behind each other (concurrency 1 per chapter, never cancelled), so a
 * second stretch is cut from the rows the first one wrote.
 *
 * Any stop (closed stage, refused selection, budget, an answer refused twice,
 * a stamp Stop took first) keeps the old shots, and the words land on the
 * first selected card.
 */

const FUNCTION_ID = 'stretch-replanner'
const STOPPED = 'The stretch re-plan stopped'

/** A stopped re-plan as the first selected card says it. */
export function shotsKept(issue: string): string {
  return `${issue}. The shots you had are kept.`
}

/** The write's own refusal: a selected row gone, moved or no longer stamped by this job. */
function isStampRefusal(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('replaceStretch:')
}

export const stretchReplanner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Stretch re-plan',
    retries: 2,
    // One stretch per chapter at a time, queued rather than cancelled: the
    // second waits and is cut from the rows the first one wrote.
    concurrency: [{ key: 'event.data.chapterId', limit: 1 }],
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      const data = event.data.event.data
      await releaseFailedStretchJob(data)
      const projectId = data['projectId']
      if (typeof projectId !== 'string') return
      const slotIds = data['slotIds']
      // Words, not a stage failure: the board stays open (decision 234).
      await markSideJobFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        'The stretch re-plan failed',
        serialiseError(event.data.error),
        slotSubject(Array.isArray(slotIds) ? slotIds[0] : undefined),
      )
    },
    triggers: [events.visualsStretchRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, chapterId, slotIds, note, jobId } = parseEventData(
      'visuals/stretch.requested',
      event.data,
    )
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }
    const subject = slotSubject(slotIds[0])
    const removeIds = [...new Set(slotIds)]

    const result = await (async () => {
      const phase = await step.run('check-phase', async () => {
        const project = await getProject(db, projectId)
        if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
        return project.visualsPhase
      })
      if (phase !== 'plan' && phase !== 'board') {
        return { projectId, chapterId, outcome: 'not-open' as const }
      }

      const setup = await step.run('load-plan-inputs', () => loadPlanInputs(projectId))

      // The chapter's rows on the clock the board shows: anchored over the
      // whole film, exactly as the board anchors them, then cut.
      const cut = await step.run('cut', async () => {
        const all = await listShotSlots(db, projectId)
        const chapterRows = anchoredChapterRows(all, chapterId, setup.paragraphs)
        const outcome = cutStretch({
          chapterRows,
          selectedIds: slotIds,
          paragraphs: setup.paragraphs,
        })
        if (!outcome.ok) return outcome
        const selected = new Set(slotIds)
        return {
          ok: true as const,
          stretch: outcome.stretch,
          before: outcome.before?.brief ?? null,
          after: outcome.after?.brief ?? null,
          // A chapter keeps one news headline: the stretch may plan one only
          // when no shot it leaves standing is a headline.
          headlineAllowed: !chapterRows.some(
            (row) => !selected.has(row.id) && row.type === 'headline',
          ),
          startIndex: chapterRows.find((row) => selected.has(row.id))!.index,
        }
      })
      if (!cut.ok) {
        await step.run('refused', () =>
          markSideJobFailed(ctx, STOPPED, { message: cut.refused }, subject),
        )
        return { projectId, chapterId, outcome: 'refused' as const }
      }

      const chapterAt = setup.chapters.findIndex((chapter) => chapter.id === chapterId)
      const chapterTitle = setup.chapters[chapterAt]?.title ?? ''

      const planned = await step.run('plan', async () => {
        // Mock mode answers with the mock stretch plan, through the same
        // parse and checks a model's answer goes through; the brief repair
        // gets an empty answer and keeps the slots.
        const complete: CompleteFn = mockProvidersEnabled()
          ? (_request, purpose) =>
              Promise.resolve({
                text:
                  purpose === 'repair'
                    ? '{"briefs": []}'
                    : JSON.stringify(mockStretchPlan({ pieces: cut.stretch.pieces })),
              })
          : (request, purpose) =>
              callLlm(request, {
                projectId,
                ...(purpose === 'plan' || purpose === 'repair' ? {} : { purpose }),
              })
        try {
          return await planStretchWith(complete, {
            caseTitle: setup.caseTitle,
            chapter: { id: chapterId, title: chapterTitle, number: chapterAt + 1 },
            paragraphs: setup.paragraphs,
            claims: setup.claims,
            direction: setup.direction,
            photographed: setup.photographed,
            sets: setup.sets,
            logos: setup.logos,
            stretch: cut.stretch,
            before: cut.before,
            after: cut.after,
            headlineAllowed: cut.headlineAllowed,
            startIndex: cut.startIndex,
            ...(note ? { note } : {}),
          })
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      })
      if (!planned.ok && 'gate' in planned) {
        await step.run('over-budget', () => markSideJobFailed(ctx, STOPPED, planned.gate, subject))
        return { projectId, chapterId, outcome: 'over-budget' as const }
      }
      if (!planned.ok) {
        await step.run('stopped', () =>
          markSideJobFailed(ctx, STOPPED, { message: shotsKept(planned.issue) }, subject),
        )
        return { projectId, chapterId, outcome: 'stopped' as const }
      }

      // Each graphic gets a designer of its own (decision 289), one step each.
      const designed = await designPlannedGraphics((id, fn) => step.run(id, fn) as never, {
        prefix: 'stretch-graphic',
        rows: planned.rows,
        context: {
          projectId,
          caseTitle: setup.caseTitle,
          claims: setup.claims,
          logos: setup.logos,
          paragraphs: setup.paragraphs,
        },
        chapterTitle,
      })
      if (!designed.ok) {
        await step.run('graphic-over-budget', () =>
          markSideJobFailed(ctx, STOPPED, designed.gate, subject),
        )
        return { projectId, chapterId, outcome: 'over-budget' as const }
      }

      const written = await step.run('write', async () => {
        try {
          const ids = await replaceStretch(db, {
            projectId,
            chapterId,
            removeIds,
            rows: designed.rows,
            jobId,
          })
          return { ok: true as const, ids }
        } catch (error) {
          // Stop was pressed, or the stamp went stale and another job took
          // the shots: theirs to say, so this ends without words.
          if (isStampRefusal(error)) return { ok: false as const }
          throw error
        }
      })
      if (!written.ok) return { projectId, chapterId, outcome: 'superseded' as const }

      // On the board, each new shot is fetched straight away through the same
      // path as Regenerate (the slot-refetcher), stamped first (decision 286).
      if (phase === 'board') {
        const fetches = await step.run('stamp-fetches', async () => {
          const stamped: { slotId: string; jobId: string }[] = []
          for (const [at, slotId] of written.ids.entries()) {
            if (designed.rows[at]!.type === 'archival') continue
            const job: SlotJob = {
              kind: 'refetch',
              jobId: newId(),
              startedAt: new Date().toISOString(),
            }
            await setSlotJob(db, slotId, job)
            stamped.push({ slotId, jobId: job.jobId })
          }
          return stamped
        })
        if (fetches.length > 0) {
          await step.sendEvent(
            'fetch-new',
            fetches.map((fetch) =>
              events.visualsRefetchRequested.create({
                projectId,
                slotId: fetch.slotId,
                note: 'Stretch re-plan',
                jobId: fetch.jobId,
              }),
            ),
          )
        }
      }

      const removed = removeIds.length
      const added = written.ids.length
      await step.run('notify', () =>
        notify({
          kind: 'heads-up',
          title: 'Shots re-planned',
          body: `${removed} shot${removed === 1 ? '' : 's'} re-planned as ${added}`,
          href: `/projects/${projectId}`,
        }),
      )
      return { projectId, chapterId, outcome: 'replanned' as const, removed, added }
    })()

    // Once, after the body, whichever of its returns it took (decision 286).
    // Matched on the job id, so it is a no-op for rows the write deleted.
    await step.run('release-jobs', async () => {
      for (const slotId of removeIds) await releaseSlotJob(db, slotId, jobId)
    })
    return result
  },
)
