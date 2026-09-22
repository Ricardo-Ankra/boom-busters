import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { findLogoByName, insertLogo, listLogos, logoByR2Key, removeLogo, renameLogo } from './logos'
import { assets } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * The logo library against a real database (decision 268). Marks are
 * `assets` rows of kind `logo`; the dedupe on re-upload and the name join
 * are the parts worth proving.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const STABILITY = {
  r2Key: 'boom-busters/logos/aaa.png',
  contentHash: 'logo-aaa',
  title: 'Stability AI',
  width: 1200,
  height: 400,
}

suite('the logo library', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${assets} restart identity cascade`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('stores a mark as a logo asset and lists marks by name', async () => {
    await insertLogo(db, {
      ...STABILITY,
      title: 'Wirecard AG',
      contentHash: 'logo-bbb',
      r2Key: 'boom-busters/logos/bbb.png',
    })
    await insertLogo(db, STABILITY)

    const logos = await listLogos(db)
    expect(logos.map((logo) => logo.title)).toEqual(['Stability AI', 'Wirecard AG'])
    expect(logos[0]).toMatchObject({
      kind: 'logo',
      licence: 'Uploaded by owner',
      width: 1200,
      height: 400,
    })
  })

  it('treats a re-upload of the same bytes as a rename, not a duplicate', async () => {
    const first = await insertLogo(db, STABILITY)
    const second = await insertLogo(db, {
      ...STABILITY,
      title: 'Stability AI Ltd',
      sourceUrl: 'https://x.example/logo.png',
    })

    expect(second?.id).toBe(first?.id)
    expect(second?.title).toBe('Stability AI Ltd')
    expect(second?.sourceUrl).toBe('https://x.example/logo.png')
    expect(await listLogos(db)).toHaveLength(1)
  })

  it('renames and removes, returning the row so the bytes can follow', async () => {
    const row = await insertLogo(db, STABILITY)
    expect((await renameLogo(db, row!.id, '  Stability  '))?.title).toBe('Stability')

    const removed = await removeLogo(db, row!.id)
    expect(removed?.r2Key).toBe(STABILITY.r2Key)
    expect(await listLogos(db)).toEqual([])
    expect(await removeLogo(db, row!.id)).toBeUndefined()
  })

  it('finds a mark by the name the planner wrote, tolerantly, and by its key', async () => {
    const row = await insertLogo(db, STABILITY)
    expect((await findLogoByName(db, 'stability ai, the image company'))?.id).toBe(row!.id)
    expect(await findLogoByName(db, 'AI')).toBeNull()
    expect((await logoByR2Key(db, STABILITY.r2Key))?.id).toBe(row!.id)
  })

  it('never lists a music bed as a logo', async () => {
    await db.insert(assets).values({
      kind: 'music',
      r2Key: 'boom-busters/music/x.mp3',
      contentHash: 'music-x',
      licence: 'yt-audio-library',
      title: 'A bed',
    })
    expect(await listLogos(db)).toEqual([])
    expect(await findLogoByName(db, 'A bed')).toBeNull()
  })

  it('refuses to upsert over a row that is not a logo, and leaves it untouched', async () => {
    const [image] = await db
      .insert(assets)
      .values({
        kind: 'image',
        r2Key: 'boom-busters/stock/still.png',
        contentHash: 'shared-hash',
        licence: 'stock',
        title: 'A stock still',
        width: 800,
        height: 600,
        sourceUrl: 'https://stock.example/still.png',
      })
      .returning()

    const result = await insertLogo(db, {
      r2Key: 'boom-busters/logos/renamed.png',
      contentHash: 'shared-hash',
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })

    expect(result).toBeNull()
    const [row] = await db.select().from(assets).where(eq(assets.id, image!.id))
    expect(row).toMatchObject({
      title: 'A stock still',
      width: 800,
      height: 600,
      sourceUrl: 'https://stock.example/still.png',
    })
  })
})
