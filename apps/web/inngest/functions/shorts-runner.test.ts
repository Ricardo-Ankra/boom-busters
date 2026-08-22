// @vitest-environment node

import {
  chapters,
  FIXTURE_PROJECT_ID,
  getProject,
  insertShort,
  insertTimeline,
  listShorts,
  renders,
  requireTestDatabase,
  scripts,
  seed,
  shorts,
  timelines,
  truncateRunMirror,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { seedTitle, shortsRunner } from './shorts-runner'

/**
 * The shorts-runner against the real database: candidates in, curatable rows
 * out, and one render event per row — the renders themselves belong to the
 * short-render-runner. What matters here: an unplaceable candidate is
 * SKIPPED with a reason, never guessed at; and a re-fired master.ready must
 * not trample rows the human already curated.
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
}))

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

describeDb('shorts-runner', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    engine = new InngestTestEngine({ function: shortsRunner })
    vi.clearAllMocks()
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(renders)
    await db.delete(shorts)
    await db.delete(timelines)
    await db.delete(scripts)

    const [script] = await db
      .insert(scripts)
      .values({
        projectId: FIXTURE_PROJECT_ID,
        version: 1,
        shortsCandidates: [
          {
            chapterIndex: 0,
            startSentence: 'EY refused to sign the accounts.',
            endSentence: 'The shares collapsed in nine days.',
            hookRationale: 'The auditor said no — that is the whole scandal in one line.',
          },
          {
            chapterIndex: 0,
            startSentence: 'A sentence that is not in the chapter at all.',
            endSentence: 'Nor is this one.',
            hookRationale: 'The model hallucinated this one.',
          },
        ],
      })
      .returning({ id: scripts.id })
    await db.insert(chapters).values({
      id: CHAPTER,
      scriptId: script!.id,
      index: 0,
      title: 'The audit',
      contentMd: CHAPTER_MD,
    })

    await insertTimeline(db, {
      projectId: FIXTURE_PROJECT_ID,
      json: canonicalMaster(),
      s3Key: '',
    })
  })

  it(
    'resolves candidates into rows, skips the unplaceable one with a reason',
    { timeout: 120_000 },
    async () => {
      // The fan-out step is stubbed: the engine would otherwise send its
      // events to a live Inngest server that does not exist in tests.
      const { result } = await engine.execute({
        events: masterReadyEvent(),
        steps: [{ id: 'request-short-renders', handler: () => undefined }],
      })

      expect(result).toMatchObject({ outcome: 'shorts-created', created: 1 })
      expect((result as { skipped: string[] }).skipped).toHaveLength(1)
      expect((result as { skipped: string[] }).skipped[0]).toContain('anchors not found')

      const rows = await listShorts(db, FIXTURE_PROJECT_ID)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        title: 'EY refused to sign the accounts.',
        segmentRef: { chapterId: CHAPTER, fromParagraph: 1, toParagraph: 2 },
        ending: 'cta',
        renderId: null,
      })

      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stage).toBe('shorts')
      expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
    },
  )

  it('a re-fired master.ready keeps the rows the human curated', { timeout: 120_000 }, async () => {
    await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'My hand-edited title',
      segmentRef: { chapterId: CHAPTER, fromParagraph: 0, toParagraph: 0 },
      ending: 'loop',
    })

    const { result } = await engine.execute({ events: masterReadyEvent() })

    expect(result).toMatchObject({ outcome: 'reused-existing', created: 0, reused: 1 })
    const rows = await listShorts(db, FIXTURE_PROJECT_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('My hand-edited title')
    expect(rows[0]?.ending).toBe('loop')
  })

  it('a script with no candidates parks the stage without rows', { timeout: 120_000 }, async () => {
    await db.update(scripts).set({ shortsCandidates: [] })

    const { result } = await engine.execute({ events: masterReadyEvent() })

    expect(result).toMatchObject({ outcome: 'no-candidates', created: 0 })
    expect(await listShorts(db, FIXTURE_PROJECT_ID)).toEqual([])
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.stageStatus).toBe('awaiting_review')
  })
})

describe('seedTitle', () => {
  it('strips markup and fits a title field', () => {
    expect(seedTitle('[grave] EY refused to sign.')).toBe('EY refused to sign.')
    const long = 'word '.repeat(40).trim()
    expect(seedTitle(long).length).toBeLessThanOrEqual(80)
    expect(seedTitle(long).endsWith('…')).toBe(true)
  })
})
