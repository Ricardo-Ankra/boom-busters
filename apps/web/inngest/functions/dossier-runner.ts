import {
  countClaims,
  getCase,
  getProject,
  markDossierApproved,
  saveDossier,
  setProjectStage,
} from '@boom-busters/db'
import { renderDossierMarkdown } from '@boom-busters/providers'
import { parseEventData, serialiseError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import type { GetStepTools } from 'inngest'
import { db } from '@/lib/db'
import { inngest } from '../client'
import { events } from '../events'
import {
  autoCloseReviewGate,
  closeBudgetGate,
  closeReviewGate,
  grantOverage,
  markStageFailed,
  openBudgetGate,
  openReviewGate,
  type GateContext,
} from '../lib/gates'
import { gateSummary, researchDossier } from '../lib/dossier-research'

type StepTools = GetStepTools<typeof inngest>

/**
 * dossier-runner (build spec section 7.1).
 *
 * `project/created` → research passes (brief → timeline → claims) → dossier and
 * claims rows → gate → `waitForEvent('gate/dossier.approved')`.
 *
 * **It waits on approval only.** A change request is handled by
 * `dossier-reviser`, a separate function, which re-researches and re-opens the
 * gate while this run stays parked on its single wait. Racing an approval wait
 * against a changes wait would be the obvious alternative, and is not used
 * here for two reasons: the losing wait of every round stays outstanding in
 * the run plan, and the behaviour cannot be tested — `@inngest/test` cannot
 * drive a run past a `waitForEvent` at all. A separate function for the side
 * path is the shape M2 already proved with `cancel-reconciler`.
 *
 * Each research pass is its own `step.run()`, because a step boundary is a
 * spend boundary: Inngest memoises completed steps, so a failure while
 * extracting claims re-runs claims extraction only. Merging the three into one
 * step would make every retry pay for the brief again.
 */

const FUNCTION_ID = 'dossier-runner'

export const dossierRunner = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Dossier research',
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
    triggers: [events.projectCreated],
  },
  async ({ event, step, runId }) => {
    const { projectId } = parseEventData('project/created', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const caseContext = await step.run('load-case', async () => {
      const project = await getProject(db, projectId)
      if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)

      const source = await getCase(db, project.caseId)
      if (!source) throw new NonRetriableError(`Case ${project.caseId} no longer exists`)

      await setProjectStage(db, projectId, { stage: 'dossier', stageStatus: 'running' })

      return {
        title: source.title,
        category: source.category as string,
        angle: source.angle,
        demandNotes: source.demandNotes,
      }
    })

    // Research, parking on the budget gate for as many rounds as the human is
    // willing to fund. A cap is a decision to be asked about, not a failure.
    const MAX_BUDGET_ROUNDS = 3
    let research = await researchDossier(step, { projectId, caseContext, round: 0 })

    for (let round = 0; research.budgetGate && round < MAX_BUDGET_ROUNDS; round += 1) {
      const granted = await waitOutBudgetGate(step, ctx, research.budgetGate, round)
      if (!granted) return { projectId, outcome: 'aborted-on-budget' as const }

      research = await researchDossier(step, { projectId, caseContext, round: round + 1 })
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

    /**
     * Exception-based gating (decision, 2026-08-16): the gate parks only when
     * something actually needs a human. `counts.blocking` is the same
     * predicate `approveGate` enforces server-side — unverified claims not
     * yet quarantined — so a dossier with zero of them is one the human
     * could only have rubber-stamped. It approves itself, says so, and the
     * script runner starts on the same event a manual approval would send.
     */
    if (counts.blocking === 0) {
      await step.run('auto-approve', async () => {
        await markDossierApproved(db, projectId)
        await autoCloseReviewGate(ctx, {
          stage: 'dossier',
          nextStage: 'script',
          summary: gateSummary(counts),
        })
      })
      await step.sendEvent('advance-to-script', events.dossierApproved.create({ projectId }))

      return { projectId, outcome: 'auto-approved' as const, claims: counts.total }
    }

    await step.run('open-gate', () =>
      openReviewGate(ctx, {
        stage: 'dossier',
        projectStage: 'dossier',
        summary: gateSummary(counts),
      }),
    )

    const approval = await step.waitForEvent('await-dossier-gate', {
      event: 'gate/dossier.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!approval) {
      // Thirty days without a decision. Failing is more honest than waiting
      // forever on a run nobody remembers starting.
      await step.run('gate-timed-out', () =>
        markStageFailed(ctx, {
          message: 'The dossier gate went 30 days without a decision.',
        }),
      )
      return { projectId, outcome: 'gate-timeout' as const }
    }

    await step.run('close-gate', async () => {
      await markDossierApproved(db, projectId)
      await closeReviewGate(ctx, { stage: 'dossier', nextStage: 'script' })
    })

    return { projectId, outcome: 'approved' as const, claims: counts.total }
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
