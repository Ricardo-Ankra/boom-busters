// @vitest-environment node

import {
  chapterMarkingForProject,
  FIXTURE_PROJECT_ID,
  getProject,
  requireTestDatabase,
  seed,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchParagraphs, TRANSCRIBE_BATCH, transcribePerParagraphFits } from '../lib/slot-steps'
import { db } from '@/lib/db'
import { assemblyRunner } from './assembly-runner'

/**
 * The assembly runner's batched transcription branch.
 *
 * A film with more untimed paragraphs than the step limit allows two steps
 * apiece for is transcribed `TRANSCRIBE_BATCH` takes a job (steps
 * transcribe-batch-<n> and transcribe-batch-wait-<n>). The load step is given
 * as a step result, so the first batch's submit runs for real against a faked
 * broker. The harness cannot hand a wait a result (the engine validates the
 * mocked event before the harness resolves it), so the run cannot be driven
 * past the first batch: the batch count and the last short batch are checked
 * on `batchParagraphs`, the function the runner loops over.
 */

const broker = vi.hoisted(() => ({ submitMediaJob: vi.fn() }))
vi.mock('@/lib/broker', () => ({
  brokerCallbackUrl: () => 'http://localhost:3000/api/hooks/broker',
  submitMediaJob: broker.submitMediaJob,
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => false,
  putObject: vi.fn(),
}))
vi.mock('@boom-busters/providers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, mockProvidersEnabled: () => false }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

/** 2 x 490 + 9 fixed + 0 stock + 20 margin = 1009, over the 1000-step limit. */
const UNTIMED = 490

function paragraphs() {
  return Array.from({ length: UNTIMED }, (_, index) => ({
    chapterId: '01HQ0000000000000000000CH1',
    chapterIndex: 0,
    chapterTitle: 'Chapter one',
    paragraphIndex: index,
    r2Key: `boom-busters/voice/take-${index}.mp3`,
    durationMs: 4000,
    text: `Paragraph ${index}.`,
    timings: null,
    takeId: `01HQ00000000000000000TK${String(index).padStart(3, '0')}`,
  }))
}

describe('transcription batching thresholds', () => {
  it('keeps one job a paragraph up to the step limit and batches past it', () => {
    // 2 x 485 + 9 + 0 + 20 = 999 fits; one more paragraph makes 1001.
    expect(transcribePerParagraphFits(485, 0)).toBe(true)
    expect(transcribePerParagraphFits(486, 0)).toBe(false)
    expect(transcribePerParagraphFits(UNTIMED, 0)).toBe(false)
  })
})

describeDb('assembly-runner, batched transcription', () => {
  let engine: InngestTestEngine

  // The compile step reads the channel and the latest timeline for the fixture project.
  beforeAll(async () => {
    await seed(db)
  }, 120_000)

  beforeEach(() => {
    engine = new InngestTestEngine({ function: assemblyRunner })
    vi.clearAllMocks()
    broker.submitMediaJob.mockResolvedValue(undefined)
  })

  it(
    'submits the first whisper job with the first eight takes, and no per-paragraph job',
    { timeout: 120_000 },
    async () => {
      const all = paragraphs()
      const setup = {
        plan: { paragraphs: all, missing: [] },
        slots: [],
        assets: [],
        brand: resolveBrandKit(DEFAULT_SETTINGS),
        music: null,
      }

      await engine.executeStep('transcribe-batch-0', {
        events: [
          {
            name: 'gate/visuals.approved',
            data: { projectId: FIXTURE_PROJECT_ID, approvedBy: 'owner@example.com' },
          },
        ],
        steps: [{ id: 'load-assembly', handler: () => setup }],
      })

      type Job = { kind: string; audioS3Keys: string[] }
      const jobs = broker.submitMediaJob.mock.calls
        .map((call) => call[0] as Job)
        .filter((job) => job.kind === 'transcribe')
      expect(jobs.length).toBeGreaterThanOrEqual(1)
      for (const job of jobs) {
        expect(job.audioS3Keys).toEqual(all.slice(0, TRANSCRIBE_BATCH).map((p) => p.r2Key))
      }
    },
  )

  async function compileWith(
    chapterMarking: 'none' | 'cards' | 'title',
    options: { omitMarking?: boolean } = {},
  ) {
    {
      const timed = (chapter: number, text: string) => ({
        chapterId: `01HQ0000000000000000000CH${chapter}`,
        chapterIndex: chapter - 1,
        chapterTitle: `Chapter ${chapter}`,
        paragraphIndex: 0,
        r2Key: `boom-busters/voice/take-${chapter}.mp3`,
        durationMs: 4000,
        text,
        // Stored timings: the run needs no whisper job and no wait.
        timings: [{ text, startMs: 0, endMs: 4000 }],
        takeId: `01HQ00000000000000000TK00${chapter}`,
      })
      const setup = {
        plan: { paragraphs: [timed(1, 'Alpha'), timed(2, 'Beta')], missing: [] },
        slots: [
          {
            id: 'slot-1',
            type: 'stock' as const,
            status: 'resolved' as const,
            brief: {
              type: 'stock',
              coversText: 'Alpha',
              description: 'desc',
              motion: { kind: 'static' },
              transition: 'cut',
              query: 'trading floor',
              rejectionCriteria: [],
            },
            candidates: [
              {
                id: 'c1',
                provider: 'pexels',
                kind: 'image',
                sourceUrl: 'https://images.pexels.com/a.jpg',
                licence: 'Pexels License',
                chosen: true,
                r2Key: 'boom-busters/stock/a.jpg',
              },
            ],
            chosenAssetId: null,
            startMs: 0,
            durationMs: 4000,
          },
        ],
        assets: [],
        brand: resolveBrandKit(DEFAULT_SETTINGS),
        chapterMarking,
        filmTitle: 'The audit',
        music: null,
      }

      const { result } = await engine.executeStep('compile-timeline', {
        events: [
          {
            name: 'gate/visuals.approved',
            data: { projectId: FIXTURE_PROJECT_ID, approvedBy: 'owner@example.com' },
          },
        ],
        steps: [
          {
            id: 'load-assembly',
            handler: () => {
              if (!options.omitMarking) return setup
              // A setup memoised before decision 457 has neither field.
              const { chapterMarking: _marking, filmTitle: _title, ...replayed } = setup
              return replayed
            },
          },
        ],
      })

      return result as {
        ok: boolean
        timeline: {
          overlays: { kind: string; props?: Record<string, unknown> }[]
          chapters?: { title: string }[]
        }
      }
    }
  }

  const cardKinds = ['chapterCard', 'titleCard']

  it(
    'compiles with chapter marking none: no card overlays (decision 457)',
    {
      timeout: 120_000,
    },
    async () => {
      const compiled = await compileWith('none')
      expect(compiled.ok).toBe(true)
      expect(compiled.timeline.overlays.filter((o) => cardKinds.includes(o.kind))).toEqual([])
      expect(compiled.timeline.chapters?.map((chapter) => chapter.title)).toEqual([
        'Chapter 1',
        'Chapter 2',
      ])
    },
  )

  it(
    'compiles with chapter marking title: the film title at the second chapter',
    {
      timeout: 120_000,
    },
    async () => {
      const compiled = await compileWith('title')
      expect(compiled.ok).toBe(true)
      expect(compiled.timeline.overlays.filter((o) => cardKinds.includes(o.kind))).toMatchObject([
        { kind: 'titleCard', props: { title: 'The audit' } },
      ])
    },
  )

  it(
    'a setup replayed from before decision 457 keeps its chapter cards',
    {
      timeout: 120_000,
    },
    async () => {
      const compiled = await compileWith('cards', { omitMarking: true })
      expect(compiled.ok).toBe(true)
      expect(compiled.timeline.overlays.filter((o) => o.kind === 'chapterCard')).toHaveLength(1)
    },
  )

  it(
    'load-assembly reads the chapter marking live and the project title (decision 459)',
    { timeout: 120_000 },
    async () => {
      // The fixture has no voice takes, so the run would park on missing
      // narration after this step; the step's own result is what is checked.
      const { result } = await engine.executeStep('load-assembly', {
        events: [
          {
            name: 'gate/visuals.approved',
            data: { projectId: FIXTURE_PROJECT_ID, approvedBy: 'owner@example.com' },
          },
        ],
      })
      const project = await getProject(db, FIXTURE_PROJECT_ID)
      const loaded = result as { chapterMarking: string; filmTitle: string }
      expect(loaded.chapterMarking).toBe(await chapterMarkingForProject(db, FIXTURE_PROJECT_ID))
      expect(loaded.filmTitle).toBe(project!.title)
    },
  )

  it('splits the untimed paragraphs into ceil(untimed / 8) batches of at most eight', () => {
    const batches = batchParagraphs(paragraphs(), TRANSCRIBE_BATCH)
    expect(batches).toHaveLength(Math.ceil(UNTIMED / 8))
    expect(batches.every((batch) => batch.length > 0 && batch.length <= TRANSCRIBE_BATCH)).toBe(
      true,
    )
    expect(batches.flat()).toHaveLength(UNTIMED)
    // 490 = 61 x 8 + 2: the last batch is the short one.
    expect(batches[batches.length - 1]).toHaveLength(UNTIMED - 8 * (batches.length - 1))
  })
})
