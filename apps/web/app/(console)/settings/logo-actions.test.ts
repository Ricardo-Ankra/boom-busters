// @vitest-environment node

import { createHash } from 'node:crypto'
import {
  assets,
  getSettings,
  listLogos,
  requireTestDatabase,
  seed,
  updateSettings,
} from '@boom-busters/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  addLogoFromUrlAction,
  createLogoUploadAction,
  finaliseLogoAction,
  removeLogoAction,
  renameLogoAction,
  setChannelMarkAction,
} from './logo-actions'

/**
 * The Logos tab's actions (decision 268) against the test database, with the
 * seams a server action cannot bring to a unit test replaced: session, cache
 * revalidation, R2 (which answers as if every upload landed) and the fetcher.
 */

const authMock = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
    user: { email: 'owner@example.com' },
  })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const storage = vi.hoisted(() => ({
  configured: true,
  deleted: [] as string[],
  put: [] as string[],
  headSize: 120_000,
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  logoKey: (input: { contentHash: string; ext: string }) =>
    `boom-busters/logos/${input.contentHash}.${input.ext}`,
  presignPut: async (key: string) => `https://r2.example/${key}?signed`,
  putObject: async (key: string) => {
    storage.put.push(key)
    return { key }
  },
  headObject: async () => ({ size: storage.headSize, contentType: 'image/png' }),
  deleteObject: async (key: string) => {
    storage.deleted.push(key)
  },
}))

const remote = vi.hoisted(() => ({ fetchRemoteLogo: vi.fn() }))
vi.mock('@/lib/remote-image', () => remote)

const describeDb = requireTestDatabase() ? describe : describe.skip
const HASH = 'a'.repeat(64)

describeDb('logo actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    storage.configured = true
    storage.deleted = []
    storage.put = []
    storage.headSize = 120_000
    await seed(db)
    // `seed` does not touch `assets`; this whole suite owns every row in it
    // (logos it inserts through the actions under test, and the odd
    // non-logo row a "wrong asset kind" test plants), so clear the table
    // wholesale rather than leaving other kinds to leak between runs.
    await db.delete(assets)
    await updateSettings(db, {
      brandKit: {
        look: {
          logoR2Key: null,
          watermarkPlacement: 'br',
          grainPreset: 'subtle',
          lowerThirdVariant: 'bar',
          chapterCardVariant: 'full',
        },
      },
    })
  })

  it('presigns a PUT for a raster mark under the logos key, and refuses SVG and AVIF here', async () => {
    const created = await createLogoUploadAction({
      fileType: 'image/png',
      fileSize: 1000,
      contentHash: HASH,
    })
    expect(created).toMatchObject({ ok: true, key: `boom-busters/logos/${HASH}.png` })
    expect(created.url).toContain('?signed')

    // The browser converts these before asking; a request naming them is a
    // browser that skipped the conversion, and the server will not store them.
    for (const fileType of ['image/svg+xml', 'image/avif', 'image/gif']) {
      const refused = await createLogoUploadAction({ fileType, fileSize: 1000, contentHash: HASH })
      expect(refused.ok).toBe(false)
    }
    expect(
      (
        await createLogoUploadAction({
          fileType: 'image/png',
          fileSize: 5 * 1024 * 1024,
          contentHash: HASH,
        })
      ).error,
    ).toMatch(/4 MB/)
  })

  it('records the mark once the object landed, named, sized, and lists it', async () => {
    const result = await finaliseLogoAction({
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: ' Stability AI ',
      width: 1200,
      height: 400,
    })
    expect(result).toEqual({ ok: true })
    const [logo] = await listLogos(db)
    expect(logo).toMatchObject({
      kind: 'logo',
      title: 'Stability AI',
      width: 1200,
      height: 400,
      r2Key: `boom-busters/logos/${HASH}.png`,
    })
  })

  it('refuses an oversize object once it is in storage, and deletes it', async () => {
    storage.headSize = 5 * 1024 * 1024
    const result = await finaliseLogoAction({
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    expect(result.error).toMatch(/4 MB/)
    expect(storage.deleted).toEqual([`boom-busters/logos/${HASH}.png`])
    expect(await listLogos(db)).toEqual([])
  })

  it('refuses a finalise for a key this flow could not have issued, and an empty name', async () => {
    const wrongKey = await finaliseLogoAction({
      key: 'boom-busters/music/x.mp3',
      contentHash: HASH,
      title: 'X',
      width: 1,
      height: 1,
    })
    expect(wrongKey.ok).toBe(false)
    const unnamed = await finaliseLogoAction({
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: '  ',
      width: 1,
      height: 1,
    })
    expect(unnamed.error).toMatch(/name/i)
  })

  it('refuses a key that merely starts with the fingerprint prefix', async () => {
    // The check is equality against the three legal keys, not a prefix
    // test: a key with the right hash but an extra path segment must not
    // slip through as if it were the object this flow itself presigned.
    const sneaky = await finaliseLogoAction({
      key: `boom-busters/logos/${HASH}.x/anything.png`,
      contentHash: HASH,
      title: 'X',
      width: 1,
      height: 1,
    })
    expect(sneaky.ok).toBe(false)
    expect(sneaky.error).toMatch(/fingerprint/i)
  })

  it('adds a mark by address: fetches once, stores the bytes, keeps the address as provenance', async () => {
    const bytes = Buffer.from('png-bytes')
    remote.fetchRemoteLogo.mockResolvedValue({
      ok: true,
      logo: {
        bytes,
        mimeType: 'image/png',
        width: 300,
        height: 100,
        resolvedUrl: 'https://cdn.example/mark.png',
      },
    })
    const result = await addLogoFromUrlAction({
      url: 'https://cdn.example/mark.png',
      title: 'Wirecard AG',
    })
    expect(result).toEqual({ ok: true })
    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(storage.put).toEqual([`boom-busters/logos/${hash}.png`])
    const [logo] = await listLogos(db)
    expect(logo).toMatchObject({
      title: 'Wirecard AG',
      sourceUrl: 'https://cdn.example/mark.png',
      width: 300,
    })
  })

  it('clamps a fetched mark to a whole pixel, the same as a finalised upload', async () => {
    const bytes = Buffer.from('fractional-dims')
    remote.fetchRemoteLogo.mockResolvedValue({
      ok: true,
      logo: {
        bytes,
        mimeType: 'image/png',
        width: 300.6,
        height: 0.4,
        resolvedUrl: 'https://cdn.example/mark.png',
      },
    })
    const result = await addLogoFromUrlAction({
      url: 'https://cdn.example/mark.png',
      title: 'Wirecard AG',
    })
    expect(result).toEqual({ ok: true })
    const [logo] = await listLogos(db)
    expect(logo).toMatchObject({ width: 301, height: 1 })
  })

  it('passes the fetcher refusal through in its own words', async () => {
    remote.fetchRemoteLogo.mockResolvedValue({ ok: false, error: 'That SVG could not be drawn.' })
    const result = await addLogoFromUrlAction({ url: 'https://cdn.example/bad.svg', title: 'X' })
    expect(result).toEqual({ ok: false, error: 'That SVG could not be drawn.' })
    expect(await listLogos(db)).toEqual([])
  })

  it('renames, chooses the channel mark, refuses to remove it, then removes it once unchosen', async () => {
    await finaliseLogoAction({
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    const [logo] = await listLogos(db)

    expect(await renameLogoAction({ id: logo!.id, title: 'Stability' })).toEqual({ ok: true })
    expect((await listLogos(db))[0]?.title).toBe('Stability')

    expect(await setChannelMarkAction(logo!.id)).toEqual({ ok: true })
    expect((await getSettings(db)).brandKit.look.logoR2Key).toBe(logo!.r2Key)

    const refused = await removeLogoAction(logo!.id)
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/channel mark/i)

    expect(await setChannelMarkAction(null)).toEqual({ ok: true })
    expect(await removeLogoAction(logo!.id)).toEqual({ ok: true })
    expect(storage.deleted).toEqual([logo!.r2Key])
    expect(await listLogos(db)).toEqual([])
  })

  it('refuses to rename bytes already stored as another asset kind, on finalise and on add-from-address', async () => {
    // insertLogo upserts on contentHash alone, which ignores kind: bytes
    // already stored as an `image` asset would otherwise be silently
    // renamed into the logo library and never listed there.
    await db.insert(assets).values({
      kind: 'image',
      r2Key: `boom-busters/stock/${HASH}.png`,
      contentHash: HASH,
      licence: 'stock',
      title: 'A stock still',
    })

    const finalised = await finaliseLogoAction({
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    expect(finalised.ok).toBe(false)
    expect(finalised.error).toMatch(/already stored as something other than a mark/i)
    expect(await listLogos(db)).toEqual([])
    const stillRow = (await db.select().from(assets)).find((row) => row.contentHash === HASH)
    expect(stillRow).toMatchObject({
      kind: 'image',
      title: 'A stock still',
      r2Key: `boom-busters/stock/${HASH}.png`,
    })

    const urlBytes = Buffer.from('bytes already stored under another asset kind')
    const urlHash = createHash('sha256').update(urlBytes).digest('hex')
    remote.fetchRemoteLogo.mockResolvedValue({
      ok: true,
      logo: {
        bytes: urlBytes,
        mimeType: 'image/png',
        width: 300,
        height: 100,
        resolvedUrl: 'https://cdn.example/mark.png',
      },
    })
    await db.insert(assets).values({
      kind: 'image',
      r2Key: `boom-busters/stock/${urlHash}.png`,
      contentHash: urlHash,
      licence: 'stock',
      title: 'A stock still',
    })
    const viaUrl = await addLogoFromUrlAction({
      url: 'https://cdn.example/mark.png',
      title: 'Wirecard AG',
    })
    expect(viaUrl.ok).toBe(false)
    expect(viaUrl.error).toMatch(/already stored as something other than a mark/i)
    expect(await listLogos(db)).toEqual([])
    const urlStillRow = (await db.select().from(assets)).find((row) => row.contentHash === urlHash)
    expect(urlStillRow).toMatchObject({
      kind: 'image',
      title: 'A stock still',
      r2Key: `boom-busters/stock/${urlHash}.png`,
    })
  })

  it('rejects when no session is signed in', async () => {
    authMock.auth.mockResolvedValueOnce(null)
    await expect(renameLogoAction({ id: 'anything', title: 'X' })).rejects.toThrow('Not signed in')
  })

  it('refuses an id that is not a ulid, on rename, remove and choosing the channel mark', async () => {
    const notAUlid = { ok: false, error: 'Unknown mark.' }
    expect(await renameLogoAction({ id: 'not-a-ulid', title: 'X' })).toEqual(notAUlid)
    expect(await removeLogoAction('not-a-ulid')).toEqual(notAUlid)
    expect(await setChannelMarkAction('not-a-ulid')).toEqual(notAUlid)
  })

  it('says where the bytes would go when storage is not configured', async () => {
    storage.configured = false
    const created = await createLogoUploadAction({
      fileType: 'image/png',
      fileSize: 10,
      contentHash: HASH,
    })
    expect(created.error).toMatch(/R2/)
  })
})
