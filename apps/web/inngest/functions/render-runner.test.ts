// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getProject,
  getRender,
  insertTimeline,
  renders,
  requireTestDatabase,
  seed,
  setProjectStage,
  timelines,
  truncateRunMirror,
  updateSettings,
} from '@boom-busters/db'
import { listLedger, truncateLedger } from '@boom-busters/cost'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { renderRunner } from './render-runner'

/**
 * The render-runner against the real database (build spec section 13).
 *
 * The MOCK/LOCAL path runs end to end — it has no `waitForEvent`, so a full
 * `execute` walks invoke → local render → QC pass → `project/master.ready`.
 * The LIVE path is asserted up to the broker invoke; the harness cannot
 * drive a run past a wait (`@inngest/test` limitation documented in
 * `demo-pipeline.test.ts`), and the completion events themselves are made
 * by the broker hook route, tested in `route.test.ts`.
 *
 * The actual renderer is mocked here: a real 20-second `renderMedia` runs
 * in the E2E suite, once, where its output is also played back.
 *
 * **Row-identity caveat.** The harness replays the function afresh per
 * internal execution, and each replay's `load-render` inserts its own
 * renders row — so "the newest row" is whichever replay ran last, not the
 * one that reached the target step. Every assertion therefore finds its row
 * by the ULID the step under test actually used (the one handed to the
 * broker, or the one on the run's result), never by recency.
 */

const localRender = vi.hoisted(() => ({
  renderFixtureLocally: vi.fn(),
}))
vi.mock('@/lib/local-render', () => ({
  renderFixtureLocally: localRender.renderFixtureLocally,
  localRenderKey: (id: string) => `local://${id}.mp4`,
  localRenderPath: () => null,
  localRenderDir: () => '.local-renders',
}))

const broker = vi.hoisted(() => ({
  configured: false,
  submitRender: vi.fn(),
  submitMediaJob: vi.fn(),
}))
vi.mock('@/lib/broker', () => ({
  brokerConfigured: () => broker.configured,
  brokerCallbackUrl: () => 'http://localhost:3000/api/hooks/broker',
  submitRender: broker.submitRender,
  submitMediaJob: broker.submitMediaJob,
  fetchRenderProgress: vi.fn(),
  cancelRender: vi.fn(),
}))

const storage = vi.hoisted(() => ({
  configured: false,
  putObject: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  putObject: storage.putObject,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CHAPTER = '01HQ0000000000000000000CH1'

function canonicalTimeline(): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [
      {
        r2Key: 'mock://voice/01HQ0000000000000000000TK1.wav',
        startMs: 0,
        durationMs: 20_000,
        chapterId: CHAPTER,
        paragraphIndex: 0,
      },
    ],
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [
      {
        type: 'chart',
        startMs: 0,
        durationMs: 20_000,
        transition: 'cut',
        motion: { kind: 'draw-on' },
        payload: {
          kind: 'chart',
          chartKind: 'line',
          series: [
            {
              label: 'Price',
              unit: '€',
              points: [
                { x: 'A', y: 1 },
                { x: 'B', y: 0.4 },
              ],
            },
          ],
          dataRefs: ['01HQ00000000000000000000AA'],
          takeaway: 'Down.',
          reveal: 'draw-on',
        },
      },
    ],
    overlays: [],
  }
}

function approvedEvent(): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'gate/preview.approved',
      data: { projectId: FIXTURE_PROJECT_ID, approvedBy: 'owner@example.com' },
    },
  ]
}

describeDb('render-runner', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: renderRunner })
    vi.clearAllMocks()
    broker.configured = false
    storage.configured = false
    await seed(db)
    await truncateRunMirror(db)
    await truncateLedger(db)
    forgetRunRows()
    // `seed` rebuilds the fixture rows but does not clear render bookkeeping.
    await db.delete(renders)
    await db.delete(timelines)
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 30, approvedOverage: null } })
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'assembly',
      stageStatus: 'awaiting_review',
    })
    await insertTimeline(db, {
      projectId: FIXTURE_PROJECT_ID,
      json: canonicalTimeline(),
      s3Key: '',
    })
  })

  describe('mock/local path', () => {
    it(
      'renders locally, passes QC by construction and emits master.ready',
      { timeout: 120_000 },
      async () => {
        localRender.renderFixtureLocally.mockImplementation(
          (input: { renderId: string }): Promise<{ outputKey: string }> =>
            Promise.resolve({ outputKey: `local://${input.renderId}.mp4` }),
        )

        // The emit step is mocked: the harness would otherwise POST the
        // event to a live Inngest server that does not exist in tests.
        const { result, ctx } = await engine.execute({
          events: approvedEvent(),
          steps: [{ id: 'emit-master-ready', handler: () => undefined }],
        })

        expect(result).toMatchObject({ outcome: 'master-ready' })

        const render = await getRender(db, (result as { renderId: string }).renderId)
        expect(render?.status).toBe('done')
        expect(render?.outputS3Key).toBe(`local://${render?.id}.mp4`)
        expect(render?.qcReport).toMatchObject({ passed: true })
        expect(render?.progressPct).toBe(100)

        // The pipeline moves on; nothing runs `shorts` until M7, and the
        // project screen knows how to say that.
        const project = await getProject(db, FIXTURE_PROJECT_ID)
        expect(project?.stage).toBe('shorts')
        expect(project?.stageStatus).toBe('queued')

        expect(ctx.step.sendEvent).toHaveBeenCalledWith(
          'emit-master-ready',
          expect.arrayContaining([expect.objectContaining({ name: 'project/master.ready' })]),
        )
      },
    )

    it(
      'marks the render and the stage failed when the renderer dies',
      { timeout: 120_000 },
      async () => {
        localRender.renderFixtureLocally.mockRejectedValue(new Error('Chrome went missing'))

        const { result } = await engine.execute({ events: approvedEvent() })

        expect(result).toMatchObject({ outcome: 'failed' })
        const failedRows = await db.select().from(renders)
        const render = failedRows.find((row) => row.status === 'failed')
        expect(render).toBeDefined()
        expect(render?.error).toMatchObject({ message: expect.stringContaining('Chrome') })
        expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
      },
    )
  })

  describe('live path', () => {
    beforeEach(() => {
      broker.configured = true
      storage.configured = true
    })

    it(
      'reserves the spend, invokes the broker and pins the row to it',
      { timeout: 120_000 },
      async () => {
        broker.submitRender.mockResolvedValue({
          brokerRenderId: '01HQ0000000000000000000BR1',
          remotionRenderId: 'rem-abc',
          estimatedCostUsd: 0.0056,
        })

        await engine.executeStep('invoke-broker', { events: approvedEvent() })

        // The renders row's ULID is the identity the broker keys everything by.
        expect(broker.submitRender).toHaveBeenCalledWith(
          expect.objectContaining({
            composition: 'DocumentaryMaster',
            kind: 'master',
            expectedDurationSec: 20,
          }),
        )
        const request = broker.submitRender.mock.calls[0]?.[0] as { renderId: string }
        const render = await getRender(db, request.renderId)
        expect(render?.status).toBe('rendering')
        expect(render?.remotionRenderId).toBe('rem-abc')

        // Reserved before the invoke, unsettled until the webhook.
        const [entry] = await listLedger(db)
        expect(entry).toMatchObject({ operation: 'render-master', settled: false })

        // The timeline had no key (compiled while R2 was absent) — the invoke
        // uploads it rather than handing the broker an empty pointer.
        expect(storage.putObject).toHaveBeenCalledWith(
          expect.stringMatching(/^boom-busters\/timelines\//),
          expect.any(Buffer),
          'application/json',
        )
      },
    )

    it('refuses to start a render that would cross the ceiling', { timeout: 120_000 }, async () => {
      await updateSettings(db, { budgets: { monthlyCeilingUsd: 0 } })

      await engine.executeStep('render-over-budget', { events: approvedEvent() })

      expect(broker.submitRender).not.toHaveBeenCalled()
      const rows = await db.select().from(renders)
      expect(rows.some((row) => row.status === 'failed')).toBe(true)
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
      expect(await listLedger(db)).toEqual([])
    })
  })
})
