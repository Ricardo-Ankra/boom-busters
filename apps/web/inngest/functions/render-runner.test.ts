// @vitest-environment node

import {
  currentBible,
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
  updateWorkspace,
  withTemporaryBible,
} from '@boom-busters/db'
import { listLedger, truncateLedger } from '@boom-busters/cost'
import {
  DEFAULT_SETTINGS,
  defaultFormat,
  FIRST_CHANNEL_ID,
  resolveBrandKit,
} from '@boom-busters/schemas'
import { newId } from '@boom-busters/schemas'
import type { RenderPart, Timeline } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { partOutcome, renderRunner, retryPlan } from './render-runner'

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
  cancelRender: vi.fn(),
  presignRenderOutput: vi.fn(),
}))
vi.mock('@/lib/broker', () => ({
  brokerConfigured: () => broker.configured,
  brokerCallbackUrl: () => 'http://localhost:3000/api/hooks/broker',
  submitRender: broker.submitRender,
  submitMediaJob: broker.submitMediaJob,
  fetchRenderProgress: vi.fn(),
  cancelRender: broker.cancelRender,
  presignRenderOutput: broker.presignRenderOutput,
  brokerErrorStatus: (error: unknown) => (error as { status?: number } | null)?.status,
}))

const storage = vi.hoisted(() => ({
  configured: false,
  putObject: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  putObject: storage.putObject,
}))

/**
 * The mock/live fork is MOCK_PROVIDERS, never broker-env presence: the day
 * the broker env vars landed in a dev .env.local, every "mock" render would
 * otherwise have invoked real Remotion Lambda (found 2026-08-19, by the E2E
 * suite on exactly that machine).
 */
const providers = vi.hoisted(() => ({ mock: true }))
vi.mock('@boom-busters/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, mockProvidersEnabled: () => providers.mock }
})

/**
 * "Nothing was reserved for this run": no ledger entry names any render row
 * that exists now. Asserting on the whole table instead failed once when
 * another file's rows were left behind.
 */
async function expectNothingReserved(): Promise<void> {
  const ids = new Set((await db.select().from(renders)).map((row) => row.id))
  const mine = (await listLedger(db)).filter((entry) => ids.has(String(entry.meta['renderId'])))
  expect(mine).toEqual([])
}

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

/** Thirty-one minutes: three parts of 18,600 frames each. */
function longTimeline(): Timeline {
  const base = canonicalTimeline()
  return {
    ...base,
    narration: base.narration.map((segment) => ({ ...segment, durationMs: 1_860_000 })),
    slots: base.slots.map((slot) => ({ ...slot, durationMs: 1_860_000 })),
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
    providers.mock = true
    await seed(db)
    await truncateRunMirror(db)
    await truncateLedger(db)
    forgetRunRows()
    // `seed` rebuilds the fixture rows but does not clear render bookkeeping.
    await db.delete(renders)
    await db.delete(timelines)
    await updateWorkspace(db, { budgets: { monthlyCeilingUsd: 30, approvedOverage: null } })
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
      'plans no parts in mock mode, even for a timeline over thirty minutes',
      { timeout: 120_000 },
      async () => {
        localRender.renderFixtureLocally.mockImplementation(
          (input: { renderId: string }): Promise<{ outputKey: string }> =>
            Promise.resolve({ outputKey: `local://${input.renderId}.mp4` }),
        )
        await db.delete(timelines)
        await insertTimeline(db, {
          projectId: FIXTURE_PROJECT_ID,
          json: longTimeline(),
          s3Key: '',
        })

        const { result } = await engine.execute({
          events: approvedEvent(),
          steps: [{ id: 'emit-master-ready', handler: () => undefined }],
        })

        expect(result).toMatchObject({ outcome: 'master-ready' })
        const render = await getRender(db, (result as { renderId: string }).renderId)
        expect(render?.parts).toBeNull()
        expect(render?.outputS3Key).toBe(`local://${render?.id}.mp4`)
        expect(localRender.renderFixtureLocally).toHaveBeenCalled()
        expect(broker.submitRender).not.toHaveBeenCalled()
      },
    )

    it(
      'goes straight to Publish and sends no master.ready when the format has Shorts off',
      { timeout: 120_000 },
      async () => {
        localRender.renderFixtureLocally.mockImplementation(
          (input: { renderId: string }): Promise<{ outputKey: string }> =>
            Promise.resolve({ outputKey: `local://${input.renderId}.mp4` }),
        )
        // Ruling 18: the switch is read from the channel's current bible.
        const channelId = FIRST_CHANNEL_ID
        const bible = (await currentBible(db, channelId)).bible
        // `seed` leaves the bible alone, so the helper puts it back for the tests after.
        await withTemporaryBible(
          db,
          channelId,
          { ...bible, formats: [{ ...defaultFormat('Main'), shorts: false }] },
          async () => {
            const { result, ctx } = await engine.execute({ events: approvedEvent() })

            expect(result).toMatchObject({ outcome: 'master-ready' })
            const project = await getProject(db, FIXTURE_PROJECT_ID)
            expect(project?.stage).toBe('publish')
            expect(project?.stageStatus).toBe('awaiting_review')
            expect(ctx.step.sendEvent).not.toHaveBeenCalled()
          },
        )
      },
    )

    it(
      'treats a stored step result without the field as Shorts on',
      { timeout: 120_000 },
      async () => {
        localRender.renderFixtureLocally.mockImplementation(
          (input: { renderId: string }): Promise<{ outputKey: string }> =>
            Promise.resolve({ outputKey: `local://${input.renderId}.mp4` }),
        )

        // A run parked before this deploy replays a step result with no `shorts`.
        const { ctx } = await engine.execute({
          events: approvedEvent(),
          steps: [
            { id: 'local-master-ready', handler: () => undefined },
            { id: 'emit-master-ready', handler: () => undefined },
          ],
        })

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

    it(
      'stays on this machine in mock mode even when a broker is configured',
      { timeout: 120_000 },
      async () => {
        broker.configured = true
        localRender.renderFixtureLocally.mockImplementation(
          (input: { renderId: string }): Promise<{ outputKey: string }> =>
            Promise.resolve({ outputKey: `local://${input.renderId}.mp4` }),
        )

        const { result } = await engine.execute({
          events: approvedEvent(),
          steps: [{ id: 'emit-master-ready', handler: () => undefined }],
        })

        expect(result).toMatchObject({ outcome: 'master-ready' })
        expect(broker.submitRender).not.toHaveBeenCalled()
      },
    )
  })

  describe('live with no broker', () => {
    it('refuses at pre-flight and names both ways out', { timeout: 120_000 }, async () => {
      providers.mock = false
      broker.configured = false

      const { result } = await engine.execute({ events: approvedEvent() })

      expect(result).toMatchObject({ outcome: 'failed' })
      expect(broker.submitRender).not.toHaveBeenCalled()
      expect(localRender.renderFixtureLocally).not.toHaveBeenCalled()
      const rows = await db.select().from(renders)
      const failed = rows.find((row) => row.status === 'failed')
      expect(failed?.error).toMatchObject({
        message: expect.stringContaining('AWS_BROKER_URL'),
      })
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
      await expectNothingReserved()
    })
  })

  describe('live path', () => {
    beforeEach(() => {
      broker.configured = true
      storage.configured = true
      providers.mock = false
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
      await updateWorkspace(db, { budgets: { monthlyCeilingUsd: 0 } })

      await engine.executeStep('render-over-budget', { events: approvedEvent() })

      expect(broker.submitRender).not.toHaveBeenCalled()
      const rows = await db.select().from(renders)
      expect(rows.some((row) => row.status === 'failed')).toBe(true)
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('failed')
      await expectNothingReserved()
    })
  })

  describe('live path, in parts', () => {
    beforeEach(async () => {
      broker.configured = true
      storage.configured = true
      providers.mock = false
      broker.presignRenderOutput.mockReset()
      broker.presignRenderOutput.mockResolvedValue('https://example.test/probe')
      await db.delete(timelines)
      await insertTimeline(db, {
        projectId: FIXTURE_PROJECT_ID,
        json: longTimeline(),
        s3Key: '',
      })
    })

    it(
      'plans the parts on the row, reserves once and submits the first wave with frame ranges',
      { timeout: 120_000 },
      async () => {
        broker.submitRender.mockResolvedValue({
          brokerRenderId: '01HQ0000000000000000000BR1',
          remotionRenderId: 'rem-part',
          estimatedCostUsd: 0.01,
        })

        await engine.executeStep('submit-part-1', { events: approvedEvent() })

        // The harness replays the function, so an earlier step's handler can
        // run again under a fresh plan: the row is found by the id the target
        // step (the last call) submitted, and its calls by that row's parts.
        type Submitted = {
          renderId: string
          frameRange: [number, number]
          expectedDurationSec: number
        }
        const calls = broker.submitRender.mock.calls.map((call) => call[0] as Submitted)
        const last = calls[calls.length - 1]
        const rows = await db.select().from(renders)
        const row = rows.find((r) => r.parts?.some((p) => p.renderId === last?.renderId))
        expect(row).toBeDefined()
        expect(row?.parts).toHaveLength(3)

        const first = calls.find((c) => c.renderId === row?.parts?.[0]?.renderId)
        const second = calls.find((c) => c.renderId === row?.parts?.[1]?.renderId)
        expect(first?.frameRange).toEqual([0, 18599])
        expect(second?.frameRange).toEqual([18600, 37199])
        expect(first?.expectedDurationSec).toBe(620)
        expect(calls.some((c) => c.renderId === row?.parts?.[2]?.renderId)).toBe(false)
        expect(row?.parts?.[0]).toMatchObject({ status: 'rendering', remotionRenderId: 'rem-part' })
        expect(row?.parts?.[1]).toMatchObject({ status: 'rendering' })
        expect(row?.parts?.[2]).toMatchObject({ status: 'queued', attempt: 1 })
        expect(row?.brokerRenderId).toBeNull()
        expect(row?.status).toBe('rendering')

        // The reservation is for the whole film, never per part, and still
        // open. (The harness may replay invoke-broker, so more than one
        // identical entry can exist; none may be settled or smaller.)
        const entries = (await listLedger(db)).filter((e) => e.meta['renderId'] === row?.id)
        expect(entries.length).toBeGreaterThanOrEqual(1)
        for (const entry of entries) {
          expect(entry).toMatchObject({
            operation: 'render-master',
            settled: false,
            estimatedUsd: Number(row?.costUsd),
            meta: expect.objectContaining({ parts: 3 }),
          })
        }
      },
    )

    it(
      'refuses before reserving when the broker predates long renders (the probe 404s)',
      { timeout: 120_000 },
      async () => {
        broker.presignRenderOutput.mockRejectedValue(
          Object.assign(new Error('broker answered 404 for POST /presign'), { status: 404 }),
        )

        const { error } = await engine.executeStep('invoke-broker', { events: approvedEvent() })

        expect(String((error as Error | undefined)?.message ?? error)).toContain(
          'predates long renders in parts',
        )
        expect(broker.submitRender).not.toHaveBeenCalled()
        await expectNothingReserved()
      },
    )

    it('reads a settled event as a part outcome, a completion without a key as failed', () => {
      const event = (data: Record<string, unknown>) => ({ data })
      expect(
        partOutcome(
          event({ result: 'completed', outputS3Key: 'renders/x/part.mp4', costUsd: 0.5 }),
          '40m',
        ),
      ).toEqual({ ok: true, outputS3Key: 'renders/x/part.mp4', costUsd: 0.5 })
      expect(partOutcome(event({ result: 'completed', costUsd: 0.5 }), '40m')).toEqual({
        ok: false,
        detail: 'completed without an output key',
      })
      expect(
        partOutcome(event({ result: 'failed', reason: 'error', message: 'boom' }), '40m'),
      ).toEqual({ ok: false, detail: 'error: boom' })
      expect(partOutcome(null, '40m')).toEqual({ ok: false, detail: 'no webhook within 40m' })
    })

    it('cancels a timed-out part on the broker before resubmitting it', () => {
      // The harness cannot return null from a wait, so the retry branch is
      // tested through the pure plan the retry step applies.
      const part: RenderPart = {
        index: 0,
        renderId: newId<'render'>(),
        frameRange: [0, 18599],
        startMs: 0,
        durationMs: 620_000,
        status: 'rendering',
        attempt: 1,
        priorRenderIds: [],
        remotionRenderId: 'rem-old',
      }
      const { cancelId, next } = retryPlan(part)
      expect(cancelId).toBe(part.renderId)
      expect(next.renderId).not.toBe(part.renderId)
      expect(next.priorRenderIds).toEqual([part.renderId])
      expect(next).toMatchObject({ attempt: 2, status: 'queued', index: 0 })
      expect(next.frameRange).toEqual([0, 18599])
      expect(next.remotionRenderId).toBeUndefined()
    })
  })
})
