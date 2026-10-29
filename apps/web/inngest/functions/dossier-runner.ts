import {
  channelForProject,
  getCase,
  getProject,
  saveDossier,
  setProjectStage,
} from '@boom-busters/db'
import { mockProvidersEnabled, renderDossierMarkdown } from '@boom-busters/providers'
import { parseEventData, serialiseError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import type { GetStepTools } from 'inngest'
import { completeForProject } from '@/lib/answer-call'
import { db } from '@/lib/db'
import { recordRepairs } from '@/lib/notices'
import { liveResearchSources } from '@/lib/research-sources'
import { inngest } from '../client'
import { events } from '../events'
import {
  closeBudgetGate,
  grantOverage,
  markStageFailed,
  openBudgetGate,
  openReviewGate,
  type GateContext,
} from '../lib/gates'
import { awaitDossierApproval } from '../lib/dossier-approval'
import { nameSubjectIfMissing } from '../lib/name-subject'
import { gatherCorpus } from '../lib/dossier-gather'
import { requireCompleteBible } from '../lib/channel'
import { inngestSteps } from '../lib/steps'
import {
  EMPTY_CORPUS_MESSAGE,
  gateCounts,
  gateSubject,
  gateSummary,
  loadCorpus,
  predatesCorpus,
  replayedCase,
  researchDossier,
  toDraftClaims,
} from '../lib/dossier-research'

type StepTools = GetStepTools<typeof inngest>

/**
 * dossier-runner (build spec section 7.1).
 *
 * `project/created` → gather the corpus → load it → research passes (brief →
 * scenes → claims → answers) and grounding → dossier and claims rows → gate →
 * `waitForEvent('gate/dossier.approved')`.
 *
 * **It waits on approval only.** A change request is handled by
 * `dossier-reviser`, a separate function, which re-researches and re-opens the
 * gate while this run stays parked on its single wait. Racing an approval wait
 * against a changes wait would be the obvious alternative, and is not used
 * here for two reasons: the losing wait of every round stays outstanding in
 * the run plan, and the behaviour cannot be tested — `@inngest/test` cannot
 * drive a run past a `waitForEvent` at all. A separate function for the side
 * path is the shape M2 already proved with `cancel-reconciler`. Changes asked
 * for after approval find this run finished, so the reviser then holds the
 * gate itself (design decision 7).
 *
 * The gate always opens (decision 1). The runner once approved a dossier
 * with nothing blocking on its own and started the script; the owner wants to
 * read, revise and refine the dossier first, so only the Approve moves on.
 *
 * Each research pass is its own `step.run()`, because a step boundary is a
 * spend boundary: Inngest memoises completed steps, so a failure while
 * extracting claims re-runs claims extraction only. Merging the passes into one
 * step would make every retry pay for the brief again.
 */

const FUNCTION_ID = 'dossier-runner'

export const dossierRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Dossier research',
    retries: 4,
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
    triggers: [events.projectCreated],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('project/created', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }
    const steps = inngestSteps(step)

    const loaded = await step.run('load-case', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      // Every later stage follows a dossier, so this one stops a blank channel.
      // The channel is read here, in the step, never from an earlier step's output.
      requireCompleteBible(await channelForProject(db, projectId))

      const source = await getCase(db, project.caseId)
      if (!source) throw new NonRetriableError(`Case ${project.caseId} no longer exists`)

      await setProjectStage(db, projectId, { stage: 'dossier', stageStatus: 'running' })

      const named = await nameSubjectIfMissing(db, source, {
        complete: completeForProject(projectId),
        mocked: mockProvidersEnabled(),
        projectId,
      })

      return {
        title: source.title,
        category: source.category as string,
        angle: source.angle,
        demandNotes: source.demandNotes,
        subject: named.subject,
        people: named.people,
        sourceLinks: source.sourceLinks,
        competitorLinks: source.competitorLinks.map((link) => ({ url: link.url })),
      }
    })
    // Parked runs replay old step results: a run parked at the gate before the
    // corpus existed has already saved and opened it, so it only waits.
    if (predatesCorpus(loaded)) {
      const outcome = await awaitDossierApproval(step, ctx)
      return { projectId, outcome }
    }
    const { competitorLinks } = loaded
    // A load-case stored before cases had a subject names none: the title
    // stands in, as the gather was searched with it then.
    const {
      subject: caseSubject,
      people: casePeople,
      sourceLinks: caseSourceLinks,
    } = replayedCase(loaded)
    // Every pass opens on the subject and people the gather searched with.
    const caseContext = {
      title: loaded.title,
      category: loaded.category,
      angle: loaded.angle,
      demandNotes: loaded.demandNotes,
      subject: caseSubject,
      people: casePeople,
    }

    const mocked = mockProvidersEnabled()
    // The sources are built inside the gather's own steps, never here: a replay
    // must not need DATA_CONTACT_EMAIL, and mock mode never builds them.
    const gathered = await gatherCorpus(
      steps,
      {
        projectId,
        subject: caseSubject,
        people: casePeople,
        sourceLinks: caseSourceLinks,
        competitorLinks,
        round: 0,
      },
      { db, sources: () => liveResearchSources(), mocked },
    )
    const { documents, corpus } = await step.run('corpus-load-0', () => loadCorpus(db, projectId))
    if (corpus.read === 0) {
      await step.run('corpus-empty-0', () =>
        markStageFailed(ctx, { message: EMPTY_CORPUS_MESSAGE }),
      )
      return { projectId, outcome: 'no-corpus' as const }
    }
    const researchRound = (round: number) =>
      researchDossier(
        steps,
        {
          projectId,
          caseContext,
          round,
          entity: gathered.entity,
          documents,
          corpus,
        },
        { bible: () => channelForProject(db, projectId) },
      )

    // Research, parking on the budget gate for as many rounds as the human is
    // willing to fund. A cap is a decision to be asked about, not a failure.
    const MAX_BUDGET_ROUNDS = 3
    let research = await researchRound(0)

    for (let round = 0; research.budgetGate && round < MAX_BUDGET_ROUNDS; round += 1) {
      const granted = await waitOutBudgetGate(step, ctx, research.budgetGate, round)
      if (!granted) return { projectId, outcome: 'aborted-on-budget' as const }

      research = await researchRound(round + 1)
    }

    if (research.budgetGate) {
      await step.run('budget-gate-exhausted', () => markStageFailed(ctx, research.budgetGate!))
      return { projectId, outcome: 'aborted-on-budget' as const }
    }

    const counts = await step.run('save-dossier', async () => {
      const saved = await saveDossier(db, {
        projectId,
        contentMd: renderDossierMarkdown({
          caseTitle: caseContext.title,
          research: research.research,
          claims: research.claims,
          documents,
        }),
        claims: toDraftClaims(research.claims),
        research: research.research,
      })
      // What the research passes trimmed or dropped, on the dossier review; a
      // clean dossier retires the last one's notice (decision 293).
      await recordRepairs({ projectId, subject: 'dossier', subjectId: null }, research.repairs)
      // Checked here, against the corpus this run loaded, so the gate below
      // reads one stored answer rather than recomputing it on replay.
      return gateCounts(saved.claims, research.claims, documents)
    })

    // The gate always opens (design decision 1): the script starts only on the
    // owner's Approve, never on its own, however clean the dossier reads.
    // Unverified claims still block that Approve, server-side.
    await step.run('open-gate', () =>
      openReviewGate(ctx, {
        stage: 'dossier',
        projectStage: 'dossier',
        summary: gateSummary(
          counts,
          corpus,
          gateSubject(gathered.entity, { subject: caseSubject, people: casePeople }),
        ),
      }),
    )

    const outcome = await awaitDossierApproval(step, ctx)
    return { projectId, outcome, claims: counts.total }
  },
)

/** Park on the budget gate; resolve true if the human granted the overage. */
async function waitOutBudgetGate(
  step: StepTools,
  ctx: GateContext,
  gate: Record<string, unknown>,
  round: number,
): Promise<boolean> {
  await step.run(`open-budget-gate-${round}`, () => openBudgetGate(ctx, gate))

  const approved = await step.waitForEvent(`await-budget-${round}`, {
    event: 'budget/approved',
    timeout: '7d',
    if: 'async.data.projectId == event.data.projectId',
  })

  if (!approved) {
    await step.run(`budget-unanswered-${round}`, () => markStageFailed(ctx, gate))
    return false
  }

  // Parsed rather than cast: the event may have been replayed from the Inngest
  // dashboard, and an unchecked `additionalUsd` would raise a real cap by an
  // arbitrary amount.
  const decision = parseEventData('budget/approved', approved.data)

  await step.run(`apply-overage-${round}`, async () => {
    await grantOverage(decision.additionalUsd)
    await closeBudgetGate(
      ctx,
      `Overage of $${decision.additionalUsd.toFixed(2)} approved for ${decision.provider}`,
    )
  })

  return true
}
