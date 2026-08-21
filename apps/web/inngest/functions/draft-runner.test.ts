// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getProject,
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
import { draftRunner } from './draft-runner'

/**
 * The draft-runner against the real database. Like the render-runner's
 * suite, the live path is asserted up to the broker invoke (the harness
 * cannot drive a run past a wait); the completion events are made by the
 * broker hook route, tested in route.test.ts. What matters here is the
 * draft's DIFFERENCES from the master: kind 'draft' and a quarter of the
 * price on the wire, no stage or gate bookkeeping ever, and a budget
 * refusal that fails only its own row — never the project.
 */

const broker = vi.hoisted(() => ({
  configured: false,
  submitRender: vi.fn(),
}))
vi.mock('@/lib/broker', () => ({
  brokerConfigured: () => broker.configured,
  brokerCallbackUrl: () => 'http://localhost:3000/api/hooks/broker',
  submitRender: broker.submitRender,
  submitMediaJob: vi.fn(),
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

const providers = vi.hoisted(() => ({ mock: true }))
vi.mock('@boom-busters/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, mockProvidersEnabled: () => providers.mock }
})

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

function requestedEvent(): [{ name: string; data: Record<string, unknown> }] {
  return [{ name: 'render/draft.requested', data: { projectId: FIXTURE_PROJECT_ID } }]
}

describeDb('draft-runner', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: draftRunner })
    vi.clearAllMocks()
    broker.configured = false
    storage.configured = false
    providers.mock = true
    await seed(db)
    await truncateRunMirror(db)
    await truncateLedger(db)
    forgetRunRows()
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

  it('skips in mock mode without touching a single row', { timeout: 120_000 }, async () => {
    const { result } = await engine.execute({ events: requestedEvent() })

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(await db.select().from(renders)).toEqual([])
    expect(await listLedger(db)).toEqual([])
    expect(broker.submitRender).not.toHaveBeenCalled()
  })

  it('skips live-but-unconfigured — a draft is advisory, never a failure', async () => {
    providers.mock = false
    broker.configured = false

    const { result } = await engine.execute({ events: requestedEvent() })

    expect(result).toMatchObject({ outcome: 'skipped' })
    expect(await db.select().from(renders)).toEqual([])
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
  })

  describe('live path', () => {
    beforeEach(() => {
      broker.configured = true
      storage.configured = true
      providers.mock = false
    })

    it(
      'reserves a quarter-price spend and invokes the broker with kind draft',
      { timeout: 120_000 },
      async () => {
        broker.submitRender.mockResolvedValue({
          brokerRenderId: '01HQ0000000000000000000BR1',
          remotionRenderId: 'rem-draft',
          estimatedCostUsd: 0.0014,
        })

        await engine.executeStep('invoke-broker', { events: requestedEvent() })

        expect(broker.submitRender).toHaveBeenCalledWith(
          expect.objectContaining({
            composition: 'DocumentaryMaster',
            kind: 'draft',
            expectedDurationSec: 20,
          }),
        )

        // A quarter of the master's estimate for the same 20 seconds.
        const [entry] = await listLedger(db)
        expect(entry).toMatchObject({ operation: 'render-draft', settled: false })
        expect(Number(entry?.estimatedUsd)).toBeCloseTo(0.0014, 4)

        // The gate stays parked and the stage untouched — the draft renders
        // beside Gate 5a, never instead of it.
        expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
      },
    )

    it(
      'refuses over budget on its own row only — the project never fails',
      { timeout: 120_000 },
      async () => {
        await updateSettings(db, { budgets: { monthlyCeilingUsd: 0 } })

        await engine.executeStep('draft-over-budget', { events: requestedEvent() })

        expect(broker.submitRender).not.toHaveBeenCalled()
        const rows = await db.select().from(renders)
        const failed = rows.find((row) => row.status === 'failed')
        expect(failed?.kind).toBe('draft')
        expect(failed?.error).toMatchObject({
          message: expect.stringContaining('budget ceiling'),
        })
        expect(await listLedger(db)).toEqual([])
        // The whole point: an advisory copy's refusal is not a stage failure.
        expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
      },
    )
  })
})
