import { sql as dsql } from 'drizzle-orm'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { fixtureCase, fixtureProject } from './fixtures'
import { cases, projects, timelines } from './schema'
import { insertTimeline, latestTimeline } from './timelines'
import { requireTestDatabase } from './test-database'

/**
 * Timeline versioning against a real database: append-only versions and
 * schema validation on the way in.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const CHAPTER = '01HQ0000000000000000000CH1'

function timeline(): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [
      {
        r2Key: 'boom-busters/voice/p0.wav',
        startMs: 0,
        durationMs: 8000,
        chapterId: CHAPTER,
        paragraphIndex: 0,
      },
    ],
    music: null,
    captions: { words: [], style: 'none' },
    slots: [
      {
        type: 'still',
        startMs: 0,
        durationMs: 8000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/a.png' } },
      },
    ],
    overlays: [],
  }
}

suite('timeline storage', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await db.insert(cases).values(fixtureCase)
    await db.insert(projects).values(fixtureProject)
  })

  afterAll(async () => {
    await sql.end()
  })

  it('versions are append-only and monotonically increasing', async () => {
    const first = await insertTimeline(db, {
      projectId: fixtureProject.id!,
      json: timeline(),
      s3Key: 'boom-busters/timelines/p1/v1.json',
    })
    const second = await insertTimeline(db, {
      projectId: fixtureProject.id!,
      json: timeline(),
      s3Key: 'boom-busters/timelines/p1/v2.json',
    })
    expect(first.version).toBe(1)
    expect(second.version).toBe(2)

    const latest = await latestTimeline(db, fixtureProject.id!)
    expect(latest?.version).toBe(2)
    expect(latest?.s3Key).toBe('boom-busters/timelines/p1/v2.json')
  })

  it('refuses JSON that does not parse as a Timeline', async () => {
    const broken = { ...timeline(), narration: [] }
    await expect(
      insertTimeline(db, {
        projectId: fixtureProject.id!,
        json: broken as unknown as Timeline,
        s3Key: 'boom-busters/timelines/p1/v1.json',
      }),
    ).rejects.toThrow()
    const rows = await db.select().from(timelines)
    expect(rows).toHaveLength(0)
  })
})
