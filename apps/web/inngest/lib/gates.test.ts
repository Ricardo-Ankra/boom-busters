// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getProject,
  getSettings,
  listOpenBudgetGates,
  listRunEvents,
  listRuns,
  requireTestDatabase,
  seed,
  setProjectStage,
  truncateRunMirror,
  updateSettings,
} from '@boom-busters/db'
import { budgetStatus, truncateLedger } from '@boom-busters/cost'
import { BudgetExceededError, monthKey } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import {
  budgetGateData,
  closeBudgetGate,
  closeReviewGate,
  grantOverage,
  markStageFailed,
  openBudgetGate,
  openReviewGate,
  type GateContext,
} from './gates'

/**
 * The gate helpers: the two moments a durable run hands control to a human and
 * takes it back (build spec principle 1).
 *
 * These are tested here rather than through the Inngest harness because
 * `@inngest/test` cannot mock a `waitForEvent`, so it cannot drive a run past
 * a gate. What an approval *does* is exactly these functions, so this is where
 * the resume half of park/resume is asserted — against the real database, with
 * both representations of a gate checked together.
 */

// Gated on TEST_DATABASE_URL, not DATABASE_URL: these truncate the run
// mirror and the ledger, and must never reach a deployment's database.
// `vitest.setup.ts` rebinds DATABASE_URL to it for the code under test.
const describeDb = requireTestDatabase() ? describe : describe.skip

let counter = 0

function context(): GateContext {
  counter += 1
  return {
    inngestRunId: `01JGATE${String(counter).padStart(19, '0')}`,
    functionId: 'demo-runner',
    projectId: FIXTURE_PROJECT_ID,
  }
}

describeDb('gate helpers', () => {
  beforeEach(async () => {
    await seed(db)
    await truncateRunMirror(db)
    await truncateLedger(db)
    forgetRunRows()
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'dossier', stageStatus: 'running' })
    await updateSettings(db, {
      budgets: {
        killSwitch: false,
        perProviderMonthlyUSD: { anthropic: 30 },
        approvedOverages: {},
      },
    })
  })

  describe('review gates', () => {
    it('parks the project and the run together', async () => {
      const ctx = context()
      await openReviewGate(ctx, {
        stage: 'dossier',
        projectStage: 'dossier',
        summary: 'Dossier ready · 12 claims · 1 unverified',
      })

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')

      const [run] = await listRuns(db)
      expect(run?.status).toBe('awaiting_gate')

      const events = await listRunEvents(db, run?.id as string)
      const opened = events.find((event) => event.kind === 'gate.opened')
      expect(opened?.message).toContain('12 claims')
      expect(opened?.data).toMatchObject({ gate: 'dossier' })
    })

    it('resumes into the next stage on approval', async () => {
      const ctx = context()
      await openReviewGate(ctx, { stage: 'dossier', projectStage: 'dossier', summary: 'ready' })

      await closeReviewGate(ctx, { stage: 'dossier', nextStage: 'script' })

      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project).toMatchObject({ stage: 'script', stageStatus: 'running' })

      const [run] = await listRuns(db)
      expect(run?.status).toBe('running')

      const events = await listRunEvents(db, run?.id as string)
      expect(events.map((event) => event.kind)).toEqual(['gate.opened', 'gate.closed'])
    })

    it('leaves a legible trail of which gate opened and closed', async () => {
      const ctx = context()
      await openReviewGate(ctx, { stage: 'dossier', projectStage: 'dossier', summary: 'ready' })
      await closeReviewGate(ctx, { stage: 'dossier', nextStage: 'script' })
      await openReviewGate(ctx, { stage: 'script', projectStage: 'script', summary: 'ready' })

      const [run] = await listRuns(db)
      const events = await listRunEvents(db, run?.id as string)
      expect(events.map((event) => event.data['gate'])).toEqual(['dossier', 'dossier', 'script'])
    })

    it('reuses one mirror row for the whole run', async () => {
      const ctx = context()
      await openReviewGate(ctx, { stage: 'dossier', projectStage: 'dossier', summary: 'a' })
      await closeReviewGate(ctx, { stage: 'dossier', nextStage: 'script' })
      await openReviewGate(ctx, { stage: 'script', projectStage: 'script', summary: 'b' })

      expect(await listRuns(db)).toHaveLength(1)
    })
  })

  describe('budget gate', () => {
    const error = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'scripting',
      budgetUsd: 30,
      monthSpendUsd: 29.8,
      estimateUsd: 0.45,
    })

    it('carries every number the Needs-you card shows', async () => {
      const ctx = context()
      await openBudgetGate(ctx, budgetGateData(error))

      const [gate] = await listOpenBudgetGates(db)
      expect(gate).toMatchObject({
        provider: 'anthropic',
        operation: 'scripting',
        budgetUsd: 30,
        monthSpendUsd: 29.8,
        estimateUsd: 0.45,
        killSwitch: false,
      })
    })

    it('closes when the overage is approved, and stops being a gate', async () => {
      const ctx = context()
      await openBudgetGate(ctx, budgetGateData(error))
      expect(await listOpenBudgetGates(db)).toHaveLength(1)

      await closeBudgetGate(ctx, 'Overage of $1.00 approved for anthropic')

      expect(await listOpenBudgetGates(db)).toEqual([])
      const [run] = await listRuns(db)
      expect(run?.status).toBe('running')
    })
  })

  describe('grantOverage', () => {
    it('raises the cap the guard reads, for this month only', async () => {
      const settingsBefore = await getSettings(db)
      const before = await budgetStatus(db, 'anthropic', settingsBefore, { estimateUsd: 40 })
      expect(before.wouldRefuse).toBe(true)

      await grantOverage('anthropic', 25)

      const settingsAfter = await getSettings(db)
      expect(settingsAfter.budgets.approvedOverages.anthropic).toMatchObject({
        month: monthKey(new Date()),
        usd: 25,
      })

      const after = await budgetStatus(db, 'anthropic', settingsAfter, { estimateUsd: 40 })
      expect(after.budgetUsd).toBe(55)
      expect(after.wouldRefuse).toBe(false)
    })

    it('stamps when it was approved, because a raised cap is an audit trail', async () => {
      await grantOverage('anthropic', 5)
      const settings = await getSettings(db)
      expect(settings.budgets.approvedOverages.anthropic?.approvedAt).toBeTruthy()
    })

    it('does not apply to a different month', async () => {
      const march = new Date('2026-03-15T00:00:00.000Z')
      await grantOverage('anthropic', 25, march)

      const settings = await getSettings(db)
      const august = await budgetStatus(db, 'anthropic', settings, {
        now: new Date('2026-08-15T00:00:00.000Z'),
      })
      expect(august.budgetUsd).toBe(30)
    })
  })

  describe('markStageFailed', () => {
    it('puts the project into a state the rail can render', async () => {
      await markStageFailed(context(), { name: 'ValidationError', message: 'no sources' })
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
    })
  })
})
