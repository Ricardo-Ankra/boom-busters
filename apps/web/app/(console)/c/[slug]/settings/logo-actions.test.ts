import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
// @vitest-environment node

import { createHash } from 'node:crypto'
import {
  assets,
  createChannel,
  getChannelBySlug,
  getChannelSettings,
  listLogos,
  requireTestDatabase,
  seed,
  updateChannelSettings,
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
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
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

  it('says Unknown channel for a well-formed id that names none, in all three channel-taking actions', async () => {
    const missing = '01BB0000000000000000000099'
    const expected = { ok: false, error: 'Unknown channel' }

    expect(
      await createLogoUploadAction(missing, {
        fileType: 'image/png',
        fileSize: 1000,
        contentHash: HASH,
      }),
    ).toEqual(expected)
    expect(
      await finaliseLogoAction(missing, {
        key: `boom-busters/logos/${HASH}.png`,
        contentHash: HASH,
        title: 'Acme',
        width: 10,
        height: 10,
      }),
    ).toEqual(expected)
    expect(
      await addLogoFromUrlAction(missing, { url: 'https://example.com/a.png', title: 'Acme' }),
    ).toEqual(expected)
    expect(storage.put).toEqual([])
  })

  it('presigns a PUT for a raster mark under the logos key, and refuses SVG and AVIF here', async () => {
    const created = await createLogoUploadAction(FIRST_CHANNEL_ID, {
      fileType: 'image/png',
      fileSize: 1000,
      contentHash: HASH,
    })
    expect(created).toMatchObject({ ok: true, key: `boom-busters/logos/${HASH}.png` })
    expect(created.url).toContain('?signed')

    // The browser converts these before asking; a request naming them is a
    // browser that skipped the conversion, and the server will not store them.
    for (const fileType of ['image/svg+xml', 'image/avif', 'image/gif']) {
      const refused = await createLogoUploadAction(FIRST_CHANNEL_ID, {
        fileType,
        fileSize: 1000,
        contentHash: HASH,
      })
      expect(refused.ok).toBe(false)
    }
    expect(
      (
        await createLogoUploadAction(FIRST_CHANNEL_ID, {
          fileType: 'image/png',
          fileSize: 5 * 1024 * 1024,
          contentHash: HASH,
        })
      ).error,
    ).toMatch(/4 MB/)
  })

  it('records the mark once the object landed, named, sized, and lists it', async () => {
    const result = await finaliseLogoAction(FIRST_CHANNEL_ID, {
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: ' Stability AI ',
      width: 1200,
      height: 400,
    })
    expect(result).toEqual({ ok: true })
    const [logo] = await listLogos(db, FIRST_CHANNEL_ID)
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
    const result = await finaliseLogoAction(FIRST_CHANNEL_ID, {
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    expect(result.error).toMatch(/4 MB/)
    expect(storage.deleted).toEqual([`boom-busters/logos/${HASH}.png`])
    expect(await listLogos(db, FIRST_CHANNEL_ID)).toEqual([])
  })

  it('refuses a finalise for a key this flow could not have issued, and an empty name', async () => {
    const wrongKey = await finaliseLogoAction(FIRST_CHANNEL_ID, {
      key: 'boom-busters/music/x.mp3',
      contentHash: HASH,
      title: 'X',
      width: 1,
      height: 1,
    })
    expect(wrongKey.ok).toBe(false)
    const unnamed = await finaliseLogoAction(FIRST_CHANNEL_ID, {
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
    const sneaky = await finaliseLogoAction(FIRST_CHANNEL_ID, {
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
    const result = await addLogoFromUrlAction(FIRST_CHANNEL_ID, {
      url: 'https://cdn.example/mark.png',
      title: 'Wirecard AG',
    })
    expect(result).toEqual({ ok: true })
    const hash = createHash('sha256').update(bytes).digest('hex')
    expect(storage.put).toEqual([`boom-busters/logos/${hash}.png`])
    const [logo] = await listLogos(db, FIRST_CHANNEL_ID)
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
    const result = await addLogoFromUrlAction(FIRST_CHANNEL_ID, {
      url: 'https://cdn.example/mark.png',
      title: 'Wirecard AG',
    })
    expect(result).toEqual({ ok: true })
    const [logo] = await listLogos(db, FIRST_CHANNEL_ID)
    expect(logo).toMatchObject({ width: 301, height: 1 })
  })

  it('passes the fetcher refusal through in its own words', async () => {
    remote.fetchRemoteLogo.mockResolvedValue({ ok: false, error: 'That SVG could not be drawn.' })
    const result = await addLogoFromUrlAction(FIRST_CHANNEL_ID, {
      url: 'https://cdn.example/bad.svg',
      title: 'X',
    })
    expect(result).toEqual({ ok: false, error: 'That SVG could not be drawn.' })
    expect(await listLogos(db, FIRST_CHANNEL_ID)).toEqual([])
  })

  it('renames, chooses the channel mark, refuses to remove it, then removes it once unchosen', async () => {
    await finaliseLogoAction(FIRST_CHANNEL_ID, {
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    const [logo] = await listLogos(db, FIRST_CHANNEL_ID)

    expect(await renameLogoAction(FIRST_CHANNEL_ID, { id: logo!.id, title: 'Stability' })).toEqual({
      ok: true,
    })
    expect((await listLogos(db, FIRST_CHANNEL_ID))[0]?.title).toBe('Stability')

    expect(await setChannelMarkAction(FIRST_CHANNEL_ID, logo!.id)).toEqual({ ok: true })
    expect((await getChannelSettings(db, FIRST_CHANNEL_ID)).brandKit.look.logoR2Key).toBe(
      logo!.r2Key,
    )

    const refused = await removeLogoAction(FIRST_CHANNEL_ID, logo!.id)
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/channel mark/i)

    expect(await setChannelMarkAction(FIRST_CHANNEL_ID, null)).toEqual({ ok: true })
    expect(await removeLogoAction(FIRST_CHANNEL_ID, logo!.id)).toEqual({ ok: true })
    expect(storage.deleted).toEqual([logo!.r2Key])
    expect(await listLogos(db, FIRST_CHANNEL_ID)).toEqual([])
  })

  it('stores a mark beside shared bytes with the same hash and leaves the shared asset alone', async () => {
    // A channel's marks have their own unique index, so bytes stored as a
    // shared `image` asset never collide with a mark: the mark is added, the
    // image keeps its name and key.
    await db.insert(assets).values({
      kind: 'image',
      r2Key: `boom-busters/stock/${HASH}.png`,
      contentHash: HASH,
      licence: 'stock',
      title: 'A stock still',
    })

    const finalised = await finaliseLogoAction(FIRST_CHANNEL_ID, {
      key: `boom-busters/logos/${HASH}.png`,
      contentHash: HASH,
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    expect(finalised).toEqual({ ok: true })
    expect((await listLogos(db, FIRST_CHANNEL_ID)).map((logo) => logo.title)).toEqual([
      'Stability AI',
    ])
    const image = (await db.select().from(assets)).find((row) => row.kind === 'image')
    expect(image).toMatchObject({
      title: 'A stock still',
      r2Key: `boom-busters/stock/${HASH}.png`,
      channelId: null,
    })
  })

  describe('two channels', () => {
    async function secondChannelId(): Promise<string> {
      const existing = await getChannelBySlug(db, 'second-test')
      if (existing) return existing.id
      return (
        await createChannel(db, {
          name: 'Second test channel',
          handle: null,
          slug: 'second-test',
          settings: DEFAULT_SETTINGS,
          bible: EMPTY_BIBLE,
        })
      ).id
    }

    const upload = (channelId: string, title: string) =>
      finaliseLogoAction(channelId, {
        key: `boom-busters/logos/${HASH}.png`,
        contentHash: HASH,
        title,
        width: 1200,
        height: 400,
      })

    it('keeps each channel library and channel mark to itself', async () => {
      const B = await secondChannelId()
      expect(await upload(FIRST_CHANNEL_ID, 'Stability AI')).toEqual({ ok: true })
      expect(await upload(B, 'Stability B')).toEqual({ ok: true })

      const [a] = await listLogos(db, FIRST_CHANNEL_ID)
      const [b] = await listLogos(db, B)
      expect(a?.title).toBe('Stability AI')
      expect(b?.title).toBe('Stability B')
      expect(a?.r2Key).toBe(b?.r2Key)

      expect(await setChannelMarkAction(B, b!.id)).toEqual({ ok: true })
      expect((await getChannelSettings(db, B)).brandKit.look.logoR2Key).toBe(b!.r2Key)
      expect((await getChannelSettings(db, FIRST_CHANNEL_ID)).brandKit.look.logoR2Key).toBeNull()
    })

    it('refuses another channel mark, on choose, rename and remove', async () => {
      const B = await secondChannelId()
      await upload(FIRST_CHANNEL_ID, 'Stability AI')
      const [a] = await listLogos(db, FIRST_CHANNEL_ID)
      const gone = { ok: false, error: 'That mark is already gone.' }

      expect(await setChannelMarkAction(B, a!.id)).toEqual(gone)
      expect(await renameLogoAction(B, { id: a!.id, title: 'Hijacked' })).toEqual(gone)
      expect(await removeLogoAction(B, a!.id)).toEqual(gone)
      expect((await listLogos(db, FIRST_CHANNEL_ID))[0]?.title).toBe('Stability AI')
    })

    it('keeps the shared bytes while another channel still holds the same mark', async () => {
      const B = await secondChannelId()
      await upload(FIRST_CHANNEL_ID, 'Stability AI')
      await upload(B, 'Stability B')
      const [a] = await listLogos(db, FIRST_CHANNEL_ID)
      const [b] = await listLogos(db, B)
      // The earlier test left B's mark chosen; a chosen mark cannot be removed.
      expect(await setChannelMarkAction(B, null)).toEqual({ ok: true })

      expect(await removeLogoAction(FIRST_CHANNEL_ID, a!.id)).toEqual({ ok: true })
      expect(storage.deleted).toEqual([])
      expect(await removeLogoAction(B, b!.id)).toEqual({ ok: true })
      expect(storage.deleted).toEqual([b!.r2Key])
    })
  })

  it('rejects when no session is signed in', async () => {
    authMock.auth.mockResolvedValueOnce(null)
    await expect(
      renameLogoAction(FIRST_CHANNEL_ID, { id: 'anything', title: 'X' }),
    ).rejects.toThrow('Not signed in')
  })

  it('refuses an id that is not a ulid, on rename, remove and choosing the channel mark', async () => {
    const notAUlid = { ok: false, error: 'Unknown mark.' }
    expect(await renameLogoAction(FIRST_CHANNEL_ID, { id: 'not-a-ulid', title: 'X' })).toEqual(
      notAUlid,
    )
    expect(await removeLogoAction(FIRST_CHANNEL_ID, 'not-a-ulid')).toEqual(notAUlid)
    expect(await setChannelMarkAction(FIRST_CHANNEL_ID, 'not-a-ulid')).toEqual(notAUlid)
  })

  it('says where the bytes would go when storage is not configured', async () => {
    storage.configured = false
    const created = await createLogoUploadAction(FIRST_CHANNEL_ID, {
      fileType: 'image/png',
      fileSize: 10,
      contentHash: HASH,
    })
    expect(created.error).toMatch(/R2/)
  })
})
