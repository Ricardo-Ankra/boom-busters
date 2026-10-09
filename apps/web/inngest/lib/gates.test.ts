// @vitest-environment node

import {
  claimTake,
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  getSettings,
  getVoiceTake,
  listOpenBudgetGates,
  listProjectNotices,
  listRunEvents,
  listRuns,
  notices,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectStage,
  truncateRunMirror,
  updateSettings,
} from '@boom-busters/db'
import { budgetStatus, truncateLedger } from '@boom-busters/cost'
import { BudgetExceededError, monthKey, takeIdempotencyKey } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import {
  autoCloseReviewGate,
  budgetGateData,
  closeBudgetGate,
  closeReviewGate,
  grantOverage,
  markRetakeFailed,
  markSideJobFailed,
  markStageFailed,
  openBudgetGate,
  openReviewGate,
  slotSubject,
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

// The notification is the only part of a side job's stop that leaves the
// database; asserted here, not sent (decision 293).
const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))

const SLOT = '01J0000000000000000000000S'

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
      budgets: { monthlyCeilingUsd: 30, approvedOverage: null },
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

  /**
   * Exception-based gating: a clean stage closes its own gate. The project
   * must never pass through `awaiting_review` — the whole point is that
   * nothing needed the human — but the trail must read exactly as if the gate
   * had opened and been approved, because it was, by the same predicates.
   */
  describe('autoCloseReviewGate', () => {
    it('moves straight to the next stage without parking', async () => {
      await autoCloseReviewGate(context(), {
        stage: 'dossier',
        nextStage: 'script',
        summary: 'Dossier ready · 12 claims',
      })

      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project).toMatchObject({ stage: 'script', stageStatus: 'running' })

      // The run never parked: no awaiting_gate status was ever written.
      const [run] = await listRuns(db)
      expect(run?.status).not.toBe('awaiting_gate')
    })

    it('leaves the same opened-and-closed trail a manual approval would, marked auto', async () => {
      await autoCloseReviewGate(context(), {
        stage: 'dossier',
        nextStage: 'script',
        summary: 'Dossier ready · 12 claims',
      })

      const [run] = await listRuns(db)
      const events = await listRunEvents(db, run?.id as string)
      expect(events.map((event) => event.kind)).toEqual(['gate.opened', 'gate.closed'])

      const closed = events.find((event) => event.kind === 'gate.closed')
      expect(closed?.data).toMatchObject({ gate: 'dossier', auto: true })
      // The summary the human would have reviewed is still on the record.
      const opened = events.find((event) => event.kind === 'gate.opened')
      expect(opened?.message).toContain('12 claims')
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
    it('raises the ceiling the guard reads, for this month only', async () => {
      const settingsBefore = await getSettings(db)
      const before = await budgetStatus(db, settingsBefore, { estimateUsd: 40 })
      expect(before.wouldRefuse).toBe(true)

      await grantOverage(25)

      const settingsAfter = await getSettings(db)
      expect(settingsAfter.budgets.approvedOverage).toMatchObject({
        month: monthKey(new Date()),
        usd: 25,
      })

      const after = await budgetStatus(db, settingsAfter, { estimateUsd: 40 })
      expect(after.ceilingUsd).toBe(55)
      expect(after.wouldRefuse).toBe(false)
    })

    it('stamps when it was approved, because a raised ceiling is an audit trail', async () => {
      await grantOverage(5)
      const settings = await getSettings(db)
      expect(settings.budgets.approvedOverage?.approvedAt).toBeTruthy()
    })

    it('does not apply to a different month', async () => {
      const march = new Date('2026-03-15T00:00:00.000Z')
      await grantOverage(25, march)

      const settings = await getSettings(db)
      const august = await budgetStatus(db, settings, {
        now: new Date('2026-08-15T00:00:00.000Z'),
      })
      expect(august.ceilingUsd).toBe(30)
    })
  })

  describe('markStageFailed', () => {
    it('puts the project into a state the rail can render', async () => {
      await markStageFailed(context(), { name: 'ValidationError', message: 'no sources' })
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
    })
  })

  /**
   * Decision 219: a retake fails inside an OPEN review gate — the parked
   * runner never learns it happened, so the room must stay open. Marking the
   * stage failed here dead-ended a live project: the gate bar vanished,
   * approval became unreachable, and the later successful retake never
   * restored it.
   */
  describe('markRetakeFailed', () => {
    async function seededTake(): Promise<string> {
      const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
      const chapter = await saveChapter(db, {
        scriptId: script.id,
        index: 0,
        title: 'The audit',
        contentMd: 'One paragraph.',
        estRuntimeSec: 20,
      })
      const claimed = await claimTake(db, {
        projectId: FIXTURE_PROJECT_ID,
        chapterId: chapter.id,
        paragraphIndex: 0,
        idempotencyKey: takeIdempotencyKey({
          projectId: FIXTURE_PROJECT_ID,
          chapterId: chapter.id,
          paragraphIndex: 0,
          text: 'One paragraph.',
          voiceId: 'v-narrator',
        }),
        provider: 'elevenlabs',
        voiceId: 'v-narrator',
        builtFromScriptVersion: script.version,
      })
      return claimed.take.id
    }

    it('flags the row and leaves the open review room alone', async () => {
      const takeId = await seededTake()
      await setProjectStage(db, FIXTURE_PROJECT_ID, {
        stage: 'voice',
        stageStatus: 'awaiting_review',
      })

      await markRetakeFailed(context(), takeId, {
        message: 'elevenlabs rejected the API key (401). Check it in Settings → Connections.',
      })

      // The gate survives; the failure lives on the take, in words.
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
      const take = await getVoiceTake(db, takeId)
      expect(take?.status).toBe('flagged')
      expect(take?.note).toContain('Retake failed: elevenlabs rejected the API key')
    })

    it('escalates to the stage when no review room is open', async () => {
      const takeId = await seededTake()
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'voice', stageStatus: 'running' })

      await markRetakeFailed(context(), takeId, { message: 'storage is gone' })

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
    })
  })

  /**
   * Decision 234, the same rule for every side job: the slot re-fetcher and
   * re-typer also run inside a parked visuals review, and their failures must
   * not tear it down either. Decision 293: while parked, the reason lands as a
   * `stopped` notice on the card it concerns, because the notification alone
   * reached only a server log (production sends no email).
   */
  describe('markSideJobFailed', () => {
    // Written for real here; none may outlive the test, since the e2e suite
    // shares this database and would find them on its cards.
    beforeEach(async () => {
      await db.delete(notices)
      notify.mockClear()
    })
    afterEach(async () => {
      await db.delete(notices)
    })

    it('leaves the open review room alone, and says why on the project strip and in a notification', async () => {
      await setProjectStage(db, FIXTURE_PROJECT_ID, {
        stage: 'visuals',
        stageStatus: 'awaiting_review',
      })

      await markSideJobFailed(context(), 'The slot re-fetch stopped', {
        message: 'pexels rejected the API key (401).',
      })

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
      expect(await listProjectNotices(db, FIXTURE_PROJECT_ID)).toEqual([
        expect.objectContaining({
          subject: 'project',
          subjectId: null,
          kind: 'stopped',
          message: 'The slot re-fetch stopped: pexels rejected the API key (401).',
        }),
      ])
      expect(notify).toHaveBeenCalledWith({
        kind: 'run-failed',
        title: 'The slot re-fetch stopped',
        body: 'pexels rejected the API key (401).',
        href: `/projects/${FIXTURE_PROJECT_ID}`,
      })
    })

    it('writes the notice on the card it names: a slot, or the Direction card', async () => {
      await setProjectStage(db, FIXTURE_PROJECT_ID, {
        stage: 'visuals',
        stageStatus: 'awaiting_review',
      })

      await markSideJobFailed(
        context(),
        'The re-type stopped',
        { message: 'over budget' },
        slotSubject(SLOT),
      )
      await markSideJobFailed(
        context(),
        'The redraft stopped',
        { message: 'cut off' },
        { subject: 'direction' },
      )

      const listed = (await listProjectNotices(db, FIXTURE_PROJECT_ID)).map(
        ({ subject, subjectId, message }) => ({ subject, subjectId, message }),
      )
      expect(listed).toHaveLength(2)
      expect(listed).toEqual(
        expect.arrayContaining([
          { subject: 'slot', subjectId: SLOT, message: 'The re-type stopped: over budget' },
          { subject: 'direction', subjectId: null, message: 'The redraft stopped: cut off' },
        ]),
      )
    })

    it('reads a slot side job with no slot id as the project', () => {
      expect(slotSubject(undefined)).toBeUndefined()
      expect(slotSubject(42)).toBeUndefined()
      expect(slotSubject(SLOT)).toEqual({ subject: 'slot', subjectId: SLOT })
    })

    it('escalates to the stage, and writes no notice, when no review room is open', async () => {
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'running' })

      await markSideJobFailed(
        context(),
        'The slot re-fetch stopped',
        { message: 'storage is gone' },
        slotSubject(SLOT),
      )

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
      expect(await listProjectNotices(db, FIXTURE_PROJECT_ID)).toEqual([])
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'run-failed',
          title: 'A run failed',
          body: 'storage is gone',
        }),
      )
    })
  })

  describe('budgetGateData', () => {
    it('carries the failure in words, to the cent', () => {
      const data = budgetGateData(
        new BudgetExceededError({
          provider: 'pexels',
          operation: 'stock-search',
          budgetUsd: 30,
          monthSpendUsd: 29.5,
          estimateUsd: 1.2345,
        }),
      )
      expect(String(data['message'])).toBe(
        'The monthly spend ceiling would be crossed by pexels stock-search: ' +
          '$29.50 spent + $1.2345 estimated > $30.00 ceiling.',
      )
    })
  })
})
