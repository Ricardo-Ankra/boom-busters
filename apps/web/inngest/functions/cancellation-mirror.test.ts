// @vitest-environment node

import {
  ensureRun,
  FIXTURE_PROJECT_ID,
  getProject,
  getRunByInngestId,
  listRunEvents,
  requireTestDatabase,
  seed,
  setProjectStage,
  setRunStatus,
  truncateRunMirror,
} from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { cancellationMirror } from './cancellation-mirror'

/**
 * The outside-cancellation reconciler (decision 235): a run cancelled from
 * the Inngest dashboard must close its mirror row, and a dashboard-cancelled
 * STAGE runner must also stop the rail claiming progress. The app's own Stop
 * arrives here too, after its sweep already closed everything — so the other
 * half of the contract is doing nothing twice.
 */

const notify = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notify', () => ({ notify }))

const describeDb = requireTestDatabase() ? describe : describe.skip

function cancelledEvent(runId: string): [{ name: string; data: Record<string, unknown> }] {
  return [{ name: 'inngest/function.cancelled', data: { run_id: runId, function_id: 'x' } }]
}

let counter = 0
function freshInngestRunId(): string {
  counter += 1
  return `01JCANCEL${String(counter).padStart(17, '0')}`
}

describeDb('cancellation-mirror', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: cancellationMirror })
    vi.clearAllMocks()
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  it('closes a live mirror row and records the cancellation in words', async () => {
    const inngestRunId = freshInngestRunId()
    const rowId = await ensureRun(db, {
      inngestRunId,
      functionName: 'voice-retaker',
      projectId: FIXTURE_PROJECT_ID,
      stage: null,
    })
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'voice',
      stageStatus: 'awaiting_review',
    })

    const { result } = await engine.execute({ events: cancelledEvent(inngestRunId) })

    expect(result).toMatchObject({ outcome: 'closed' })
    expect((await getRunByInngestId(db, inngestRunId))?.status).toBe('cancelled')
    const events = await listRunEvents(db, rowId)
    const cancelled = events.find((event) => event.kind === 'run.cancelled')
    expect(cancelled?.message).toContain('outside the app')

    // A side job's cancellation never touches the stage (decisions 219, 234).
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
    expect(notify).not.toHaveBeenCalled()
  })

  it('marks a running stage failed when its own runner was the cancelled run', async () => {
    const inngestRunId = freshInngestRunId()
    await ensureRun(db, {
      inngestRunId,
      functionName: 'script-runner',
      projectId: FIXTURE_PROJECT_ID,
      stage: 'script',
    })
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'script', stageStatus: 'running' })

    const { result } = await engine.execute({ events: cancelledEvent(inngestRunId) })

    expect(result).toMatchObject({ outcome: 'closed' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A run was cancelled outside the app' }),
    )
  })

  it('does nothing twice: a row the Stop sweep already closed stays as it was', async () => {
    const inngestRunId = freshInngestRunId()
    const rowId = await ensureRun(db, {
      inngestRunId,
      functionName: 'script-runner',
      projectId: FIXTURE_PROJECT_ID,
      stage: 'script',
    })
    await setRunStatus(db, rowId, 'cancelled')
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'script', stageStatus: 'running' })

    const { result } = await engine.execute({ events: cancelledEvent(inngestRunId) })

    expect(result).toMatchObject({ outcome: 'already-closed' })
    // No second run.cancelled event, no stage change, no notification.
    const events = await listRunEvents(db, rowId)
    expect(events.filter((event) => event.kind === 'run.cancelled')).toHaveLength(0)
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('running')
    expect(notify).not.toHaveBeenCalled()
  })

  it('shrugs at a run the mirror never saw', async () => {
    const { result } = await engine.execute({ events: cancelledEvent(freshInngestRunId()) })
    expect(result).toMatchObject({ outcome: 'unknown-run' })
  })
})
