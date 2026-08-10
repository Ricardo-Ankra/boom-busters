import { getSettings, setProjectStage } from '@boom-busters/db'
import { withCost } from '@boom-busters/cost'
import { BudgetExceededError, parseEventData, serialiseError } from '@boom-busters/schemas'
import type { Provider } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import type { GetStepTools } from 'inngest'
import { db } from '@/lib/db'
import { inngest } from '../client'
import { events } from '../events'
import {
  budgetGateData,
  closeBudgetGate,
  closeReviewGate,
  grantOverage,
  markStageFailed,
  openBudgetGate,
  openReviewGate,
  type GateContext,
} from '../lib/gates'

type StepTools = GetStepTools<typeof inngest>

/**
 * The M2 demo pipeline (build spec section 14.2): "a demo no-op pipeline with
 * two fake gates proves park/resume/cancel on production infra".
 *
 * It does no real work and calls no paid provider. What it exercises is the
 * whole orchestration spine — cancellation, gate parking, the budget gate,
 * step memoisation, the run mirror and the failure path — against the same
 * Inngest deployment the real runners will use. Every behaviour here is one
 * the stage runners in M3-M7 inherit verbatim.
 *
 * It is deleted when `publish-runner` lands and the real pipeline can prove
 * the same things end to end.
 */

const FUNCTION_ID = 'demo-runner'

/** A token spend, marked as demo, so the Costs screen never lies about it. */
const DEMO_PROVIDER: Provider = 'anthropic'
const DEMO_ESTIMATE_USD = 0.0001

export const demoPipeline = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Demo pipeline (M2)',
    retries: 4,
    /**
     * The UI Stop button emits `project/cancelled`; this is what makes the
     * button honest. The guard scopes cancellation to the project that was
     * stopped rather than every demo run in flight (spec section 7).
     */
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
    triggers: [events.demoRequested],
  },
  async ({ event, step, runId }) => {
    const { projectId, forceBudgetGate } = event.data
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    // -----------------------------------------------------------------------
    // Stage 1 — pretend to research, then park at the dossier gate
    // -----------------------------------------------------------------------

    await step.run('start-dossier', async () => {
      await setProjectStage(db, projectId, { stage: 'dossier', stageStatus: 'running' })
    })

    // A real step boundary with a real (tiny) spend: this is the memoisation
    // boundary the spec calls the spend boundary, and proving a replay does
    // not double-charge is the point of putting it here.
    await spendThroughBudgetGate(ctx, step, 'demo-research', forceBudgetGate === true)

    await step.run('open-dossier-gate', async () => {
      await openReviewGate(ctx, {
        stage: 'dossier',
        projectStage: 'dossier',
        summary: 'Demo dossier ready · 0 claims · nothing was actually researched',
      })
    })

    const dossierDecision = await step.waitForEvent('await-dossier-gate', {
      event: 'gate/dossier.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!dossierDecision) {
      throw new NonRetriableError('Dossier gate timed out after 30 days without a decision.')
    }

    await step.run('close-dossier-gate', async () => {
      await closeReviewGate(ctx, { stage: 'dossier', nextStage: 'script' })
    })

    // -----------------------------------------------------------------------
    // Stage 2 — pretend to write, then park at the script gate
    // -----------------------------------------------------------------------

    // Durable sleep: the run survives the function returning, the deployment
    // restarting, and the region changing underneath it.
    await step.sleep('settle', '1s')

    await step.run('open-script-gate', async () => {
      await openReviewGate(ctx, {
        stage: 'script',
        projectStage: 'script',
        summary: 'Demo script ready · 0 words · 0 unsourced-claim warnings',
      })
    })

    const scriptDecision = await step.waitForEvent('await-script-gate', {
      event: 'gate/script.approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!scriptDecision) {
      throw new NonRetriableError('Script gate timed out after 30 days without a decision.')
    }

    await step.run('finish', async () => {
      await closeReviewGate(ctx, { stage: 'script', nextStage: 'done' })
      await setProjectStage(db, projectId, { stage: 'done', stageStatus: 'approved' })
    })

    return { projectId, completed: true }
  },
)

/**
 * Spend inside a step, parking on a budget gate rather than failing when a cap
 * would be crossed (spec section 6).
 *
 * The pattern every M3+ runner copies: `BudgetExceededError` is caught *inside*
 * the step and returned as data, never thrown. Throwing would hand it to
 * Inngest's retry machinery, which would burn four attempts on a decision only
 * a human can make.
 */
async function spendThroughBudgetGate(
  ctx: GateContext,
  step: StepTools,
  operation: string,
  forceGate: boolean,
): Promise<void> {
  const MAX_GATE_ROUNDS = 3

  for (let round = 0; round < MAX_GATE_ROUNDS; round += 1) {
    const outcome = await step.run(`spend-${operation}-${round}`, async () => {
      const settings = await getSettings(db)
      // Forcing the gate asks for more than any cap can hold, rather than
      // faking a refusal — the guard makes the real decision either way.
      const estimateUsd = forceGate && round === 0 ? 1_000_000 : DEMO_ESTIMATE_USD

      try {
        await withCost(
          db,
          {
            provider: DEMO_PROVIDER,
            operation,
            projectId: ctx.projectId,
            estimateUsd,
            meta: { demo: true },
          },
          async () => ({ result: null, actualUsd: 0 }),
          { settings },
        )
        return { gated: null }
      } catch (error) {
        if (error instanceof BudgetExceededError) return { gated: budgetGateData(error) }
        throw error
      }
    })

    if (!outcome.gated) return

    await step.run(`open-budget-gate-${round}`, async () => {
      await openBudgetGate(ctx, outcome.gated as Record<string, unknown>)
    })

    const approved = await step.waitForEvent(`await-budget-${round}`, {
      event: 'budget/approved',
      timeout: '30d',
      if: 'async.data.projectId == event.data.projectId',
    })

    if (!approved) {
      throw new NonRetriableError(
        `Budget gate on ${String(outcome.gated['provider'])} was never answered.`,
      )
    }

    // Parsed rather than cast: the event may have been replayed from the
    // Inngest dashboard or sent by a future caller, and an unchecked
    // `additionalUsd` here would raise a real budget by an arbitrary amount.
    const decision = parseEventData('budget/approved', approved.data)

    await step.run(`apply-overage-${round}`, async () => {
      await grantOverage(decision.provider as Provider, decision.additionalUsd)
      await closeBudgetGate(
        ctx,
        `Overage of $${decision.additionalUsd.toFixed(2)} approved for ${decision.provider}`,
      )
    })
  }

  throw new NonRetriableError(
    `Budget gate for ${operation} was re-opened ${MAX_GATE_ROUNDS} times; giving up rather than looping.`,
  )
}
