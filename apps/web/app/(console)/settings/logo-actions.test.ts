// @vitest-environment node

import { createHash } from 'node:crypto'
import {
  getSettings,
  listLogos,
  removeLogo,
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
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const storage = vi.hoisted(() => ({
  configured: true,
  deleted: [] as string[],
  put: [] as string[],
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
  headObject: async () => ({ size: 120_000, contentType: 'image/png' }),
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
    await seed(db)
    for (const logo of await listLogos(db)) await removeLogo(db, logo.id)
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
