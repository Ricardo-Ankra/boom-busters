import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, type Database } from './client'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { createCase } from './cases'
import { createChannel, getChannelBySlug } from './channels'
import { FIXTURE_PROJECT_ID } from './fixtures'
import {
  createProjectFromCase,
  getProject,
  listProjects,
  listProjectsAwaitingReview,
  markProjectCancelled,
  nextStage,
  setProjectStage,
} from './projects'
import {
  cancelRunsForProject,
  ensureRun,
  hasLiveRun,
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

      const active = await listActiveRuns(db, FIRST_CHANNEL_ID)
      expect(active).toHaveLength(1)
      expect(active[0]?.currentStep).toBe('gather-sources')
      expect((await listActiveRuns(db, FIRST_CHANNEL_ID)).length).toBe(1)
    })

    it('does not count a run parked at a gate as active', async () => {
      // A run waiting three days on a human is not "running"; counting it
      // would make the top bar's pulsing dot mean nothing.
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0008',
        functionName: 'demo-runner',
      })
      await setRunStatus(db, runId, 'awaiting_gate')
      expect((await listActiveRuns(db, FIRST_CHANNEL_ID)).length).toBe(0)
    })

    it('can leave the asking run out of whether the project has a live run', async () => {
      // A stretch re-plan asks whether the fetch pass runs; its own mirrored
      // run must not answer yes.
      await ensureRun(db, {
        inngestRunId: '01JRUN0010',
        functionName: 'stretch-replanner',
        projectId: FIXTURE_PROJECT_ID,
      })
      expect(await hasLiveRun(db, FIXTURE_PROJECT_ID)).toBe(true)
      expect(await hasLiveRun(db, FIXTURE_PROJECT_ID, { exceptInngestRunId: '01JRUN0010' })).toBe(
        false,
      )
      await ensureRun(db, {
        inngestRunId: '01JRUN0011',
        functionName: 'visuals-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      expect(await hasLiveRun(db, FIXTURE_PROJECT_ID, { exceptInngestRunId: '01JRUN0010' })).toBe(
        true,
      )
    })

    it('does not count finished runs', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0009',
        functionName: 'demo-runner',
      })
      await setRunStatus(db, runId, 'completed')
      expect((await listActiveRuns(db, FIRST_CHANNEL_ID)).length).toBe(0)
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
      // What `markStageFailed` always does alongside the run: in production a
      // failed run and a failed project stage arrive together.
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'failed' })

      const [failed] = await listFailedRuns(db, FIRST_CHANNEL_ID)
      expect(failed?.error).toMatchObject({ name: 'ValidationError' })
      expect(failed?.completedAt).toBeInstanceOf(Date)
      expect(failed?.projectTitle).toBeTruthy()
    })

    /**
     * The queue must be emptiable. A failure whose project has since been
     * re-run (its stageStatus cleared) used to sit on the Needs-you queue
     * forever; acting on the project now retires the card.
     */
    it('drops a failure once its project has moved on', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0012',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
        stage: 'dossier',
      })
      await setRunStatus(db, runId, 'failed', { name: 'ValidationError', message: 'no sources' })
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'failed' })
      expect(await listFailedRuns(db, FIRST_CHANNEL_ID)).toHaveLength(1)

      // The human pressed re-run: the stage is queued again.
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'queued' })
      expect(await listFailedRuns(db, FIRST_CHANNEL_ID)).toHaveLength(0)
    })

    /**
     * Decision 304: a job with no project has no stage to clear. Six daily
     * analytics failures stayed on the queue through five weeks of daily
     * successes; a later success of the same job now retires them.
     */
    it('drops a project-less failure once a later run of the same job completes', async () => {
      const failedAt = new Date('2026-09-05T06:03:00Z')
      const failed = await ensureRun(db, {
        inngestRunId: '01JRUN0013',
        functionName: 'analytics-runner',
      })
      await setRunStatus(db, failed, 'failed', { message: 'YouTube Analytics API disabled' })
      await db.update(runs).set({ completedAt: failedAt }).where(eq(runs.id, failed))
      // Another job's success does not retire it.
      const other = await ensureRun(db, { inngestRunId: '01JRUN0014', functionName: 'cron-sweep' })
      await setRunStatus(db, other, 'completed')
      expect((await listFailedRuns(db, FIRST_CHANNEL_ID)).map((run) => run.id)).toEqual([failed])

      const later = await ensureRun(db, {
        inngestRunId: '01JRUN0015',
        functionName: 'analytics-runner',
      })
      await setRunStatus(db, later, 'completed')
      expect(await listFailedRuns(db, FIRST_CHANNEL_ID)).toHaveLength(0)
    })

    it('keeps a project-less failure that is newer than the last success', async () => {
      const success = await ensureRun(db, {
        inngestRunId: '01JRUN0016',
        functionName: 'analytics-runner',
      })
      await setRunStatus(db, success, 'completed')
      await db
        .update(runs)
        .set({ completedAt: new Date('2026-09-04T06:00:00Z') })
        .where(eq(runs.id, success))
      const failed = await ensureRun(db, {
        inngestRunId: '01JRUN0017',
        functionName: 'analytics-runner',
      })
      await setRunStatus(db, failed, 'failed', { message: 'still broken' })
      expect((await listFailedRuns(db, FIRST_CHANNEL_ID)).map((run) => run.id)).toEqual([failed])
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

      const [gate] = await listOpenBudgetGates(db, FIRST_CHANNEL_ID)
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

      expect(await listOpenBudgetGates(db, FIRST_CHANNEL_ID)).toEqual([])
    })

    it('ignores a review gate — those live on the project, not the run', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JRUN0013',
        functionName: 'demo-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await recordRunEvent(db, { runId, kind: 'gate.opened', data: { gate: 'dossier' } })
      await setRunStatus(db, runId, 'awaiting_gate')

      expect(await listOpenBudgetGates(db, FIRST_CHANNEL_ID)).toEqual([])
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
      expect((await listActiveRuns(db, FIRST_CHANNEL_ID)).length).toBe(0)
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

  describe('two channels', () => {
    let otherChannelId = ''
    let otherProjectId = ''
    let otherCaseId = ''

    beforeEach(async () => {
      const existing = await getChannelBySlug(db, 'second-test')
      const other =
        existing ??
        (await createChannel(db, {
          name: 'Second test channel',
          handle: null,
          slug: 'second-test',
          settings: DEFAULT_SETTINGS,
          bible: EMPTY_BIBLE,
        }))
      otherChannelId = other.id
      const madeCase = await createCase(db, {
        channelId: otherChannelId,
        title: `Run isolation ${Date.now()}`,
        category: 'con',
      })
      otherCaseId = madeCase.id
      otherProjectId = (await createProjectFromCase(db, { caseId: madeCase.id, title: 'On B' })).id
    })

    afterEach(async () => {
      // Leaves the shared database as found.
      await db.execute(sql`delete from projects where case_id = ${otherCaseId}`)
      await db.execute(sql`delete from cases where id = ${otherCaseId}`)
    })

    it('stamps a project run with the project channel, whatever the identity says', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JCHAN0001',
        functionName: 'demo-runner',
        projectId: otherProjectId,
        channelId: FIRST_CHANNEL_ID,
      })
      const [row] = await db.select().from(runs).where(eq(runs.id, runId))
      expect(row?.channelId).toBe(otherChannelId)
    })

    it('takes the identity channel for a run with no project, and null for a cron run', async () => {
      const named = await ensureRun(db, {
        inngestRunId: '01JCHAN0002',
        functionName: 'demo-runner',
        channelId: otherChannelId,
      })
      const cron = await ensureRun(db, { inngestRunId: '01JCHAN0003', functionName: 'cron' })
      const rows = await db.select().from(runs)
      expect(rows.find((row) => row.id === named)?.channelId).toBe(otherChannelId)
      expect(rows.find((row) => row.id === cron)?.channelId).toBeNull()
    })

    it('lists a run for a project on B under B and never under A', async () => {
      const runId = await ensureRun(db, {
        inngestRunId: '01JCHAN0004',
        functionName: 'demo-runner',
        projectId: otherProjectId,
      })
      await recordRunEvent(db, { runId, kind: 'step.started', stepId: 'gather-sources' })

      expect((await listActiveRuns(db, otherChannelId)).map((run) => run.id)).toEqual([runId])
      expect(await listActiveRuns(db, FIRST_CHANNEL_ID)).toEqual([])
      expect(
        (await listActivity(db, { channelId: otherChannelId })).map((entry) => entry.runId),
      ).toEqual([runId])
      expect(await listActivity(db, { channelId: FIRST_CHANNEL_ID })).toEqual([])
      // No channel asked for: the whole console, as before.
      expect(await listActivity(db)).toHaveLength(1)
    })

    it('scopes failed runs and budget gates by channel', async () => {
      const failed = await ensureRun(db, {
        inngestRunId: '01JCHAN0005',
        functionName: 'script-runner',
        projectId: otherProjectId,
      })
      await setRunStatus(db, failed, 'failed')
      await db.execute(
        sql`update projects set stage_status = 'failed' where id = ${otherProjectId}`,
      )

      const parked = await ensureRun(db, {
        inngestRunId: '01JCHAN0006',
        functionName: 'script-runner',
        projectId: otherProjectId,
      })
      await recordRunEvent(db, {
        runId: parked,
        kind: 'gate.opened',
        data: { gate: 'budget', provider: 'anthropic', operation: 'scripting' },
      })
      await setRunStatus(db, parked, 'awaiting_gate')

      expect((await listFailedRuns(db, otherChannelId)).map((run) => run.id)).toEqual([failed])
      expect(await listFailedRuns(db, FIRST_CHANNEL_ID)).toEqual([])
      expect((await listOpenBudgetGates(db, otherChannelId)).map((gate) => gate.runId)).toEqual([
        parked,
      ])
      expect(await listOpenBudgetGates(db, FIRST_CHANNEL_ID)).toEqual([])
    })

    it('shows a cron run with no channel under both channels', async () => {
      const cron = await ensureRun(db, { inngestRunId: '01JCHAN0007', functionName: 'cron' })
      await recordRunEvent(db, { runId: cron, kind: 'run.started' })
      const failedCron = await ensureRun(db, { inngestRunId: '01JCHAN0008', functionName: 'cron2' })
      await setRunStatus(db, failedCron, 'failed')

      for (const channelId of [FIRST_CHANNEL_ID, otherChannelId]) {
        expect((await listActiveRuns(db, channelId)).map((run) => run.id)).toEqual([cron])
        expect((await listActivity(db, { channelId })).map((entry) => entry.runId)).toEqual([cron])
        expect((await listFailedRuns(db, channelId)).map((run) => run.id)).toEqual([failedCron])
      }
    })
  })

  describe('projects', () => {
    it('lists projects with their case', async () => {
      const [project] = await listProjects(db, FIRST_CHANNEL_ID)
      expect(project?.id).toBe(FIXTURE_PROJECT_ID)
      expect(project?.caseTitle).toBeTruthy()
      expect(project?.caseCategory).toBeTruthy()
    })

    it('treats awaiting_review as the open gate', async () => {
      expect(await listProjectsAwaitingReview(db, FIRST_CHANNEL_ID)).toHaveLength(1)

      await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'running' })
      expect(await listProjectsAwaitingReview(db, FIRST_CHANNEL_ID)).toEqual([])
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
