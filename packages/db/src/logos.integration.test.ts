import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import { createChannel, ensureFirstChannel, getChannelBySlug } from './channels'
import { createDb } from './client'
import {
  assetObjectInUse,
  findLogoByName,
  insertLogo,
  listLogos,
  logoById,
  logoByR2Key,
  removeLogo,
  renameLogo,
} from './logos'
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

  let A = ''
  let B = ''

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${assets} restart identity cascade`)
    A = (await ensureFirstChannel(db)).id
    B = (await ensureSecondChannel()).id
  })

  async function ensureSecondChannel() {
    const existing = await getChannelBySlug(db, 'second-test')
    if (existing) return existing
    return createChannel(db, {
      name: 'Second test channel',
      handle: null,
      slug: 'second-test',
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
  }

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('stores a mark as a logo asset and lists marks by name', async () => {
    await insertLogo(db, A, {
      ...STABILITY,
      title: 'Wirecard AG',
      contentHash: 'logo-bbb',
      r2Key: 'boom-busters/logos/bbb.png',
    })
    await insertLogo(db, A, STABILITY)

    const logos = await listLogos(db, A)
    expect(logos.map((logo) => logo.title)).toEqual(['Stability AI', 'Wirecard AG'])
    expect(logos[0]).toMatchObject({
      kind: 'logo',
      licence: 'Uploaded by owner',
      width: 1200,
      height: 400,
    })
  })

  it('treats a re-upload of the same bytes as a rename, not a duplicate', async () => {
    const first = await insertLogo(db, A, STABILITY)
    const second = await insertLogo(db, A, {
      ...STABILITY,
      title: 'Stability AI Ltd',
      sourceUrl: 'https://x.example/logo.png',
    })

    expect(second?.id).toBe(first?.id)
    expect(second?.title).toBe('Stability AI Ltd')
    expect(second?.sourceUrl).toBe('https://x.example/logo.png')
    expect(await listLogos(db, A)).toHaveLength(1)
  })

  it('updates the one row when the same bytes are re-uploaded on the same channel', async () => {
    await insertLogo(db, A, STABILITY)
    await insertLogo(db, A, { ...STABILITY, title: 'Renamed' })
    const rows = await db.select().from(assets).where(eq(assets.contentHash, STABILITY.contentHash))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ title: 'Renamed', channelId: A })
  })

  it('keeps one library per channel: the same bytes are two rows with one key', async () => {
    const a = await insertLogo(db, A, STABILITY)
    const b = await insertLogo(db, B, { ...STABILITY, title: 'Wirecard AG' })

    expect(a?.id).not.toBe(b?.id)
    expect(a?.r2Key).toBe(b?.r2Key)
    expect(b?.channelId).toBe(B)
    expect((await listLogos(db, A)).map((l) => l.id)).toEqual([a?.id])
    expect((await listLogos(db, B)).map((l) => l.id)).toEqual([b?.id])
    expect((await findLogoByName(db, B, 'Wirecard AG'))?.id).toBe(b?.id)
    expect(await findLogoByName(db, B, 'Stability AI')).toBeNull()
    expect((await logoByR2Key(db, B, STABILITY.r2Key))?.id).toBe(b?.id)
    expect((await logoByR2Key(db, A, STABILITY.r2Key))?.id).toBe(a?.id)
  })

  it('renames and removes, returning the row so the bytes can follow', async () => {
    const row = await insertLogo(db, A, STABILITY)
    expect((await renameLogo(db, row!.id, '  Stability  '))?.title).toBe('Stability')

    const removed = await removeLogo(db, row!.id)
    expect(removed?.r2Key).toBe(STABILITY.r2Key)
    expect(await listLogos(db, A)).toEqual([])
    expect(await removeLogo(db, row!.id)).toBeUndefined()
  })

  it('finds a mark by the name the planner wrote, tolerantly, and by its key', async () => {
    const row = await insertLogo(db, A, STABILITY)
    expect((await findLogoByName(db, A, 'stability ai, the image company'))?.id).toBe(row!.id)
    expect(await findLogoByName(db, A, 'AI')).toBeNull()
    expect((await logoByR2Key(db, A, STABILITY.r2Key))?.id).toBe(row!.id)
  })

  it('finds a mark by id, and refuses a music bed with the same id shape', async () => {
    const row = await insertLogo(db, A, STABILITY)
    expect((await logoById(db, row!.id))?.title).toBe('Stability AI')
    expect(await logoById(db, '01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBeNull()

    const [bed] = await db
      .insert(assets)
      .values({
        kind: 'music',
        r2Key: 'boom-busters/music/x.mp3',
        contentHash: 'music-x',
        licence: 'yt-audio-library',
        title: 'A bed',
      })
      .returning()
    expect(await logoById(db, bed!.id)).toBeNull()
  })

  it('never lists a music bed as a logo', async () => {
    await db.insert(assets).values({
      kind: 'music',
      r2Key: 'boom-busters/music/x.mp3',
      contentHash: 'music-x',
      licence: 'yt-audio-library',
      title: 'A bed',
    })
    expect(await listLogos(db, A)).toEqual([])
    expect(await findLogoByName(db, A, 'A bed')).toBeNull()
  })

  it('stores a mark beside a shared asset with the same hash, and leaves that asset untouched', async () => {
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

    const result = await insertLogo(db, A, {
      r2Key: 'boom-busters/logos/renamed.png',
      contentHash: 'shared-hash',
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })

    expect(result).toMatchObject({ kind: 'logo', channelId: A, title: 'Stability AI' })
    expect(result?.id).not.toBe(image!.id)
    expect(await assetObjectInUse(db, 'boom-busters/stock/still.png')).toBe(true)
    expect(await assetObjectInUse(db, 'boom-busters/nowhere.png')).toBe(false)
    const [row] = await db.select().from(assets).where(eq(assets.id, image!.id))
    expect(row).toMatchObject({
      title: 'A stock still',
      width: 800,
      height: 600,
      sourceUrl: 'https://stock.example/still.png',
    })
  })
})
