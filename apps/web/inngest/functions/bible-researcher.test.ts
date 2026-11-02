// @vitest-environment node

import {
  approvedScriptOpenings,
  bibleDrafts,
  chapters,
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getBibleDraft,
  openBibleDraft,
  requireTestDatabase,
  saveChapter,
  scripts,
  seed,
  setScriptStatus,
  truncateRunMirror,
  updateWorkspace,
  vidiqCredits,
  vidiqCreditsThisMonth,
  writeBibleDraft,
} from '@boom-busters/db'
import type * as ProvidersModule from '@boom-busters/providers'
import {
  estimateResearchCredits,
  planResearch,
  TRANSCRIPT_CAP,
} from '@boom-busters/providers/vidiq'
import type * as VidiqModule from '@boom-busters/providers/vidiq'
import {
  BibleResearchDigestSchema,
  bibleDraftUnits,
  DEFAULT_WORKSPACE_SETTINGS,
  FIRST_CHANNEL_ID,
  jobIsRunning,
} from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { NonRetriableError } from 'inngest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { bibleResearcher, failBibleResearch } from './bible-researcher'

/**
 * The bible researcher in mock-provider mode against the real database: every
 * VidIQ call lands one ledger row, the stored digest holds no transcript, and a
 * failed run leaves its reason on the draft.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const seams = vi.hoisted(() => ({
  clientOverride: null as null | ((real: unknown) => unknown),
  digest: null as null | (() => never),
}))

vi.mock('@boom-busters/providers/vidiq', async (importOriginal) => {
  const original = await importOriginal<typeof VidiqModule>()
  return {
    ...original,
    vidiqClientFor: (key: string | undefined) => {
      const real = original.vidiqClientFor(key)
      return seams.clientOverride ? seams.clientOverride(real) : real
    },
  }
})
vi.mock('@boom-busters/providers', async (importOriginal) => {
  const original = await importOriginal<typeof ProvidersModule>()
  return {
    ...original,
    mockResearchDigest: (inputs: Parameters<typeof original.mockResearchDigest>[0]) =>
      seams.digest ? seams.digest() : original.mockResearchDigest(inputs),
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

const INPUTS = {
  description: 'Stories of brands that collapsed',
  audience: 'Curious adults',
  admiredChannels: ['@alpha', '@beta'],
  videos: ['https://youtu.be/dQw4w9WgXcQ'],
  avoid: '',
}

const request = (
  jobStartedAt?: string,
): { events: [{ name: string; data: { channelId: string; jobStartedAt?: string } }] } => ({
  events: [
    {
      name: 'bible/research.requested',
      data: { channelId: FIRST_CHANNEL_ID, ...(jobStartedAt ? { jobStartedAt } : {}) },
    },
  ],
})

/** Every longest string in a value, so a stored transcript would show. */
function longestString(value: unknown): number {
  if (typeof value === 'string') return value.length
  if (Array.isArray(value)) return Math.max(0, ...value.map(longestString))
  if (value && typeof value === 'object') {
    return Math.max(0, ...Object.values(value).map(longestString))
  }
  return 0
}

describeDb('bible-researcher (mock mode)', () => {
  let engine: InngestTestEngine

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    seams.clientOverride = null
    seams.digest = null
    engine = new InngestTestEngine({ function: bibleResearcher })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    await db.delete(scripts)
    await db.delete(bibleDrafts)
    await db.delete(vidiqCredits)
    await openBibleDraft(db, FIRST_CHANNEL_ID)
    await writeBibleDraft(db, FIRST_CHANNEL_ID, (draft) => ({
      ...draft,
      inputs: INPUTS,
      job: {
        kind: 'research',
        state: 'running',
        current: null,
        error: null,
        startedAt: new Date().toISOString(),
      },
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const handOver = { id: 'draft-requested', handler: () => undefined }

  it('records one ledger row per call, matching the estimate, and stores only the digest', async () => {
    const { result, ctx } = await engine.execute({ ...request(), steps: [handOver] })
    expect(result).toMatchObject({ outcome: 'researched' })

    const rows = await db.select().from(vidiqCredits)
    // Two channels, one batched lookup, the outliers, and the transcripts.
    expect(rows).toHaveLength(4 + TRANSCRIPT_CAP)
    const plan = planResearch(INPUTS, { handle: null, language: 'en' })
    if ('error' in plan) throw new Error(plan.error)
    expect(rows.reduce((sum, row) => sum + row.credits, 0)).toBe(estimateResearchCredits(plan))
    expect(await vidiqCreditsThisMonth(db)).toBe(estimateResearchCredits(plan))
    expect(rows.every((row) => row.channelId === FIRST_CHANNEL_ID && row.projectId === null)).toBe(
      true,
    )

    const draft = await getBibleDraft(db, FIRST_CHANNEL_ID)
    expect(BibleResearchDigestSchema.safeParse(draft?.research).success).toBe(true)
    expect(longestString(draft?.research)).toBeLessThanOrEqual(900)
    // The drafting run follows at once, so the draft stays locked.
    expect(draft?.job).toMatchObject({ kind: 'draft', state: 'running', error: null })

    expect(ctx.step.sendEvent).toHaveBeenCalledWith(
      'draft-requested',
      expect.objectContaining({
        name: 'bible/draft.requested',
        data: {
          channelId: FIRST_CHANNEL_ID,
          units: bibleDraftUnits(),
          jobStartedAt: expect.any(String),
        },
      }),
    )
    // The drafting job it hands over stores the units for Try again, and the event names it.
    const sent = (
      ctx.step.sendEvent as unknown as {
        mock: { calls: [string, { data: { jobStartedAt: string } }][] }
      }
    ).mock.calls[0]![1]
    expect(draft?.job?.startedAt).toBe(sent.data.jobStartedAt)
    expect(draft?.job?.units).toEqual(bibleDraftUnits())
  })

  it('adds no ledger row for a step a restart has already memoised', async () => {
    const video = (n: number, views: number) => ({
      videoId: `video${String(n).padStart(6, '0')}`,
      title: `Video ${n}`,
      channel: 'Other',
      views,
    })
    const plan = planResearch(INPUTS, { handle: null, language: 'en' })
    if ('error' in plan) throw new Error(plan.error)
    const memoised = [
      {
        id: 'plan',
        handler: () => ({ inputs: INPUTS, plan, channelName: 'Boom & Busters' }),
      },
      { id: 'channel-videos-0', handler: () => [video(1, 900), video(2, 800)] },
      { id: 'channel-videos-1', handler: () => [video(3, 700)] },
      { id: 'videos-by-ids', handler: () => [video(4, 600)] },
      { id: 'outliers', handler: () => [video(5, 500)] },
      handOver,
    ]
    await engine.execute({ ...request(), steps: memoised })

    // The memoised steps made no call and wrote no row: only the transcripts did.
    const rows = await db.select().from(vidiqCredits)
    expect(rows).toHaveLength(TRANSCRIPT_CAP)
    expect(rows.every((row) => row.tool === 'vidiq_video_transcript')).toBe(true)
    expect(rows.map((row) => (row.args as { videoId: string }).videoId).sort()).toEqual([
      'video000001',
      'video000002',
      'video000003',
      'video000004',
    ])
  })

  it('records a transcript that VidIQ refuses as no opening, charging nothing for it', async () => {
    const { VidiqError } = await import('@boom-busters/providers/vidiq')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let first = true
    seams.clientOverride = (real) => ({
      ...(real as object),
      videoTranscript: async (args: unknown) => {
        if (first) {
          first = false
          throw new VidiqError('vidiq_video_transcript', 'No transcript for this video')
        }
        return (real as { videoTranscript: (a: unknown) => unknown }).videoTranscript(args)
      },
    })
    const { result } = await engine.execute({ ...request(), steps: [handOver] })
    expect(result).toMatchObject({ outcome: 'researched' })
    expect(await db.select().from(vidiqCredits)).toHaveLength(4 + TRANSCRIPT_CAP - 1)
  })

  it('stops, without calling VidIQ, when the monthly cap would be crossed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 3 } })
    const { error } = await engine.execute(request())
    expect(JSON.stringify(error)).toContain('The VidIQ cap is reached')
    expect(await db.select().from(vidiqCredits)).toHaveLength(0)
  })

  it('leaves the reason on the draft when the digest fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    seams.digest = () => {
      throw new NonRetriableError('The research digest could not be written: the answer was empty')
    }
    const { error } = await engine.execute(request())
    expect(JSON.stringify(error)).toContain('the answer was empty')

    // The harness does not run `onFailure`, so it is called as Inngest would.
    const opts = (
      bibleResearcher as unknown as {
        opts: { onFailure: (args: unknown) => Promise<void> }
      }
    ).opts
    await opts.onFailure({
      event: {
        data: {
          event: { data: { channelId: FIRST_CHANNEL_ID } },
          error: { message: 'The research digest could not be written: the answer was empty' },
        },
      },
    })
    const draft = await getBibleDraft(db, FIRST_CHANNEL_ID)
    expect(draft?.job).toMatchObject({
      state: 'failed',
      error: 'The research digest could not be written: the answer was empty',
    })
    expect(draft?.research).toBeNull()
  })

  it('reads the opening of the channel’s approved scripts, up to ten and 300 characters', async () => {
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'One',
      contentMd: 'x'.repeat(500),
      estRuntimeSec: 10,
    })
    expect(await approvedScriptOpenings(db, FIRST_CHANNEL_ID, 10)).toEqual([])
    await setScriptStatus(db, script.id, 'approved')
    expect(await approvedScriptOpenings(db, FIRST_CHANNEL_ID, 10)).toEqual(['x'.repeat(300)])

    // One opening per project, the newest approved script's first chapter.
    await saveChapter(db, {
      scriptId: script.id,
      index: 1,
      title: 'Two',
      contentMd: 'second chapter',
      estRuntimeSec: 10,
    })
    const second = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    await saveChapter(db, {
      scriptId: second.id,
      index: 0,
      title: 'One',
      contentMd: 'another script',
      estRuntimeSec: 10,
    })
    await setScriptStatus(db, second.id, 'approved')
    expect(await approvedScriptOpenings(db, FIRST_CHANNEL_ID, 10)).toEqual(['another script'])
    expect(await approvedScriptOpenings(db, FIRST_CHANNEL_ID, 0)).toEqual([])
    await db.delete(chapters)
    expect(await approvedScriptOpenings(db, FIRST_CHANNEL_ID, 10)).toEqual([])
  })
  describe('the job it owns', () => {
    /** The research job the action started, `startedAt` forty minutes ago. */
    async function oldJob(): Promise<string> {
      const startedAt = new Date(Date.now() - 40 * 60_000).toISOString()
      await writeBibleDraft(
        db,
        FIRST_CHANNEL_ID,
        (draft) => ({ ...draft, job: { ...draft.job!, startedAt } }),
        { allowWhileRunning: true },
      )
      return startedAt
    }

    it('refreshes the heartbeat before it spends, so a long run stays alive', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const startedAt = await oldJob()
      // The run stops at its first call (the cap), after the heartbeat.
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 3 } })
      await engine.execute(request(startedAt))
      const job = (await getBibleDraft(db, FIRST_CHANNEL_ID))!.job!
      expect(job.startedAt).toBe(startedAt)
      expect(Date.now() - Date.parse(job.heartbeatAt!)).toBeLessThan(60_000)
      expect(jobIsRunning(job)).toBe(true)
    })

    it('a run that lost its job stops before it calls VidIQ and leaves the newer job alone', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const before = (await getBibleDraft(db, FIRST_CHANNEL_ID))!.job
      const lost = new Date(Date.now() - 5 * 60_000).toISOString()
      const { error } = await engine.execute(request(lost))
      expect(JSON.stringify(error)).toContain('A newer job has taken the draft')
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)

      const opts = (
        bibleResearcher as unknown as { opts: { onFailure: (args: unknown) => Promise<void> } }
      ).opts
      await opts.onFailure({
        event: {
          data: {
            event: { data: { channelId: FIRST_CHANNEL_ID, jobStartedAt: lost } },
            error: { message: 'A newer job has taken the draft' },
          },
        },
      })
      expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.job).toEqual(before)
    })

    it('the fail writer marks the job it owns failed', async () => {
      const startedAt = (await getBibleDraft(db, FIRST_CHANNEL_ID))!.job!.startedAt
      await failBibleResearch(FIRST_CHANNEL_ID, 'VidIQ did not answer', startedAt)
      expect((await getBibleDraft(db, FIRST_CHANNEL_ID))!.job).toMatchObject({
        kind: 'research',
        state: 'failed',
        error: 'VidIQ did not answer',
        startedAt,
      })
    })
  })
})
