import { recordRunEvent, setProjectStage, setRunStatus, updateSettings } from '@boom-busters/db'
import type { ProjectStage } from '@boom-busters/db'
import { monthKey } from '@boom-busters/schemas'
import type { BudgetExceededError, GateStage, Provider } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { resolveRunRowId } from '../middleware/run-mirror'

/**
 * Opening and closing gates — the two places where a durable run hands control
 * to a human and takes it back (build spec principle 1).
 *
 * A gate is not an entity. A review gate *is* `projects.stageStatus =
 * 'awaiting_review'`; a budget gate *is* a run at `awaiting_gate` with an
 * unclosed `gate.opened` event. These helpers keep the two representations
 * written together, so nothing can park a run without the UI showing why.
 */

export interface GateContext {
  inngestRunId: string
  functionId: string
  projectId: string
}

async function runRowId(ctx: GateContext): Promise<string> {
  return resolveRunRowId({
    inngestRunId: ctx.inngestRunId,
    functionId: ctx.functionId,
    projectId: ctx.projectId,
  })
}

// ---------------------------------------------------------------------------
// Review gates
// ---------------------------------------------------------------------------

export async function openReviewGate(
  ctx: GateContext,
  gate: { stage: GateStage; projectStage: ProjectStage; summary: string },
): Promise<void> {
  const runId = await runRowId(ctx)

  await setProjectStage(db, ctx.projectId, {
    stage: gate.projectStage,
    stageStatus: 'awaiting_review',
  })
  await recordRunEvent(db, {
    runId,
    kind: 'gate.opened',
    message: gate.summary,
    data: { gate: gate.stage },
  })
  await setRunStatus(db, runId, 'awaiting_gate')

  await notify({
    kind: 'gate-open',
    title: `${gate.stage} ready for review`,
    body: gate.summary,
    href: `/projects/${ctx.projectId}`,
  })
}

export async function closeReviewGate(
  ctx: GateContext,
  gate: { stage: GateStage; nextStage: ProjectStage },
): Promise<void> {
  const runId = await runRowId(ctx)

  await recordRunEvent(db, {
    runId,
    kind: 'gate.closed',
    message: `${gate.stage} approved`,
    data: { gate: gate.stage },
  })
  await setRunStatus(db, runId, 'running')
  await setProjectStage(db, ctx.projectId, { stage: gate.nextStage, stageStatus: 'running' })
}

// ---------------------------------------------------------------------------
// Budget gate
// ---------------------------------------------------------------------------

/** The budget error as the Needs-you card and the run event need it. */
export function budgetGateData(error: BudgetExceededError): Record<string, unknown> {
  return {
    gate: 'budget',
    provider: error.provider,
    operation: error.operation,
    budgetUsd: error.budgetUsd,
    monthSpendUsd: error.monthSpendUsd,
    estimateUsd: error.estimateUsd,
    killSwitch: error.killSwitch,
  }
}

export async function openBudgetGate(
  ctx: GateContext,
  gate: Record<string, unknown>,
): Promise<void> {
  const runId = await runRowId(ctx)

  await recordRunEvent(db, {
    runId,
    kind: 'gate.opened',
    message: `Over budget on ${String(gate['provider'])} — approve the overage or abort`,
    data: gate,
  })
  await setRunStatus(db, runId, 'awaiting_gate')

  await notify({
    kind: 'budget-gate',
    title: 'Over budget',
    body:
      `${String(gate['provider'])} needs $${Number(gate['estimateUsd']).toFixed(4)} ` +
      `against a $${Number(gate['budgetUsd']).toFixed(2)} cap.`,
    href: '/costs',
  })
}

export async function closeBudgetGate(ctx: GateContext, message: string): Promise<void> {
  const runId = await runRowId(ctx)
  await recordRunEvent(db, {
    runId,
    kind: 'gate.closed',
    message,
    data: { gate: 'budget' },
  })
  await setRunStatus(db, runId, 'running')
}

/**
 * Record the headroom the human granted. Written into settings rather than
 * held in the run, so the cap the guard reads and the cap the Costs screen
 * shows are the same number — and so it expires with the month.
 */
export async function grantOverage(
  provider: Provider,
  additionalUsd: number,
  now: Date = new Date(),
): Promise<void> {
  await updateSettings(db, {
    budgets: {
      approvedOverages: {
        [provider]: {
          month: monthKey(now),
          usd: additionalUsd,
          approvedAt: now.toISOString(),
        },
      },
    },
  })
}

// ---------------------------------------------------------------------------
// Failure and cancellation
// ---------------------------------------------------------------------------

export async function markStageFailed(
  ctx: GateContext,
  error: Record<string, unknown>,
): Promise<void> {
  await setProjectStage(db, ctx.projectId, { stageStatus: 'failed' })
  await notify({
    kind: 'run-failed',
    title: 'A run failed',
    body: String(error['message'] ?? 'Unknown error'),
    href: `/projects/${ctx.projectId}`,
  })
}
