// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  getShort,
  insertRender,
  insertShort,
  insertTimeline,
  renders,
  requireTestDatabase,
  seed,
  shorts,
  updateRender,
  updateShort,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { TeaserFetchesRecord } from '@boom-busters/schemas'
import { TEASER_CHAPTER_ID } from '@boom-busters/timeline'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { fetchTeaserShotOptions, requestShortRender } from './shorts-actions'

/**
 * The in-flight refusals (decision 234): a button pressed twice must spend
 * once. These run the real actions against the test database, with only the
 * seams a server action cannot bring to a unit test (session, cache
 * revalidation, the Inngest client) replaced.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const send = vi.hoisted(() => vi.fn())
vi.mock('@/inngest/client', () => ({ inngest: { send } }))

const describeDb = requireTestDatabase() ? describe : describe.skip

const STORED_SCRIPT = {
  title: 'The audit that said no',
  paragraphs: [
    { text: 'One number was missing, and it was billions.', chapterIndex: 0 },
    { text: 'The auditors finally refused to sign anything at all.', chapterIndex: 0 },
  ],
  scriptVersion: 1,
}

async function insertTeaser(fetches?: TeaserFetchesRecord) {
  const short = await insertShort(db, {
    projectId: FIXTURE_PROJECT_ID,
    title: 'Curated by hand',
    segmentRef: { chapterId: TEASER_CHAPTER_ID, fromParagraph: 0, toParagraph: 1 },
    kind: 'teaser',
    teaserScript: STORED_SCRIPT,
  })
  if (fetches) {
    await updateShort(db, short.id, {
      teaserFetches: fetches as unknown as Record<string, unknown>,
    })
  }
  return short
}

function fetchingBeat(startedAt: string | undefined): TeaserFetchesRecord {
  return {
    beats: [
      {
        state: { state: 'fetching', what: 'stock', ...(startedAt ? { startedAt } : {}) },
        candidates: [],
      },
    ],
  }
}

describeDb('shorts action guards (decision 234)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    send.mockResolvedValue(undefined)
    await seed(db)
    await db.delete(renders)
    await db.delete(shorts)
  })

  it('refuses a second fetch while the beat is freshly fetching', async () => {
    const short = await insertTeaser(fetchingBeat(new Date().toISOString()))

    const result = await fetchTeaserShotOptions(short.id, 0, 'collapsing headquarters')

    expect(result.ok).toBe(false)
    expect(result.error).toContain('already fetching')
    expect(send).not.toHaveBeenCalled()
  })

  it('lets a stale fetching state retry: a dead runner cannot lock the beat', async () => {
    const short = await insertTeaser(
      fetchingBeat(new Date(Date.now() - 11 * 60 * 1000).toISOString()),
    )

    const result = await fetchTeaserShotOptions(short.id, 0, 'collapsing headquarters')

    expect(result.ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a record from before the guard (no timestamp) may also retry', async () => {
    const short = await insertTeaser(fetchingBeat(undefined))

    const result = await fetchTeaserShotOptions(short.id, 0, 'collapsing headquarters')

    expect(result.ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('stamps startedAt on the state it writes', async () => {
    const short = await insertTeaser()

    await fetchTeaserShotOptions(short.id, 0, 'collapsing headquarters')

    const stored = (await getShort(db, short.id))?.teaserFetches as TeaserFetchesRecord
    const state = stored.beats[0]?.state
    expect(state?.state).toBe('fetching')
    expect(state && 'startedAt' in state && state.startedAt).toBeTruthy()
  })

  it('refuses a re-render while the card render is still moving', async () => {
    const short = await insertTeaser()
    const render = await insertRender(db, {
      projectId: FIXTURE_PROJECT_ID,
      timelineVersion: 1,
      kind: 'short',
      shortId: short.id,
      costUsd: '0.05',
    })
    await updateShort(db, short.id, { renderId: render.id })

    const result = await requestShortRender(short.id)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('already rendering')
    expect(send).not.toHaveBeenCalled()
  })

  /**
   * Decision 300: an excerpt cut from an earlier script points at narration
   * the master no longer has. The button says so instead of starting a run
   * that can only fail.
   */
  it('refuses to render an excerpt whose narration is no longer in the master', async () => {
    await insertTimeline(db, {
      projectId: FIXTURE_PROJECT_ID,
      json: {
        version: 1,
        fps: 30,
        width: 1920,
        height: 1080,
        brand: resolveBrandKit(DEFAULT_SETTINGS),
        narration: [
          {
            r2Key: 'mock://voice/p0.wav',
            startMs: 0,
            durationMs: 6000,
            chapterId: '01HQ0000000000000000000CH1',
            paragraphIndex: 0,
          },
        ],
        music: null,
        captions: { words: [], style: 'karaoke' },
        slots: [
          {
            type: 'still',
            startMs: 0,
            durationMs: 6000,
            transition: 'cut',
            motion: { kind: 'static' },
            payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/x.png' } },
          },
        ],
        overlays: [],
      },
      s3Key: '',
    })
    const stale = await insertShort(db, {
      projectId: FIXTURE_PROJECT_ID,
      title: 'Cut from the old script',
      segmentRef: { chapterId: '01HQ0000000000000000000OLD', fromParagraph: 3, toParagraph: 4 },
    })

    const result = await requestShortRender(stale.id)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('cut from an earlier script')
    expect(send).not.toHaveBeenCalled()
  })

  it('allows a re-render once the render settled', async () => {
    const short = await insertTeaser()
    const render = await insertRender(db, {
      projectId: FIXTURE_PROJECT_ID,
      timelineVersion: 1,
      kind: 'short',
      shortId: short.id,
      costUsd: '0.05',
    })
    await updateRender(db, render.id, { status: 'done' })
    await updateShort(db, short.id, { renderId: render.id })

    const result = await requestShortRender(short.id)

    expect(result.ok).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
