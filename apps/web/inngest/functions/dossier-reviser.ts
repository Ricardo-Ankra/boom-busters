import { bumpDossierRevisions, countClaims, getCase, getProject, saveDossier } from '@boom-busters/db'
import { renderDossierMarkdown } from '@boom-busters/providers'
import { parseEventData, serialiseError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { inngest } from '../client'
import { events } from '../events'
import { markStageFailed, openReviewGate, type GateContext } from '../lib/gates'
import { gateSummary, researchDossier } from '../lib/dossier-research'

/**
 * dossier-reviser — the `Request changes` path (build spec section 7.1).
 *
 * The main `dossier-runner` run stays parked on its single
 * `waitForEvent('gate/dossier.approved')` the whole time this runs. So a
 * revision re-researches with the human's note, rewrites the dossier and
 * claims, and re-opens the gate; the parked run notices nothing until the
 * human eventually approves, which is exactly the semantics wanted.
 *
 * The alternative — racing an approval wait against a changes wait inside the
 * runner — leaves the losing wait of every round outstanding in the run plan,
 * and cannot be tested with `@inngest/test`, which cannot drive a run past a
 * `waitForEvent` at all.
 */

const FUNCTION_ID = 'dossier-reviser'

/**
 * Past three rounds the research is not the problem. Another Opus pass costs
 * real money to produce the same disappointment, so the run stops and says to
 * edit it directly or change the angle.
 */
const REVISION_LIMIT = 3

export const dossierReviser = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Dossier revision',
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
      await markStageFailed(
        { inngestRunId: '', functionId: FUNCTION_ID, projectId },
        serialiseError(event.data.error),
      )
    },
    triggers: [events.dossierChangesRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, note } = parseEventData('gate/dossier.changes_requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const context = await step.run('load-case', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      const source = await getCase(db, project.caseId)
      if (!source) throw new NonRetriableError(`Case ${project.caseId} no longer exists`)

      const round = await bumpDossierRevisions(db, projectId)

      return {
        round,
        caseContext: {
          title: source.title,
          category: source.category as string,
          angle: source.angle,
          demandNotes: source.demandNotes,
        },
      }
    })

    if (context.round > REVISION_LIMIT) {
      await step.run('revision-limit', () =>
        markStageFailed(ctx, {
          message:
            `The dossier was sent back ${context.round} times. Edit it directly, or change the ` +
            'case angle and start the project again.',
        }),
      )
      return { projectId, outcome: 'revision-limit' as const }
    }

    const research = await researchDossier(step, {
      projectId,
      caseContext: context.caseContext,
      round: context.round,
      note,
    })

    const overBudget = research.budgetGate
    if (overBudget) {
      // The main run owns the budget gate; a revision that cannot afford to
      // run says so at the gate rather than opening a second one.
      await step.run('revision-over-budget', () =>
        markStageFailed(ctx, {
          message: `The revision would cross the ${String(overBudget['provider'])} budget cap.`,
        }),
      )
      return { projectId, outcome: 'over-budget' as const }
    }

    const counts = await step.run('save-revision', async () => {
      const saved = await saveDossier(db, {
        projectId,
        contentMd: renderDossierMarkdown({
          caseTitle: context.caseContext.title,
          brief: research.brief,
          timeline: research.timeline,
          claims: research.claims,
        }),
        claims: research.claims.map((claim) => ({
          text: claim.text,
          sourceUrl: claim.sourceUrl,
          sourceType: claim.sourceType,
          confidence: claim.confidence,
        })),
      })
      return countClaims(saved.claims)
    })

    await step.run('reopen-gate', () =>
      openReviewGate(ctx, {
        stage: 'dossier',
        projectStage: 'dossier',
        summary: `${gateSummary(counts)} · revision ${context.round}`,
      }),
    )

    return { projectId, outcome: 'revised' as const, round: context.round }
  },
)
