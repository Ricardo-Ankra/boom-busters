// @vitest-environment node

import {
  ensureRun,
  getRunByInngestId,
  listRunEvents,
  requireTestDatabase,
  seed,
  setRunStatus,
  truncateRunMirror,
} from '@boom-busters/db'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { failureMirror } from './failure-mirror'

/**
 * A run whose last attempt was killed (a step past the 300-second limit)
 * never reaches the mirror's `onRunError` hook, so `inngest/function.failed`
 * is what closes its row. A row the hook already closed is left as it is.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

function failedEvent(
  runId: string,
  extra: Record<string, unknown> = {},
): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'inngest/function.failed',
      data: {
        run_id: runId,
        function_id: 'boom-busters-bible-drafter',
        error: {
          name: 'Error',
          message: 'Your server returned HTTP 504 before the SDK responded.',
        },
        event: { name: 'bible/draft.requested', data: {} },
        ...extra,
      },
    },
  ]
}

let counter = 0
function freshInngestRunId(): string {
  counter += 1
  return `01JFAILED${String(counter).padStart(17, '0')}`
}

describeDb('failure-mirror', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: failureMirror })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
  })

  it('closes a row still marked running, with the reason in words', async () => {
    const inngestRunId = freshInngestRunId()
    const rowId = await ensureRun(db, { inngestRunId, functionName: 'bible-drafter' })

    const { result } = await engine.execute({ events: failedEvent(inngestRunId) })

    expect(result).toMatchObject({ outcome: 'closed' })
    const run = await getRunByInngestId(db, inngestRunId)
    expect(run?.status).toBe('failed')
    expect(run?.completedAt).toBeInstanceOf(Date)
    expect(run?.error).toMatchObject({ message: expect.stringContaining('HTTP 504') })
    const failed = (await listRunEvents(db, rowId)).filter((e) => e.kind === 'run.failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.message).toContain('HTTP 504')
  })

  it('closes a row parked at a gate the same way', async () => {
    const inngestRunId = freshInngestRunId()
    const rowId = await ensureRun(db, { inngestRunId, functionName: 'voice-runner' })
    await setRunStatus(db, rowId, 'awaiting_gate')

    await engine.execute({ events: failedEvent(inngestRunId) })

    expect((await getRunByInngestId(db, inngestRunId))?.status).toBe('failed')
  })

  it('leaves a row the run mirror already closed alone', async () => {
    const inngestRunId = freshInngestRunId()
    const rowId = await ensureRun(db, { inngestRunId, functionName: 'script-runner' })
    await setRunStatus(db, rowId, 'failed', { message: 'the hook saw it first' })

    const { result } = await engine.execute({ events: failedEvent(inngestRunId) })

    expect(result).toMatchObject({ outcome: 'already-closed' })
    expect((await getRunByInngestId(db, inngestRunId))?.error).toEqual({
      message: 'the hook saw it first',
    })
    expect(await listRunEvents(db, rowId)).toEqual([])
  })

  it('names a failure with no message, and ignores an unknown run', async () => {
    const inngestRunId = freshInngestRunId()
    await ensureRun(db, { inngestRunId, functionName: 'bible-drafter' })
    await engine.execute({ events: failedEvent(inngestRunId, { error: {} }) })
    expect((await getRunByInngestId(db, inngestRunId))?.status).toBe('failed')

    // A fresh engine: one engine replays its earlier step results.
    const { result } = await new InngestTestEngine({ function: failureMirror }).execute({
      events: failedEvent('01JNOSUCHRUN0000000000000'),
    })
    expect(result).toMatchObject({ outcome: 'unknown-run' })
  })

  it('does nothing for its own failure, so a failing pass cannot start the next', async () => {
    const inngestRunId = freshInngestRunId()
    await ensureRun(db, { inngestRunId, functionName: 'failure-mirror' })

    const { result } = await engine.execute({
      events: failedEvent(inngestRunId, { function_id: 'boom-busters-failure-mirror' }),
    })

    expect(result).toMatchObject({ outcome: 'own-failure' })
    expect((await getRunByInngestId(db, inngestRunId))?.status).toBe('running')
  })
})
