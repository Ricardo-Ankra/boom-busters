import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { deleteMusicBed, insertMusicBed, listMusicBeds } from './music'
import { countMusicBeds } from './queries'
import { assets } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * The music library against a real database — beds are `assets` rows, and
 * the dedupe/refresh behaviour on re-upload is the part worth proving.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const BED = {
  r2Key: 'boom-busters/music/abc123.mp3',
  contentHash: 'music-abc123',
  title: 'Documentary tension 01',
  licence: 'yt-audio-library',
  moodTags: ['tension', 'slow build'],
}

suite('the music library', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${assets} restart identity cascade`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('stores a bed and lists it newest first', async () => {
    await insertMusicBed(db, BED)
    await insertMusicBed(db, {
      ...BED,
      contentHash: 'music-def456',
      r2Key: 'boom-busters/music/def456.mp3',
      title: 'Second',
    })

    const beds = await listMusicBeds(db)
    expect(beds).toHaveLength(2)
    expect(beds[0]?.title).toBe('Second')
    expect(beds[1]?.moodTags).toEqual(['tension', 'slow build'])
    expect(await countMusicBeds(db)).toBe(2)
  })

  it('treats a re-upload as a rename, not a duplicate', async () => {
    const first = await insertMusicBed(db, BED)
    const second = await insertMusicBed(db, {
      ...BED,
      title: 'Renamed',
      licence: 'other',
      moodTags: ['renamed'],
    })

    expect(second.id).toBe(first.id)
    // Same bytes, same home — the original key survives the refresh.
    expect(second.r2Key).toBe(first.r2Key)
    expect(second.title).toBe('Renamed')
    expect(await listMusicBeds(db)).toHaveLength(1)
  })

  it('deletes a bed and hands back the row so the bytes can be removed', async () => {
    const bed = await insertMusicBed(db, BED)
    const removed = await deleteMusicBed(db, bed.id)

    expect(removed?.r2Key).toBe(BED.r2Key)
    expect(await listMusicBeds(db)).toHaveLength(0)
    expect(await deleteMusicBed(db, bed.id)).toBeUndefined()
  })

  it('only ever deletes music — an image asset is not reachable from here', async () => {
    const [image] = await db
      .insert(assets)
      .values({
        kind: 'image',
        r2Key: 'boom-busters/stills/x.png',
        licence: 'generated',
        contentHash: 'still-x',
      })
      .returning()

    expect(await deleteMusicBed(db, image!.id)).toBeUndefined()
  })
})
