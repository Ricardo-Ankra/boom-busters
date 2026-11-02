// @vitest-environment node

import {
  approvedTalkingPointSet,
  ensureRun,
  FIXTURE_PROJECT_ID,
  getProject,
  insertTalkingPointSet,
  latestTalkingPointSet,
  requireTestDatabase,
  runs,
  seed,
  setProjectStage,
  setRunStatus,
  talkingPointSets,
} from '@boom-busters/db'
import type * as Db from '@boom-busters/db'
import type { TalkingPoint } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  addTalkingPoint,
  approveTalkingPoints,
  redoTalkingPoint,
  redoTalkingPoints,
  removeTalkingPoint,
} from './talking-points-actions'

/**
 * The Talking points actions against the test database, with only the seams a
 * server action cannot bring to a unit test (session, cache revalidation, the
 * Inngest client) replaced. The runner queues per project, so the live-run
 * refusal here is the only guard against a second paid call.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// The real helpers, with the stamp wrapped so a test can land a removal's new
// version between the stamp and the read, as a race would.
const afterStamp = vi.hoisted(() => ({ run: null as null | (() => Promise<void>) }))
vi.mock('@boom-busters/db', async (importOriginal) => {
  const actual = await importOriginal<typeof Db>()
  return {
    ...actual,
    approveTalkingPointSet: async (...args: Parameters<typeof actual.approveTalkingPointSet>) => {
      const outcome = await actual.approveTalkingPointSet(...args)
      await afterStamp.run?.()
      return outcome
    },
  }
})

const send = vi.hoisted(() => vi.fn())
vi.mock('@/inngest/client', () => ({ inngest: { send } }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const ids = [
  '01HQ0000000000000000000P01',
  '01HQ0000000000000000000P02',
  '01HQ0000000000000000000P03',
  '01HQ0000000000000000000P04',
  '01HQ0000000000000000000P05',
]

const point = (n: number): TalkingPoint => ({
  id: ids[n - 1]!,
  type: n % 2 === 0 ? 'contrarian-thesis' : 'forensic-breakdown',
  title: `Point ${n} title`,
  question: `What did the auditors miss in year ${n}?`,
  payoff: 'They never tested the cash balances at all.',
  bridge: 'The long film walks through how that unravelled.',
  bridgeChapters: [1],
  sourceChapters: [0],
  hook: 'Nobody checked the one number that mattered.',
  order: n,
})

async function propose(count: number, note: string | null = null) {
  return insertTalkingPointSet(db, {
    projectId: FIXTURE_PROJECT_ID,
    scriptVersion: 1,
    points: Array.from({ length: count }, (_, i) => point(i + 1)),
    note,
  })
}

async function parkAtPoints() {
  await setProjectStage(db, FIXTURE_PROJECT_ID, {
    stage: 'shorts',
    stageStatus: 'awaiting_review',
    shortsPhase: 'points',
  })
}

let runCounter = 0
async function liveRunner() {
  runCounter += 1
  await ensureRun(db, {
    inngestRunId: `01JTPRUN${String(runCounter).padStart(4, '0')}`,
    functionName: 'talking-points-runner',
    projectId: FIXTURE_PROJECT_ID,
  })
}

describeDb('talking points actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    send.mockResolvedValue(undefined)
    await seed(db)
    await db.delete(talkingPointSets)
    await db.delete(runs)
    await parkAtPoints()
    afterStamp.run = null
  })

  describe('approveTalkingPoints', () => {
    it('stamps the version, enters review and sends one build event per point', async () => {
      await propose(3)

      const result = await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)

      expect(result).toEqual({ ok: true })
      expect((await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project?.shortsPhase).toBe('review')
      expect(project?.stageStatus).toBe('running')
      const sent = send.mock.calls.flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]]))
      expect(sent).toHaveLength(3)
      expect(sent.map((event) => event.name)).toEqual(Array(3).fill('shorts/point.build.requested'))
      expect(sent.map((event) => event.data.pointId)).toEqual(ids.slice(0, 3))
      expect(sent.every((event) => event.data.projectId === FIXTURE_PROJECT_ID)).toBe(true)
    })

    it('two approvals one after the other send the N builds once', async () => {
      await propose(3)

      const first = await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)
      const second = await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)

      expect(first).toEqual({ ok: true })
      expect(second.ok).toBe(false)
      const sent = send.mock.calls.flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]]))
      expect(sent).toHaveLength(3)
    })

    it('two approvals pressed together send the N builds once', async () => {
      await propose(3)

      const results = await Promise.all([
        approveTalkingPoints(FIXTURE_PROJECT_ID, 1),
        approveTalkingPoints(FIXTURE_PROJECT_ID, 1),
      ])

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      const sent = send.mock.calls.flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]]))
      expect(sent).toHaveLength(3)
    })

    it('refuses version 2 once version 3 has landed, and sends nothing', async () => {
      await propose(3)
      await propose(3)
      await propose(4)

      const result = await approveTalkingPoints(FIXTURE_PROJECT_ID, 2)

      expect(result).toEqual({
        ok: false,
        error: 'A newer set of talking points exists. Review it before approving.',
      })
      expect(await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID)).toBeUndefined()
      expect(send).not.toHaveBeenCalled()
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project?.shortsPhase).toBe('points')
      expect(project?.stageStatus).toBe('awaiting_review')
    })

    it('refuses a version that does not exist', async () => {
      await propose(3)

      const result = await approveTalkingPoints(FIXTURE_PROJECT_ID, 7)

      expect(result.ok).toBe(false)
      expect(send).not.toHaveBeenCalled()
    })

    it('refuses while the points are being redone', async () => {
      await propose(3)
      await liveRunner()

      const result = await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)

      expect(result).toEqual({
        ok: false,
        error: 'Talking points are being redone. Approve once the new set appears.',
      })
      expect(await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID)).toBeUndefined()
      expect(send).not.toHaveBeenCalled()
    })

    it('puts the stage back at points when Inngest cannot be reached', async () => {
      await propose(3)
      send.mockRejectedValueOnce(new Error('no inngest'))

      const result = await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)

      expect(result.ok).toBe(false)
      expect(result.error).toContain('Inngest')
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project?.shortsPhase).toBe('points')
      expect(project?.stageStatus).toBe('awaiting_review')
    })
  })

  describe('what an approval builds', () => {
    it('sends builds for the version it stamped, not a newer one that landed after', async () => {
      await propose(3)
      afterStamp.run = async () => {
        await propose(5)
      }

      expect(await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)).toEqual({ ok: true })

      const sent = send.mock.calls.flatMap((call) => (Array.isArray(call[0]) ? call[0] : [call[0]]))
      expect(sent.map((event) => event.data.pointId)).toEqual(ids.slice(0, 3))
    })

    it('takes the approval back when the builds cannot be sent', async () => {
      await propose(3)
      send.mockRejectedValueOnce(new Error('no inngest'))

      expect((await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)).ok).toBe(false)

      expect(await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID)).toBeUndefined()
      // And a retry works, stamping again.
      expect(await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)).toEqual({ ok: true })
      expect((await approvedTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    })
  })

  describe('redo and add', () => {
    it('redoTalkingPoints sends one all-mode request with the trimmed note', async () => {
      await propose(3)

      const result = await redoTalkingPoints(FIXTURE_PROJECT_ID, '  make one about the auditors  ')

      expect(result).toEqual({ ok: true })
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]![0].name).toBe('shorts/points.requested')
      expect(send.mock.calls[0]![0].data).toEqual({
        projectId: FIXTURE_PROJECT_ID,
        mode: 'all',
        note: 'make one about the auditors',
      })
    })

    it('an empty note goes as null', async () => {
      await propose(3)
      await redoTalkingPoints(FIXTURE_PROJECT_ID, '   ')
      expect(send.mock.calls[0]![0].data.note).toBeNull()
    })

    it('redoTalkingPoint sends a one-mode request for a point of the latest set', async () => {
      await propose(3)

      const result = await redoTalkingPoint(FIXTURE_PROJECT_ID, ids[1]!, 'sharper')

      expect(result).toEqual({ ok: true })
      expect(send.mock.calls[0]![0].data).toEqual({
        projectId: FIXTURE_PROJECT_ID,
        mode: 'one',
        pointId: ids[1],
        note: 'sharper',
      })
    })

    it('redoTalkingPoint refuses a point that is not in the latest set', async () => {
      await propose(3)

      const result = await redoTalkingPoint(FIXTURE_PROJECT_ID, ids[4]!, '')

      expect(result.ok).toBe(false)
      expect(send).not.toHaveBeenCalled()
    })

    it('addTalkingPoint sends an add-mode request', async () => {
      await propose(3)

      const result = await addTalkingPoint(FIXTURE_PROJECT_ID, 'one on the fine')

      expect(result).toEqual({ ok: true })
      expect(send.mock.calls[0]![0].data).toEqual({
        projectId: FIXTURE_PROJECT_ID,
        mode: 'add',
        note: 'one on the fine',
      })
    })

    it('addTalkingPoint refuses at five, before any request', async () => {
      await propose(5)

      const result = await addTalkingPoint(FIXTURE_PROJECT_ID, '')

      expect(result).toEqual({
        ok: false,
        error: 'There are already 5 talking points, the most allowed. Remove one first.',
      })
      expect(send).not.toHaveBeenCalled()
    })

    it.each([
      ['redoTalkingPoints', () => redoTalkingPoints(FIXTURE_PROJECT_ID, 'again')],
      ['redoTalkingPoint', () => redoTalkingPoint(FIXTURE_PROJECT_ID, ids[0]!, 'again')],
      ['addTalkingPoint', () => addTalkingPoint(FIXTURE_PROJECT_ID, 'again')],
    ])('%s refuses while the runner is live and queues no second paid call', async (_n, run) => {
      await propose(3)
      await liveRunner()

      const result = await run()

      expect(result).toEqual({ ok: false, error: 'Talking points are already being redone.' })
      expect(send).not.toHaveBeenCalled()
    })

    it('two redos with an empty run mirror send exactly once, the second in words', async () => {
      await propose(3)

      const first = await redoTalkingPoints(FIXTURE_PROJECT_ID, 'one')
      const second = await redoTalkingPoints(FIXTURE_PROJECT_ID, 'two')

      expect(first).toEqual({ ok: true })
      expect(second).toEqual({ ok: false, error: 'Talking points are already being redone.' })
      expect(send).toHaveBeenCalledTimes(1)
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('running')
    })

    it('a redo and an add pressed together send once', async () => {
      await propose(3)

      const results = await Promise.all([
        redoTalkingPoints(FIXTURE_PROJECT_ID, 'one'),
        addTalkingPoint(FIXTURE_PROJECT_ID, 'two'),
      ])

      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('hands the claim back when the request cannot be sent, so a retry is possible', async () => {
      await propose(3)
      send.mockRejectedValueOnce(new Error('no inngest'))

      await redoTalkingPoints(FIXTURE_PROJECT_ID, 'one')

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
      expect(await redoTalkingPoints(FIXTURE_PROJECT_ID, 'again')).toEqual({ ok: true })
    })

    it('a finished runner no longer blocks a redo', async () => {
      await propose(3)
      runCounter += 1
      const runId = await ensureRun(db, {
        inngestRunId: `01JTPRUN${String(runCounter).padStart(4, '0')}`,
        functionName: 'talking-points-runner',
        projectId: FIXTURE_PROJECT_ID,
      })
      await setRunStatus(db, runId, 'completed')

      expect(await redoTalkingPoints(FIXTURE_PROJECT_ID, 'again')).toEqual({ ok: true })
    })

    it('another stage run on the project does not read as talking points being redone', async () => {
      await propose(3)
      runCounter += 1
      await ensureRun(db, {
        inngestRunId: `01JTPRUN${String(runCounter).padStart(4, '0')}`,
        functionName: 'visuals-runner',
        projectId: FIXTURE_PROJECT_ID,
      })

      expect(await redoTalkingPoints(FIXTURE_PROJECT_ID, 'again')).toEqual({ ok: true })
    })

    it('says so in words when Inngest cannot be reached', async () => {
      await propose(3)
      send.mockRejectedValueOnce(new Error('no inngest'))

      const result = await redoTalkingPoints(FIXTURE_PROJECT_ID, 'again')

      expect(result.ok).toBe(false)
      expect(result.error).toContain('Inngest')
    })
  })

  describe('removeTalkingPoint', () => {
    it('writes a new version without the point, noted, with contiguous order', async () => {
      await propose(4)

      const result = await removeTalkingPoint(FIXTURE_PROJECT_ID, ids[1]!)

      expect(result).toEqual({ ok: true })
      const latest = await latestTalkingPointSet(db, FIXTURE_PROJECT_ID)
      expect(latest?.version).toBe(2)
      expect(latest?.note).toBe('Removed: Point 2 title')
      expect(latest?.scriptVersion).toBe(1)
      expect(latest?.points.map((p) => p.id)).toEqual([ids[0], ids[2], ids[3]])
      expect(latest?.points.map((p) => p.order)).toEqual([1, 2, 3])
      expect(send).not.toHaveBeenCalled()
    })

    it('refuses while the stage is running at points, even with an empty run mirror', async () => {
      await propose(4)
      await setProjectStage(db, FIXTURE_PROJECT_ID, { stageStatus: 'running' })

      const result = await removeTalkingPoint(FIXTURE_PROJECT_ID, ids[0]!)

      expect(result).toEqual({ ok: false, error: 'Talking points are already being redone.' })
      expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    })

    it('refuses once the set is approved and its Shorts are being built', async () => {
      await propose(4)
      expect(await approveTalkingPoints(FIXTURE_PROJECT_ID, 1)).toEqual({ ok: true })

      const result = await removeTalkingPoint(FIXTURE_PROJECT_ID, ids[0]!)

      expect(result).toEqual({ ok: false, error: 'These talking points are not open for changes.' })
      expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    })

    it('refuses to leave fewer than three', async () => {
      await propose(3)

      const result = await removeTalkingPoint(FIXTURE_PROJECT_ID, ids[0]!)

      expect(result).toEqual({
        ok: false,
        error: 'A set needs at least 3 talking points. Redo one instead of removing it.',
      })
      expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    })

    it('refuses while the runner is live, so it cannot race the new version', async () => {
      await propose(4)
      await liveRunner()

      const result = await removeTalkingPoint(FIXTURE_PROJECT_ID, ids[0]!)

      expect(result).toEqual({ ok: false, error: 'Talking points are already being redone.' })
      expect((await latestTalkingPointSet(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
    })

    it('refuses a point that is not in the latest set', async () => {
      await propose(4)
      expect((await removeTalkingPoint(FIXTURE_PROJECT_ID, ids[4]!)).ok).toBe(false)
    })
  })
})
