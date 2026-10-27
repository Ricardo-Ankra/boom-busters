// @vitest-environment node

import {
  claimTake,
  createScriptVersion,
  ensureRun,
  FIXTURE_PROJECT_ID,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setProjectDirection,
  setProjectStage,
  setSlotJob,
  setVisualsPhase,
  shotSlots,
  storeTakeAudio,
  truncateRunMirror,
} from '@boom-busters/db'
import { mockDirectorsBook } from '@boom-busters/providers'
import { BudgetExceededError, newId } from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import type * as Notices from '@/lib/notices'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { forgetRunRows } from '../middleware/run-mirror'
import { stretchReplanner } from './stretch-replanner'

/**
 * The stretch-replanner against the real database, in mock-provider mode
 * unless a test says otherwise (the stretch re-plan design, 3.3): only the
 * selected rows are replaced, the board fetches the new ones straight away,
 * and any stop keeps the old shots exactly as they were and says why on the
 * first selected card.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

// The stop is asserted, not stored.
const recordStop = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notices', async (importOriginal) => ({
  ...(await importOriginal<typeof Notices>()),
  recordStop,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const P0 = 'The auditors arrived in June. They could not find the money.'
const P1 = 'The founder said the cash was safe. The bank said otherwise.'
const P2 = 'By August the company had collapsed. Investors lost everything they had put in.'
const WORD_MS = 700

/** Word timings for one take, from its own zero, one word every 700 ms. */
function timings(text: string) {
  return text.split(' ').map((word, at) => ({
    text: word,
    startMs: at * WORD_MS,
    endMs: at * WORD_MS + 600,
  }))
}

const takeMs = (text: string) => text.split(' ').length * WORD_MS + 300

const stock = (coversText: string, description: string): ShotBrief => ({
  type: 'stock',
  coversText,
  description,
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'office',
  rejectionCriteria: [],
})

describeDb('stretch-replanner', () => {
  let engine: InngestTestEngine
  let chapterId = ''
  /** The four seeded shots, in screen order. */
  let ids: string[] = []

  /** The fixture chapter, voiced, with or without word timings. */
  async function seedChapter(withTimings: boolean): Promise<void> {
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: [P0, P1, P2].join('\n\n'),
      estRuntimeSec: 30,
    })
    chapterId = chapter.id
    for (const [paragraphIndex, text] of [P0, P1, P2].entries()) {
      const claimed = await claimTake(db, {
        projectId: FIXTURE_PROJECT_ID,
        chapterId,
        paragraphIndex,
        idempotencyKey: newId(),
        provider: 'elevenlabs',
        voiceId: 'v-narrator',
        builtFromScriptVersion: script.version,
      })
      await storeTakeAudio(db, claimed.take.id, {
        r2Key: `voice/${claimed.take.id}.mp3`,
        durationMs: takeMs(text),
        costUsd: 0,
        waveform: [],
        timings: withTimings ? timings(text) : null,
      })
    }
    const p1Start = takeMs(P0)
    const p2Start = p1Start + takeMs(P1)
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId,
        index: 0,
        type: 'stock',
        brief: stock('The auditors arrived in June.', 'old 0'),
        startMs: 0,
        durationMs: 3500,
      },
      {
        chapterId,
        index: 1,
        type: 'stock',
        brief: stock('They could not find the money.', 'old 1'),
        startMs: 3500,
        durationMs: p1Start - 3500,
      },
      {
        chapterId,
        index: 2,
        type: 'stock',
        brief: stock(P1, 'old 2'),
        startMs: p1Start,
        durationMs: takeMs(P1),
      },
      {
        chapterId,
        index: 3,
        type: 'stock',
        brief: stock(P2, 'old 3'),
        startMs: p2Start,
        durationMs: takeMs(P2),
      },
    ])
    ids = (await listShotSlots(db, FIXTURE_PROJECT_ID)).map((row) => row.id)
  }

  /** Stamps the selection as the action does, and returns its event. */
  async function stretchEvent(
    slotIds: string[],
    jobId = newId(),
  ): Promise<[{ name: string; data: Record<string, unknown> }]> {
    for (const slotId of slotIds) {
      await setSlotJob(db, slotId, { kind: 'stretch', jobId, startedAt: new Date().toISOString() })
    }
    return [
      {
        name: 'visuals/stretch.requested',
        data: { projectId: FIXTURE_PROJECT_ID, chapterId, slotIds, jobId },
      },
    ]
  }

  const rows = () => listShotSlots(db, FIXTURE_PROJECT_ID)
  const descriptions = async () => (await rows()).map((row) => row.brief['description'])

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: stretchReplanner })
    vi.stubEnv('MOCK_PROVIDERS', '1')
    callLlm.mockReset()
    recordStop.mockClear()
    vi.mocked(notify).mockClear()
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await seedChapter(true)
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'visuals',
      stageStatus: 'awaiting_review',
    })
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    await setProjectDirection(
      db,
      FIXTURE_PROJECT_ID,
      mockDirectorsBook({ caseTitle: 'x', chapterCount: 1 }),
    )
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('replaces only the selected rows on the board and fetches the new ones', async () => {
    const [kept0, gone1, gone2, kept3] = ids as [string, string, string, string]
    const { result, ctx } = await engine.execute({
      events: await stretchEvent([gone1, gone2]),
      steps: [{ id: 'fetch-new', handler: () => undefined }],
    })

    expect(result).toMatchObject({ outcome: 'replanned', removed: 2, added: 2 })
    expect(callLlm).not.toHaveBeenCalled()
    const after = await rows()
    expect(after.map((row) => row.index)).toEqual([0, 1, 2, 3])
    expect(after[0]!.id).toBe(kept0)
    expect(after[3]!.id).toBe(kept3)
    expect(after.map((row) => row.brief['description'])).toEqual([
      'old 0',
      expect.not.stringMatching(/^old/),
      expect.not.stringMatching(/^old/),
      'old 3',
    ])
    expect(after.some((row) => row.id === gone1 || row.id === gone2)).toBe(false)
    expect(after[1]!.brief['coversText']).toBe('They could not find the money.')

    // Each new shot is fetched through the Regenerate path, with its own stamp.
    const fresh = [after[1]!, after[2]!]
    for (const row of fresh) {
      expect(row.pendingJob).toMatchObject({ kind: 'refetch' })
    }
    expect(ctx.step.sendEvent).toHaveBeenCalledWith(
      'fetch-new',
      fresh.map((row) =>
        expect.objectContaining({
          name: 'visuals/refetch.requested',
          data: {
            projectId: FIXTURE_PROJECT_ID,
            slotId: row.id,
            note: 'Stretch re-plan',
            jobId: (row.pendingJob as { jobId: string }).jobId,
          },
        }),
      ),
    )
    expect(vi.mocked(notify)).toHaveBeenCalledWith({
      kind: 'heads-up',
      title: 'Shots re-planned',
      body: '2 shots re-planned as 2',
      href: `/projects/${FIXTURE_PROJECT_ID}`,
    })
  })

  it('replaces the rows at the plan checkpoint without fetching', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    const { result, ctx } = await engine.execute({
      events: await stretchEvent([ids[1]!, ids[2]!]),
    })

    expect(result).toMatchObject({ outcome: 'replanned', removed: 2, added: 2 })
    expect(ctx.step.sendEvent).not.toHaveBeenCalled()
    const after = await rows()
    expect(after.map((row) => row.index)).toEqual([0, 1, 2, 3])
    expect(after.every((row) => row.pendingJob === null)).toBe(true)
    expect(after[1]!.brief['description']).not.toBe('old 1')
  })

  it('does nothing once the visuals are approved', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, null)
    const { result } = await engine.execute({ events: await stretchEvent([ids[1]!]) })

    expect(result).toMatchObject({ outcome: 'not-open' })
    expect(await descriptions()).toEqual(['old 0', 'old 1', 'old 2', 'old 3'])
    expect((await getShotSlot(db, ids[1]!))!.pendingJob).toBeNull()
  })

  it('does nothing once the project has moved past the visuals stage', async () => {
    // The phase stays `board` after the visuals gate is approved.
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'assembly', stageStatus: 'running' })
    const { result } = await engine.execute({ events: await stretchEvent([ids[1]!, ids[2]!]) })

    expect(result).toMatchObject({ outcome: 'not-open' })
    expect(await descriptions()).toEqual(['old 0', 'old 1', 'old 2', 'old 3'])
    expect((await rows()).map((row) => row.pendingJob)).toEqual([null, null, null, null])
  })

  it('does nothing while the fetch pass runs', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'running' })
    await ensureRun(db, {
      inngestRunId: 'run-fetching',
      functionName: 'visuals-runner',
      projectId: FIXTURE_PROJECT_ID,
      stage: 'visuals',
    })
    const { result } = await engine.execute({ events: await stretchEvent([ids[1]!, ids[2]!]) })

    expect(result).toMatchObject({ outcome: 'not-open' })
    expect(await descriptions()).toEqual(['old 0', 'old 1', 'old 2', 'old 3'])
    expect((await rows()).map((row) => row.pendingJob)).toEqual([null, null, null, null])
  })

  it('does not count its own run as the fetch pass', async () => {
    // A stage left `running` by a runner that died: the board is not locked,
    // so the re-plan the action let through must not refuse itself.
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'running' })
    const { result } = await engine.execute({ events: await stretchEvent([ids[1]!, ids[2]!]) })

    expect(result).toMatchObject({ outcome: 'replanned' })
  })

  it('keeps the rows and says why when the budget stops it', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockRejectedValue(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'shotlist',
        budgetUsd: 50,
        monthSpendUsd: 49.99,
        estimateUsd: 0.2,
      }),
    )
    const { result } = await engine.execute({ events: await stretchEvent([ids[1]!, ids[2]!]) })

    expect(result).toMatchObject({ outcome: 'over-budget' })
    expect(callLlm.mock.calls[0]![1]).toEqual({ projectId: FIXTURE_PROJECT_ID, purpose: 'stretch' })
    expect(await descriptions()).toEqual(['old 0', 'old 1', 'old 2', 'old 3'])
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: ids[1] },
      'stopped',
      expect.stringMatching(/^The stretch re-plan stopped: The monthly spend ceiling/),
    )
    for (const id of [ids[1]!, ids[2]!]) {
      expect((await getShotSlot(db, id))!.pendingJob).toBeNull()
    }
  })

  it('keeps the rows when the answer is refused twice', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    callLlm.mockResolvedValue({ text: 'no json here' })
    const { result } = await engine.execute({ events: await stretchEvent([ids[1]!, ids[2]!]) })

    expect(result).toMatchObject({ outcome: 'stopped' })
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
    expect(await descriptions()).toEqual(['old 0', 'old 1', 'old 2', 'old 3'])
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: ids[1] },
      'stopped',
      expect.stringMatching(/^The stretch re-plan stopped: .+\. The shots you had are kept\.$/),
    )
    expect((await getShotSlot(db, ids[1]!))!.pendingJob).toBeNull()
  })

  it('refuses narration without word timings in words', async () => {
    await seedChapter(false)
    const { result } = await engine.execute({ events: await stretchEvent([ids[1]!, ids[2]!]) })

    expect(result).toMatchObject({ outcome: 'refused' })
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: ids[1] },
      'stopped',
      'The stretch re-plan stopped: This narration has no word timings, so a stretch cannot be cut. Use Re-plan shot list instead.',
    )
    expect(await descriptions()).toEqual(['old 0', 'old 1', 'old 2', 'old 3'])
    expect((await getShotSlot(db, ids[2]!))!.pendingJob).toBeNull()
  })

  it('ends quietly, writing nothing, when Stop took the stamps first', async () => {
    const events = await stretchEvent([ids[1]!, ids[2]!])
    await setSlotJob(db, ids[2]!, null)
    const { result } = await engine.execute({ events })

    expect(result).toMatchObject({ outcome: 'superseded' })
    expect(await descriptions()).toEqual(['old 0', 'old 1', 'old 2', 'old 3'])
    expect(recordStop).not.toHaveBeenCalled()
    expect(vi.mocked(notify)).not.toHaveBeenCalled()
    expect((await getShotSlot(db, ids[1]!))!.pendingJob).toBeNull()
  })

  it('runs two stretches in one chapter one after the other', async () => {
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    const [first, middle1, middle2, last] = ids as [string, string, string, string]
    const one = await stretchEvent([first])
    const two = await stretchEvent([last])

    const a = await engine.execute({ events: one })
    const b = await new InngestTestEngine({ function: stretchReplanner }).execute({ events: two })

    expect(a.result).toMatchObject({ outcome: 'replanned', removed: 1, added: 1 })
    expect(b.result).toMatchObject({ outcome: 'replanned', removed: 1, added: 2 })
    const after = await rows()
    expect(after.map((row) => row.index)).toEqual([0, 1, 2, 3, 4])
    expect(after.map((row) => row.id).slice(1, 3)).toEqual([middle1, middle2])
    expect(after.some((row) => row.id === first || row.id === last)).toBe(false)
    expect(after.map((row) => row.brief['coversText'])).toEqual([
      'The auditors arrived in June.',
      'They could not find the money.',
      P1,
      'By August the company had collapsed.',
      'Investors lost everything they had put in.',
    ])
  })

  it('releases every stamp when it fails past its retries', async () => {
    const jobId = newId()
    const [event] = await stretchEvent([ids[1]!, ids[2]!], jobId)
    const newer = { kind: 'refetch' as const, jobId: newId(), startedAt: new Date().toISOString() }
    await setSlotJob(db, ids[3]!, newer)
    const { onFailure } = (
      stretchReplanner as unknown as {
        opts: { onFailure: (input: unknown) => Promise<void> }
      }
    ).opts

    await onFailure({
      event: {
        data: {
          event: { data: { ...event.data, slotIds: [ids[1], ids[2], ids[3]] } },
          error: new Error('the database went away'),
        },
      },
    })

    expect((await getShotSlot(db, ids[1]!))!.pendingJob).toBeNull()
    expect((await getShotSlot(db, ids[2]!))!.pendingJob).toBeNull()
    expect((await getShotSlot(db, ids[3]!))!.pendingJob).toEqual(newer)
    expect(recordStop).toHaveBeenCalledWith(
      { projectId: FIXTURE_PROJECT_ID, subject: 'slot', subjectId: ids[1] },
      'stopped',
      'The stretch re-plan failed: the database went away',
    )
  })
})
