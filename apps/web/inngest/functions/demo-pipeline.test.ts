// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getProject,
  listOpenBudgetGates,
  listRunEvents,
  listRuns,
  requireTestDatabase,
  seed,
  setProjectStage,
  truncateRunMirror,
  updateSettings,
} from '@boom-busters/db'
import { listLedger, truncateLedger } from '@boom-busters/cost'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { cancelReconciler } from './cancel-reconciler'
import { demoPipeline } from './demo-pipeline'

/**
 * The Inngest test harness (build spec section 13): gate parking, the budget
 * gate, memoisation and cancellation, asserted by running the real functions
 * against the real database. Mocking the database instead would only assert
 * that a mock was called, which proves nothing about whether a gate parks.
 *
 * **What is not here, and why.** `@inngest/test` 1.0.0 can mock the output of
 * a *runnable* step (`step.run`) but not a non-runnable one, and
 * `step.waitForEvent` is non-runnable. A run therefore cannot be driven *past*
 * a gate from this harness. The resume half of park/resume — the state
 * transition an approval causes — is asserted directly against the gate
 * helpers in `../lib/gates.test.ts`.
 */

// Gated on TEST_DATABASE_URL, not DATABASE_URL: these truncate the run
// mirror and the ledger, and must never reach a deployment's database.
// `vitest.setup.ts` rebinds DATABASE_URL to it for the code under test.
const describeDb = requireTestDatabase() ? describe : describe.skip

/** The event that starts a demo run for the fixture project. */
function demoEvent(
  data: Record<string, unknown> = {},
): [{ name: string; data: Record<string, unknown> }] {
  return [{ name: 'demo/pipeline.requested', data: { projectId: FIXTURE_PROJECT_ID, ...data } }]
}

/** A `project/cancelled` for the fixture project. */
function cancelledEvent(): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'project/cancelled',
      data: { projectId: FIXTURE_PROJECT_ID, reason: 'Stopped from the project screen' },
    },
  ]
}

async function resetFixture(): Promise<void> {
  await seed(db)
  await truncateRunMirror(db)
  await truncateLedger(db)
  // The mirror memo would otherwise point at rows the truncate deleted.
  forgetRunRows()
  await updateSettings(db, {
    budgets: { killSwitch: false, perProviderMonthlyUSD: { anthropic: 30 }, approvedOverages: {} },
  })
}

describeDb('demo pipeline', () => {
  // A fresh engine per test: `InngestTestEngine` memoises mock handlers across
  // executions *and* across clones, so one engine shared by a describe block
  // leaks a mock's resolved value from one test into the next.
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: demoPipeline })
    await resetFixture()
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'queued' })
  })

  describe('gate parking', () => {
    it('parks the project at the dossier gate and says so in both places', async () => {
      await engine.executeStep('open-dossier-gate', { events: demoEvent() })

      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project?.stage).toBe('dossier')
      expect(project?.stageStatus).toBe('awaiting_review')

      // The run's own status has to agree, or the top bar counts a parked run
      // as active.
      const [run] = await listRuns(db)
      expect(run?.status).toBe('awaiting_gate')

      const events = await listRunEvents(db, run?.id as string)
      const opened = events.find((event) => event.kind === 'gate.opened')
      expect(opened?.data).toMatchObject({ gate: 'dossier' })
    })

    it('registers a 30-day wait rather than polling for an approval', async () => {
      // Stopping *at* the wait rather than at the step before it: that is the
      // checkpoint where the wait has actually been registered.
      const { ctx } = await engine.executeStep('await-dossier-gate', { events: demoEvent() })

      expect(ctx.step.waitForEvent).toHaveBeenCalledWith(
        'await-dossier-gate',
        expect.objectContaining({
          event: 'gate/dossier.approved',
          timeout: '30d',
          if: 'async.data.projectId == event.data.projectId',
        }),
      )
    })
  })

  describe('spend', () => {
    it('settles the spend rather than leaving it reserved', async () => {
      await engine.executeStep('open-dossier-gate', { events: demoEvent() })

      const [entry] = await listLedger(db)
      expect(entry?.settled).toBe(true)
      expect(entry?.operation).toBe('demo-research')
      expect(entry?.meta).toMatchObject({ demo: true })
      expect(entry?.projectId).toBe(FIXTURE_PROJECT_ID)
    })

    it('gives the spend a deterministic step id, which is what makes memoisation work', async () => {
      // Spec section 7: "Step IDs are deterministic". A step id that varied
      // between attempts would make Inngest treat a replay as new work and
      // charge again — the one way this pipeline could double-spend.
      const { ctx } = await engine.executeStep('open-dossier-gate', { events: demoEvent() })

      expect(ctx.step.run).toHaveBeenCalledWith('spend-demo-research-0', expect.any(Function))
    })

    // Memoisation itself is deliberately NOT asserted here. `@inngest/test`
    // persists no step state between executions: every `execute`/`executeStep`
    // is a fresh run that replays each step for real, so "the provider was
    // called once" is not observable through this harness, and a test claiming
    // otherwise would be measuring the harness rather than the pipeline. The
    // property it protects is the deterministic step id asserted above.
  })

  describe('budget gate', () => {
    it('parks instead of failing when a cap would be crossed', async () => {
      await engine.executeStep('open-budget-gate-0', {
        events: demoEvent({ forceBudgetGate: true }),
      })

      const [gate] = await listOpenBudgetGates(db)
      expect(gate).toMatchObject({ provider: 'anthropic', budgetUsd: 30, killSwitch: false })
      expect(gate?.estimateUsd).toBe(1_000_000)

      // Parked, not failed: a cap is a question, not an error.
      const [run] = await listRuns(db)
      expect(run?.status).toBe('awaiting_gate')
      expect(run?.error).toBeNull()
    })

    it('records no spend for a refused call', async () => {
      await engine.executeStep('open-budget-gate-0', {
        events: demoEvent({ forceBudgetGate: true }),
      })
      expect(await listLedger(db)).toEqual([])
    })

    it('parks the same way when the kill switch is on', async () => {
      await updateSettings(db, { budgets: { killSwitch: true } })

      await engine.executeStep('open-budget-gate-0', { events: demoEvent() })

      const [gate] = await listOpenBudgetGates(db)
      expect(gate?.killSwitch).toBe(true)
      // The estimate is the real one, not the forced million.
      expect(gate?.estimateUsd).toBeCloseTo(0.0001)
    })
  })
})

describeDb('cancel reconciler', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: cancelReconciler })
    await resetFixture()
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'running' })
  })

  // Two full durable executions — the demo run, then the canceller. Against a
  // hosted database that is well past Vitest's 5s default.
  it('cancels the project and closes its runs mid-stage', { timeout: 120_000 }, async () => {
    const demo = new InngestTestEngine({ function: demoPipeline })
    await demo.executeStep('open-dossier-gate', { events: demoEvent() })

    const { result } = await engine.execute({ events: cancelledEvent() })

    expect(result).toMatchObject({ projectId: FIXTURE_PROJECT_ID })
    expect((result as { runsClosed: number }).runsClosed).toBeGreaterThan(0)

    const project = await getProject(db, FIXTURE_PROJECT_ID)
    expect(project?.stageStatus).toBe('cancelled')
    expect(project?.cancelledAt).toBeTruthy()

    // Nothing is left running for this project except the canceller itself.
    const stillOpen = (await listRuns(db)).filter(
      (run) =>
        run.functionName !== 'cancel-reconciler' &&
        (run.status === 'running' || run.status === 'awaiting_gate'),
    )
    expect(stillOpen).toEqual([])

    const cancelledRun = (await listRuns(db)).find((run) => run.status === 'cancelled')
    const events = await listRunEvents(db, cancelledRun?.id as string)
    expect(events.map((event) => event.kind)).toContain('run.cancelled')
  })

  it('is safe to run twice — a stopped project stays stopped', async () => {
    await engine.execute({ events: cancelledEvent() })
    const first = (await getProject(db, FIXTURE_PROJECT_ID))?.cancelledAt

    await engine.execute({ events: cancelledEvent() })

    const project = await getProject(db, FIXTURE_PROJECT_ID)
    expect(project?.stageStatus).toBe('cancelled')
    expect(first).toBeTruthy()
  })
})
