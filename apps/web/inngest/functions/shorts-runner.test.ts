// @vitest-environment node

import {
  approveTalkingPointSet,
  chapters,
  FIXTURE_PROJECT_ID,
  getProject,
  insertShort,
  insertTalkingPointSet,
  insertTimeline,
  listShorts,
  notices,
  renders,
  requireTestDatabase,
  scripts,
  seed,
  shorts,
  talkingPointSets,
  timelines,
  truncateRunMirror,
} from '@boom-busters/db'
import { mockTalkingPoints } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { TalkingPoint, Timeline } from '@boom-busters/schemas'
import { TEASER_CHAPTER_ID } from '@boom-busters/timeline'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { inngest } from '../client'
import { forgetRunRows } from '../middleware/run-mirror'
import { shortsRunner } from './shorts-runner'

/**
 * The shorts-runner against the real database (playbook Shorts design 3.1
 * and 3.5): it only decides what to ask for. With no approved talking-point
 * set it asks for a proposal; with one it asks for a build per point that has
 * no Short yet. Nothing here cuts a row, and legacy excerpt and teaser rows
 * are left as they are.
 */

vi.mock('@/lib/broker', () => ({
  brokerConfigured: () => false,
  brokerCallbackUrl: () => 'http://localhost:3000/api/hooks/broker',
  submitRender: vi.fn(),
  submitMediaJob: vi.fn(),
  fetchRenderProgress: vi.fn(),
  cancelRender: vi.fn(),
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
  // No bucket in tests and the providers are mocked: the teaser's audio keys
  // take the mock:// shape, same as voice takes.
  takeStorage: () => 'regenerated' as const,
}))

// The teaser's script call (decision 293). The mock-mode tests never reach it.
const callLlm = vi.hoisted(() => vi.fn())
vi.mock('@/lib/llm', () => ({ callLlm }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const CHAPTER = '01HQ0000000000000000000CH1'
const RENDER_ID = '01HQ0000000000000000000RD1'

const CHAPTER_MD =
  'By June, the auditors could not find the money.\n\n' +
  'EY refused to sign the accounts.\n\n' +
  'The shares collapsed in nine days.'

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

function masterReadyEvent(): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'project/master.ready',
      data: { projectId: FIXTURE_PROJECT_ID, renderId: RENDER_ID },
    },
  ]
}

const POINT_IDS = [1, 2, 3].map((n) => `01HQ0000000000000000000P0${n}`)

async function storeApprovedSet(): Promise<TalkingPoint[]> {
  const drafts = mockTalkingPoints(
    [0, 1, 2].map((index) => ({
      index,
      title: `Chapter ${index + 1}`,
      contentMd: `Narration of chapter ${index + 1}.

A second paragraph.`,
    })),
  )
  const points: TalkingPoint[] = POINT_IDS.map((id, i) => ({
    ...drafts[i]!,
    id,
    sourceChapters: [i],
    order: i + 1,
  }))
  const set = await insertTalkingPointSet(db, {
    projectId: FIXTURE_PROJECT_ID,
    scriptVersion: 1,
    points,
    note: null,
  })
  await approveTalkingPointSet(db, FIXTURE_PROJECT_ID, set.version)
  return points
}

async function builtPointShort(pointId: string) {
  return insertShort(db, {
    projectId: FIXTURE_PROJECT_ID,
    title: 'A built point Short',
    segmentRef: { chapterId: TEASER_CHAPTER_ID, fromParagraph: 0, toParagraph: 0 },
    kind: 'point',
    pointId,
    sourceTimeline: canonicalMaster() as unknown as Record<string, unknown>,
  })
}

describeDb('shorts-runner', () => {
  let engine: InngestTestEngine
  let send: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: shortsRunner })
    vi.clearAllMocks()
    send = vi
      .spyOn(inngest as unknown as { _send: () => unknown }, '_send')
      .mockResolvedValue({ ids: [] }) as unknown as typeof send
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(notices)
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await db.delete(talkingPointSets)
    await db.delete(scripts)

    const [script] = await db
      .insert(scripts)
      .values({ projectId: FIXTURE_PROJECT_ID, version: 1 })
      .returning({ id: scripts.id })
    await db.insert(chapters).values({
      id: CHAPTER,
      scriptId: script!.id,
      index: 0,
      title: 'The audit',
      contentMd: CHAPTER_MD,
    })
    await insertTimeline(db, { projectId: FIXTURE_PROJECT_ID, json: canonicalMaster(), s3Key: '' })
  })

  /**
   * Every event the run asked Inngest to send. A step.sendEvent reaches the
   * client's private `_send`, which the spy answers instead of a live server.
   */
  function sentEvents(): { name: string; data: Record<string, unknown> }[] {
    return send.mock.calls.flatMap(([request]) => {
      const { payload } = request as { payload: unknown }
      const list = (Array.isArray(payload) ? payload : [payload]) as {
        name: string
        data: Record<string, unknown>
      }[]
      return list.map(({ name, data }) => ({ name, data }))
    })
  }

  const run = () => engine.execute({ events: masterReadyEvent() })

  it(
    'asks the talking-points runner for a proposal when none is approved',
    { timeout: 120_000 },
    async () => {
      const { result } = await run()

      expect(result).toMatchObject({ outcome: 'points-requested' })
      expect(sentEvents()).toEqual([
        {
          name: 'shorts/points.requested',
          data: { projectId: FIXTURE_PROJECT_ID, mode: 'all', note: null },
        },
      ])
      expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(0)
      // The talking-points runner parks the stage; this runner only marks it running.
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('running')
    },
  )

  it(
    'with an approved set of three and one built, builds the other two and moves to review',
    { timeout: 120_000 },
    async () => {
      await storeApprovedSet()
      await builtPointShort(POINT_IDS[0]!)

      const { result } = await run()

      expect(result).toMatchObject({ outcome: 'builds-requested', requested: 2, kept: 1 })
      expect(sentEvents()).toEqual([
        {
          name: 'shorts/point.build.requested',
          data: { projectId: FIXTURE_PROJECT_ID, pointId: POINT_IDS[1] },
        },
        {
          name: 'shorts/point.build.requested',
          data: { projectId: FIXTURE_PROJECT_ID, pointId: POINT_IDS[2] },
        },
      ])
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project).toMatchObject({ stage: 'shorts', stageStatus: 'awaiting_review' })
      expect(project?.shortsPhase).toBe('review')
      expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(1)
    },
  )

  it(
    'asks again for a point whose build was cut off, a draft row with no master',
    { timeout: 120_000 },
    async () => {
      await storeApprovedSet()
      await insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'Draft',
        segmentRef: { chapterId: TEASER_CHAPTER_ID, fromParagraph: 0, toParagraph: 4 },
        kind: 'point',
        pointId: POINT_IDS[0]!,
      })

      const { result } = await run()

      expect(result).toMatchObject({ outcome: 'builds-requested', requested: 3, kept: 0 })
    },
  )

  /** Review Focus 3: master.ready after Back to visuals must not re-pause, re-propose or re-buy. */
  it(
    'a re-fired master.ready with every point built requests nothing and lands on review',
    { timeout: 120_000 },
    async () => {
      await storeApprovedSet()
      for (const id of POINT_IDS) await builtPointShort(id)

      const { result } = await run()

      expect(result).toMatchObject({ outcome: 'reused-existing', requested: 0, kept: 3 })
      expect(sentEvents()).toEqual([])
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      expect(project).toMatchObject({ stageStatus: 'awaiting_review', shortsPhase: 'review' })
      expect(await listShorts(db, FIXTURE_PROJECT_ID)).toHaveLength(3)
    },
  )

  it(
    'leaves legacy teaser and excerpt rows exactly as they are',
    { timeout: 120_000 },
    async () => {
      await insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'A hand-edited excerpt',
        segmentRef: { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 0 },
        ending: 'loop',
      })
      await insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'The teaser',
        segmentRef: { chapterId: TEASER_CHAPTER_ID, fromParagraph: 0, toParagraph: 1 },
        kind: 'teaser',
      })
      const before = await listShorts(db, FIXTURE_PROJECT_ID)

      await run()

      expect(await listShorts(db, FIXTURE_PROJECT_ID)).toEqual(before)
    },
  )

  it(
    'still deletes an excerpt whose narration left the master (decision 300)',
    { timeout: 120_000 },
    async () => {
      await insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'Cut from the old script',
        segmentRef: { chapterId: '01HQ0000000000000000000OLD', fromParagraph: 3, toParagraph: 4 },
      })
      await insertShort(db, {
        projectId: FIXTURE_PROJECT_ID,
        title: 'Still in the master',
        segmentRef: { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 0 },
      })

      const { result } = await run()

      expect(result).toMatchObject({ replaced: 1 })
      const rows = await listShorts(db, FIXTURE_PROJECT_ID)
      expect(rows.map((row) => row.title)).toEqual(['Still in the master'])
    },
  )
})
