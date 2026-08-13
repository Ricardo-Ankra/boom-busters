import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from './client'
import { FIXTURE_PROJECT_ID } from './fixtures'
import {
  getProject,
  listProjects,
  listProjectsAwaitingReview,
  markProjectCancelled,
  nextStage,
  setProjectStage,
} from './projects'
import {
  cancelRunsForProject,
  countActiveRuns,
  ensureRun,
  listActiveRuns,
  listActivity,
  listFailedRuns,
  listOpenBudgetGates,
  listRunEvents,
  recordRunEvent,
  setRunStatus,
} from './runs'
import { runEvents, runs } from './schema'
import { seed } from './seed'
import { requireTestDatabase } from './test-database'

const DATABASE_URL = requireTestDatabase()
const describeDb = DATABASE_URL ? describe : describe.skip

describeDb('run mirror', () => {
  let connection: ReturnType<typeof createDb>
  let db: Database

  beforeAll(async () => {
    connection = createDb(DATABASE_URL as string, { max: 2 })
    db = connection.db
    await seed(db)
  })

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ${runEvents}, ${runs} RESTART IDENTITY CASCADE`)
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'dossier',
      stageStatus: 'awaiting_review',
    })
  })

  describe('ensureRun', () => {
    it('creates one mirror row per Inngest run', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0001',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
        stage: 'dossier',
      })
      expect(runId).toBeTruthy()
      expect(await db.select().from(runs)).toHaveLength(1)
    })

    it('is idempotent — step hooks arrive in no guaranteed order', async () => {
      const identity = { inngestRunId: '01JRUN0002', functionName: 'demo-runner' }
      const first = await ensureRun(db, identity)
      const second = await ensureRun(db, identity)

      expect(second).toBe(first)
      expect(await db.select().from(runs)).toHaveLength(1)
    })
  })

  describe('activity feed', () => {
    it('returns newest first and carries the project title', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0003',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
        stage: 'dossier',
      })
      await recordRunEvent(db, {
        runId,
        kind: 'run.started',
        occurredAt: new Date('2026-03-01T10:00:00Z'),
      })
      await recordRunEvent(db, {
        runId,
        kind: 'step.completed',
        stepId: 'research',
        message: 'Case brief written',
        occurredAt: new Date('2026-03-01T10:01:00Z'),
      })

      const activity = await listActivity(db)
      expect(activity.map((entry) => entry.kind)).toEqual(['step.completed', 'run.started'])
      expect(activity[0]?.projectTitle).toBeTruthy()
      expect(activity[0]?.message).toBe('Case brief written')
    })

    it('scopes to one project when the drawer is opened inside it', async () => {
      const mine = await ensureRun(db, {
        inngestRunId: '01JRUN0004',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      const other = await ensureRun(db, {
        inngestRunId: '01JRUN0005',
        functionName: 'demo-runner',
        projectId: null,
      })
      await recordRunEvent(db, { runId: mine, kind: 'run.started' })
      await recordRunEvent(db, { runId: other, kind: 'run.started' })

      expect(await listActivity(db)).toHaveLength(2)
      expect(await listActivity(db, { projectId: FIXTURE_PROJECT_ID })).toHaveLength(1)
    })

    it('keeps the events of a run in the order they happened', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0006',
        functionName: 'demo-runner',
      })
      for (const [index, kind] of (
        ['run.started', 'step.started', 'step.completed'] as const
      ).entries()) {
        await recordRunEvent(db, {
          runId,
          kind,
          occurredAt: new Date(Date.UTC(2026, 2, 1, 10, index)),
        })
      }
      expect((await listRunEvents(db, runId)).map((e) => e.kind)).toEqual([
        'run.started',
        'step.started',
        'step.completed',
      ])
    })
  })

  describe('active runs', () => {
    it('counts what is executing, and shows the step it is on', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0007',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await recordRunEvent(db, { runId, kind: 'step.started', stepId: 'gather-sources' })

      const active = await listActiveRuns(db)
      expect(active).toHaveLength(1)
      expect(active[0]?.currentStep).toBe('gather-sources')
      expect(await countActiveRuns(db)).toBe(1)
    })

    it('does not count a run parked at a gate as active', async () => {
      // A run waiting three days on a human is not "running"; counting it
      // would make the top bar's pulsing dot mean nothing.
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0008',
        functionName: 'demo-runner',
      })
      await setRunStatus(db, runId, 'awaiting_gate')
      expect(await countActiveRuns(db)).toBe(0)
    })

    it('does not count finished runs', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0009',
        functionName: 'demo-runner',
      })
      await setRunStatus(db, runId, 'completed')
      expect(await countActiveRuns(db)).toBe(0)
    })
  })

  describe('failures', () => {
    it('stamps a completion time and keeps the serialised error', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0010',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
        stage: 'dossier',
      })
      await setRunStatus(db, runId, 'failed', { name: 'ValidationError', message: 'no sources' })

      const [failed] = await listFailedRuns(db)
      expect(failed?.error).toMatchObject({ name: 'ValidationError' })
      expect(failed?.completedAt).toBeInstanceOf(Date)
      expect(failed?.projectTitle).toBeTruthy()
    })
  })

  describe('budget gates', () => {
    const gateData = {
      gate: 'budget',
      provider: 'anthropic',
      operation: 'scripting',
      budgetUsd: 30,
      monthSpendUsd: 29.8,
      estimateUsd: 0.45,
    }

    it('surfaces a parked run with the numbers the card needs', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0011',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await recordRunEvent(db, { runId, kind: 'gate.opened', data: gateData })
      await setRunStatus(db, runId, 'awaiting_gate')

      const [gate] = await listOpenBudgetGates(db)
      expect(gate).toMatchObject({ provider: 'anthropic', budgetUsd: 30, estimateUsd: 0.45 })
      expect(gate?.projectTitle).toBeTruthy()
    })

    it('drops off the queue once the gate closes', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0012',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await recordRunEvent(db, {
        runId,
        kind: 'gate.opened',
        data: gateData,
        occurredAt: new Date('2026-03-01T10:00:00Z'),
      })
      await setRunStatus(db, runId, 'awaiting_gate')
      await recordRunEvent(db, {
        runId,
        kind: 'gate.closed',
        data: { gate: 'budget' },
        occurredAt: new Date('2026-03-01T10:05:00Z'),
      })
      await setRunStatus(db, runId, 'running')

      expect(await listOpenBudgetGates(db)).toEqual([])
    })

    it('ignores a review gate — those live on the project, not the run', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0013',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await recordRunEvent(db, { runId, kind: 'gate.opened', data: { gate: 'dossier' } })
      await setRunStatus(db, runId, 'awaiting_gate')

      expect(await listOpenBudgetGates(db)).toEqual([])
    })
  })

  describe('cancellation', () => {
    it('closes running and parked runs, and records why', async () => {
      const running = await ensureRun(db, {
        inngestRunId: '01JRUN0014',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      const parked = await ensureRun(db, {
        inngestRunId: '01JRUN0015',
        functionName: 'voice-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await setRunStatus(db, parked, 'awaiting_gate')

      expect(await cancelRunsForProject(db, FIXTURE_PROJECT_ID)).toBe(2)
      expect(await countActiveRuns(db)).toBe(0)
      expect((await listRunEvents(db, running)).map((e) => e.kind)).toContain('run.cancelled')
    })

    it('leaves already-finished runs alone', async () => {
      const done = await ensureRun(db, {
        inngestRunId: '01JRUN0016',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await setRunStatus(db, done, 'completed')

      expect(await cancelRunsForProject(db, FIXTURE_PROJECT_ID)).toBe(0)
    })
  })

  describe('projects', () => {
    it('lists projects with their case', async () => {
      const [project] = await listProjects(db)
      expect(project?.id).toBe(FIXTURE_PROJECT_ID)
      expect(project?.caseTitle).toBeTruthy()
      expect(project?.caseCategory).toBeTruthy()
    })

    it('treats awaiting_review as the open gate', async () => {
      expect(await listProjectsAwaitingReview(db)).toHaveLength(1)

      await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'running' })
      expect(await listProjectsAwaitingReview(db)).toEqual([])
    })

    it('advances the stage and clears the gate together', async () => {
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'script', stageStatus: 'running' })
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project).toMatchObject({ stage: 'script', stageStatus: 'running' })
    })

    it('stamps cancelledAt so the UI can say when it stopped', async () => {
      await markProjectCancelled(db, FIXTURE_PROJECT_ID)
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project?.stageStatus).toBe('cancelled')
      expect(project?.cancelledAt).toBeInstanceOf(Date)
    })
  })
})

describe('nextStage', () => {
  it('walks the rail in the order the spec lists', () => {
    expect(nextStage('dossier')).toBe('script')
    expect(nextStage('visuals')).toBe('assembly')
    expect(nextStage('publish')).toBe('done')
  })

  it('stops at the end rather than wrapping', () => {
    expect(nextStage('done')).toBeNull()
  })
})
