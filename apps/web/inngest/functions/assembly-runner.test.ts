// @vitest-environment node

import { FIXTURE_PROJECT_ID, requireTestDatabase } from '@boom-busters/db'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { batchParagraphs, TRANSCRIBE_BATCH, transcribePerParagraphFits } from '../lib/slot-steps'
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
