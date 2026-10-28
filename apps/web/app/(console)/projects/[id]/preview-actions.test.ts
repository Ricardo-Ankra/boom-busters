// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  insertTimeline,
  latestTimeline,
  renders,
  requireTestDatabase,
  seed,
  timelines,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { setCaptions } from './preview-actions'

/**
 * The captions button (decision 326) against the test database: a stored
 * setting, appended as a new timeline version the renders then draw. Only
 * the session, cache revalidation and storage are replaced.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/inngest/client', () => ({ inngest: { send: vi.fn() } }))

const storage = vi.hoisted(() => ({ configured: false, putObject: vi.fn() }))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  putObject: storage.putObject,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

function master(style: Timeline['captions']['style']): Timeline {
  return {
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
    captions: {
      words: [{ text: 'Billions', startMs: 0, endMs: 600, timestampMs: 0, confidence: 1 }],
      style,
    },
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
  }
}

describeDb('setCaptions (decision 326)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    storage.configured = false
    await seed(db)
    await db.delete(renders)
    await db.delete(timelines)
  })

  it('stores the flip as a new version and keeps the caption words', async () => {
    await insertTimeline(db, { projectId: FIXTURE_PROJECT_ID, json: master('none'), s3Key: '' })

    expect(await setCaptions(FIXTURE_PROJECT_ID, true)).toEqual({ ok: true })

    const latest = await latestTimeline(db, FIXTURE_PROJECT_ID)
    expect(latest?.version).toBe(2)
    const json = latest?.json as Timeline
    expect(json.captions.style).toBe('karaoke')
    expect(json.captions.words.map((word) => word.text)).toEqual(['Billions'])
    expect(latest?.s3Key).toBe(`boom-busters/timelines/${FIXTURE_PROJECT_ID}/v2.json`)
  })

  it('uploads the new version when storage is configured', async () => {
    storage.configured = true
    await insertTimeline(db, { projectId: FIXTURE_PROJECT_ID, json: master('karaoke'), s3Key: '' })

    await setCaptions(FIXTURE_PROJECT_ID, false)

    const [key, body] = storage.putObject.mock.calls[0] as [string, Buffer]
    expect(key).toBe((await latestTimeline(db, FIXTURE_PROJECT_ID))?.s3Key)
    expect((JSON.parse(body.toString()) as Timeline).captions.style).toBe('none')
  })

  it('writes nothing when the timeline already says so', async () => {
    await insertTimeline(db, { projectId: FIXTURE_PROJECT_ID, json: master('none'), s3Key: '' })

    expect(await setCaptions(FIXTURE_PROJECT_ID, false)).toEqual({ ok: true })

    expect((await latestTimeline(db, FIXTURE_PROJECT_ID))?.version).toBe(1)
  })

  it('refuses before the assembly has compiled a timeline', async () => {
    const result = await setCaptions(FIXTURE_PROJECT_ID, true)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no compiled timeline')
  })
})
