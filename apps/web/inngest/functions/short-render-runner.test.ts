// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getProject,
  getShort,
  insertRender,
  insertShort,
  insertTimeline,
  renders,
  requireTestDatabase,
  seed,
  setProjectStage,
  shorts,
  timelines,
  truncateRunMirror,
  updateRender,
  updateSettings,
} from '@boom-busters/db'
import { listLedger, truncateLedger } from '@boom-busters/cost'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { shortRenderRunner, shortTimelineKey } from './short-render-runner'

/**
 * The short-render-runner against the real database. The live path is
 * asserted up to the broker invoke (the harness cannot drive past a wait);
 * what matters here is the Short's shape on the wire — composition
 * `ShortVertical`, kind `short`, the SLICED duration — that the row belongs
 * to its Short, and that mock mode finishes the bookkeeping without AWS.
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

function canonicalMaster(): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [0, 1, 2].map((index) => ({
      r2Key: `mock://voice/p${index}.wav`,
      startMs: index * 6000,
      durationMs: 6000,
      chapterId: CHAPTER,
      paragraphIndex: index,
    })),
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [
      {
        type: 'still',
        startMs: 0,
        durationMs: 18_000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/x.png' } },
      },
    ],
    overlays: [],
  }
}

describeDb('short-render-runner', () => {
  let engine: InngestTestEngine
  let shortId: string

  function requestedEvent(): [{ name: string; data: Record<string, unknown> }] {
    return [{ name: 'shorts/render.requested', data: { projectId: FIXTURE_PROJECT_ID, shortId } }]
  }

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: shortRenderRunner })
    vi.clearAllMocks()
    broker.configured = false
    storage.configured = false
    providers.mock = true
    await seed(db)
    await truncateRunMirror(db)
    await truncateLedger(db)
    forgetRunRows()
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 30, approvedOverage: null } })
    await setProjectStage(db, FIXTURE_PROJECT_ID, {
      stage: 'shorts',
      stageStatus: 'awaiting_review',
    })
    await insertTimeline(db, {
      projectId: FIXTURE_PROJECT_ID,
      json: canonicalMaster(),
      s3Key: 'boom-busters/timelines/master.json',
    })
    const short = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'EY refused',
      // Paragraphs 1..2 = 12 seconds of the 18-second master.
      segmentRef: { chapterId: CHAPTER, fromParagraph: 1, toParagraph: 2 },
    })
    shortId = short.id
  })

  it(
    'mock mode finishes the bookkeeping: row done, card pointed at it, no AWS',
    { timeout: 120_000 },
    async () => {
      // The local fixture master whose file the mock Short reuses.
      const master = await insertRender(db, {
        projectId: FIXTURE_PROJECT_ID,
        timelineVersion: 1,
        kind: 'master',
      })
      await updateRender(db, master.id, { status: 'done', outputS3Key: 'local://master.mp4' })

      const { result } = await engine.execute({ events: requestedEvent() })

      expect(result).toMatchObject({ outcome: 'mock-ready', shortId })
      const rows = await db.select().from(renders)
      const shortRender = rows.find((row) => row.kind === 'short')
      expect(shortRender).toMatchObject({
        status: 'done',
        shortId,
        outputS3Key: 'local://master.mp4',
        progressPct: 100,
      })
      expect((await getShort(db, shortId))?.renderId).toBe(shortRender?.id)
      expect(broker.submitRender).not.toHaveBeenCalled()
      expect(await listLedger(db)).toEqual([])
    },
  )

  describe('live path', () => {
    beforeEach(() => {
      broker.configured = true
      storage.configured = true
      providers.mock = false
    })

    it(
      'uploads the sliced timeline and invokes ShortVertical at the sliced length',
      { timeout: 120_000 },
      async () => {
        broker.submitRender.mockResolvedValue({
          brokerRenderId: '01HQ0000000000000000000BR1',
          remotionRenderId: 'rem-short',
          estimatedCostUsd: 0.0033,
        })

        await engine.executeStep('invoke-broker', { events: requestedEvent() })

        const shortRow = await getShort(db, shortId)
        expect(shortRow?.renderId).toBeTruthy()
        const expectedKey = shortTimelineKey(FIXTURE_PROJECT_ID, shortId, shortRow?.renderId ?? '')
        expect(storage.putObject).toHaveBeenCalledWith(
          expectedKey,
          expect.any(Buffer),
          'application/json',
        )
        expect(broker.submitRender).toHaveBeenCalledWith(
          expect.objectContaining({
            composition: 'ShortVertical',
            kind: 'short',
            timelineS3Key: expectedKey,
            expectedDurationSec: 12,
          }),
        )

        const [entry] = await listLedger(db)
        expect(entry).toMatchObject({ operation: 'render-short', settled: false })

        // The uploaded timeline is the SLICE, vertical and re-clocked.
        const uploaded = JSON.parse(
          (storage.putObject.mock.calls[0]?.[1] as Buffer).toString(),
        ) as Timeline
        expect([uploaded.width, uploaded.height]).toEqual([1080, 1920])
        expect(uploaded.narration.map((segment) => segment.startMs)).toEqual([0, 6000])
        expect(uploaded.overlays[0]).toMatchObject({ kind: 'endCta' })
      },
    )

    it(
      'over budget fails this card only — the stage and siblings stand',
      { timeout: 120_000 },
      async () => {
        await updateSettings(db, { budgets: { monthlyCeilingUsd: 0 } })

        await engine.executeStep('short-over-budget', { events: requestedEvent() })

        expect(broker.submitRender).not.toHaveBeenCalled()
        const rows = await db.select().from(renders)
        const failed = rows.find((row) => row.status === 'failed')
        expect(failed?.kind).toBe('short')
        expect(failed?.shortId).toBe(shortId)
        expect(failed?.error).toMatchObject({
          message: expect.stringContaining('budget ceiling'),
        })
        expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
      },
    )
  })
})
