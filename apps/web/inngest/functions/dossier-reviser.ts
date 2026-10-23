import {
  bumpDossierRevisions,
  getCase,
  getDossier,
  getProject,
  listDossierDocumentSummaries,
  saveDossier,
} from '@boom-busters/db'
import { mockProvidersEnabled, renderDossierMarkdown } from '@boom-busters/providers'
import type { ResearchEntity } from '@boom-busters/schemas'
import { parseEventData, serialiseError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { recordRepairs } from '@/lib/notices'
import { liveResearchSources } from '@/lib/research-sources'
import { inngest } from '../client'
import { events } from '../events'
import { markStageFailed, openReviewGate, type GateContext } from '../lib/gates'
import { gatherCorpus } from '../lib/dossier-gather'
import { inngestSteps } from '../lib/steps'
import {
  EMPTY_CORPUS_MESSAGE,
  gateCounts,
  gateSummary,
  loadCorpus,
  predatesCorpus,
  researchDossier,
  toDraftClaims,
} from '../lib/dossier-research'

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
 *
 * A revision reads the corpus the first run gathered: the note asks for a
 * different reading, not different documents, and a second gather would pay
 * for every fetch again. Only a project researched before the corpus existed
 * has none linked, and that one gathers first.
 */

const NO_ENTITY: ResearchEntity = {
  qid: null,
  titles: [],
  cik: null,
  ticker: null,
  website: null,
  people: [],
  unresolved: false,
  subject: null,
}

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
    // One live run per project: a duplicate trigger cancels the run it
    // duplicates rather than stacking beside it (decision 233, amended).
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
    const steps = inngestSteps(step)

    const context = await step.run('load-case', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      const source = await getCase(db, project.caseId)
      if (!source) throw new NonRetriableError(`Case ${project.caseId} no longer exists`)

      const round = await bumpDossierRevisions(db, projectId)
      const dossier = await getDossier(db, projectId)
      const linked = await listDossierDocumentSummaries(db, projectId)

      return {
        round,
        caseContext: {
          title: source.title,
          category: source.category as string,
          angle: source.angle,
          demandNotes: source.demandNotes,
        },
        competitorLinks: source.competitorLinks.map((link) => ({ url: link.url })),
        entity: dossier?.research?.entity ?? NO_ENTITY,
        linkedDocuments: linked.length,
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

    // Parked runs replay old step results: a revision in flight across the
    // deploy would run the new passes over its old-shape results, so it stops
    // and asks for the changes to be requested again.
    if (predatesCorpus(context)) {
      await step.run('revision-predates-corpus', () =>
        markStageFailed(ctx, {
          message:
            'The revision was interrupted by an update to the research. Request the changes again.',
        }),
      )
      return { projectId, outcome: 'predates-corpus' as const }
    }

    let entity = context.entity
    if (context.linkedDocuments === 0) {
      const gathered = await gatherCorpus(
        steps,
        {
          projectId,
          caseTitle: context.caseContext.title,
          competitorLinks: context.competitorLinks,
          round: context.round,
        },
        { db, sources: () => liveResearchSources(), mocked: mockProvidersEnabled() },
      )
      entity = gathered.entity
    }
    const { documents, corpus } = await step.run(`corpus-load-${context.round}`, () =>
      loadCorpus(db, projectId),
    )
    if (corpus.read === 0) {
      await step.run(`corpus-empty-${context.round}`, () =>
        markStageFailed(ctx, { message: EMPTY_CORPUS_MESSAGE }),
      )
      return { projectId, outcome: 'no-corpus' as const }
    }

    const research = await researchDossier(steps, {
      projectId,
      caseContext: context.caseContext,
      round: context.round,
      note,
      entity,
      documents,
      corpus,
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
          research: research.research,
          claims: research.claims,
          documents,
        }),
        claims: toDraftClaims(research.claims),
        research: research.research,
      })
      // What the revision's passes trimmed or dropped, on the dossier review; a
      // clean revision retires the last notice (decision 293).
      await recordRepairs({ projectId, subject: 'dossier', subjectId: null }, research.repairs)
      return gateCounts(saved.claims, research.claims, documents)
    })

    await step.run('reopen-gate', () =>
      openReviewGate(ctx, {
        stage: 'dossier',
        projectStage: 'dossier',
        summary: `${gateSummary(counts, corpus)} · revision ${context.round}`,
      }),
    )

    return { projectId, outcome: 'revised' as const, round: context.round }
  },
)
