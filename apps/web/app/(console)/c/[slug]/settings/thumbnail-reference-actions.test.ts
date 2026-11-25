// @vitest-environment node

import {
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getChannelSettings,
  listChannels,
  requireTestDatabase,
  seed,
  thumbnailPackages,
  updateChannelSettings,
} from '@boom-busters/db'
import type * as DbModule from '@boom-busters/db'
import { FIRST_CHANNEL_ID, newId, type Settings } from '@boom-busters/schemas'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  addWinnerToReferences,
  removeThumbnailReference,
  saveThumbnailReference,
  saveThumbnailStyle,
  uploadThumbnailReference,
} from './thumbnail-reference-actions'

/**
 * The thumbnail references' actions against the test database. Session, cache
 * revalidation and R2 are replaced; the settings merge is the real one, so a
 * rule that lives in the schema (three in use) is proved through it.
 */

const authMock = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
    user: { email: 'owner@example.com' },
  })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

// The real save, with its calls recorded so a test can read the patch it was given.
const dbSpy = vi.hoisted(() => ({ patches: [] as unknown[] }))
vi.mock('@boom-busters/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  return {
    ...actual,
    updateChannelSettings: (...args: Parameters<typeof actual.updateChannelSettings>) => {
      dbSpy.patches.push(args[2])
      return actual.updateChannelSettings(...args)
    },
  }
})

const storage = vi.hoisted(() => ({
  configured: true,
  put: [] as { key: string; type: string }[],
  deleted: [] as string[],
  read: [] as string[],
  bytes: new Uint8Array(Buffer.from('a winning thumbnail')),
}))
vi.mock('@/lib/storage', () => ({
  storageConfigured: () => storage.configured,
  thumbnailReferenceKey: (input: { channelId: string; contentHash: string; ext: string }) =>
    `boom-busters/thumb-refs/${input.channelId}/${input.contentHash}.${input.ext}`,
  getObjectBytes: async (key: string) => {
    storage.read.push(key)
    return { bytes: storage.bytes, contentType: 'image/jpeg' }
  },
  putObject: async (key: string, _body: Buffer, type: string) => {
    storage.put.push({ key, type })
    return { key }
  },
  deleteObject: async (key: string) => {
    storage.deleted.push(key)
  },
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const FOUR_IN_USE = 'At most three reference thumbnails can be in use.'

function pngFile(seedText: string, type = 'image/png', size = 0): File {
  const body = Buffer.from(`picture ${seedText}`)
  const bytes = size > 0 ? Buffer.concat([body, Buffer.alloc(size)]) : body
  return new File([new Uint8Array(bytes)], `${seedText}.png`, { type })
}

function form(slug: string, file: File): FormData {
  const data = new FormData()
  data.set('slug', slug)
  data.set('file', file)
  return data
}

describeDb('thumbnail reference actions', () => {
  let slug = ''
  let original: Settings

  const current = () => getChannelSettings(db, FIRST_CHANNEL_ID)

  const addRefs = async (count: number, key?: string) => {
    const base = (await current()).thumbnails.references
    const added = Array.from({ length: count }, (_, index) => ({
      id: newId<'thumbnail-reference'>(),
      r2Key: key ?? `boom-busters/thumb-refs/${FIRST_CHANNEL_ID}/seeded-${index}.png`,
      mimeType: 'image/png' as const,
      note: '',
      inUse: false,
    }))
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      thumbnails: { references: [...base, ...added] },
    })
    return added.map((ref) => ref.id)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    storage.configured = true
    storage.put = []
    storage.deleted = []
    storage.read = []
    await seed(db)
    original = await current()
    const first = (await listChannels(db)).find((channel) => channel.id === FIRST_CHANNEL_ID)
    slug = first!.slug
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      thumbnails: { styleNote: '', references: [] },
    })
  })

  afterEach(async () => {
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      thumbnails: original.thumbnails,
      brandKit: { look: original.brandKit.look },
    })
  })

  it('stores a reference and its note', async () => {
    const result = await uploadThumbnailReference(form(slug, pngFile('one')))
    expect(result).toEqual({ ok: true })

    const [ref] = (await current()).thumbnails.references
    expect(ref).toMatchObject({ mimeType: 'image/png', note: '', inUse: false })
    expect(ref!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(ref!.r2Key).toMatch(
      new RegExp(`^boom-busters/thumb-refs/${FIRST_CHANNEL_ID}/[0-9a-f]{64}\\.png$`),
    )
    expect(storage.put).toEqual([{ key: ref!.r2Key, type: 'image/png' }])

    expect(
      await saveThumbnailReference(slug, ref!.id, { note: '  Big face, flat colour  ' }),
    ).toEqual({
      ok: true,
    })
    const [saved] = (await current()).thumbnails.references
    expect(saved!.note).toBe('Big face, flat colour')
    expect(saved!.inUse).toBe(false)
  })

  it('refuses a seventh reference', async () => {
    for (let index = 0; index < 6; index++) {
      expect(await uploadThumbnailReference(form(slug, pngFile(`file-${index}`)))).toEqual({
        ok: true,
      })
    }
    const putBefore = storage.put.length
    expect(await uploadThumbnailReference(form(slug, pngFile('file-6')))).toEqual({
      ok: false,
      error: 'Six reference thumbnails at most. Remove one first.',
    })
    expect(storage.put).toHaveLength(putBefore)
    expect((await current()).thumbnails.references).toHaveLength(6)
  })

  it('refuses the same file twice, a big file and a file of the wrong type', async () => {
    expect(await uploadThumbnailReference(form(slug, pngFile('same')))).toEqual({ ok: true })
    expect(await uploadThumbnailReference(form(slug, pngFile('same')))).toEqual({
      ok: false,
      error: 'That exact file is already a reference.',
    })
    expect(
      await uploadThumbnailReference(form(slug, pngFile('big', 'image/png', 8 * 1024 * 1024))),
    ).toEqual({ ok: false, error: 'Reference thumbnails must be 8 MB or less.' })
    expect(await uploadThumbnailReference(form(slug, pngFile('gif', 'image/gif')))).toEqual({
      ok: false,
      error: 'Reference thumbnails are PNG, JPEG or WebP files.',
    })
    expect((await current()).thumbnails.references).toHaveLength(1)
  })

  it('refuses a fourth in use', async () => {
    const ids = await addRefs(4)
    for (const id of ids.slice(0, 3)) {
      expect(await saveThumbnailReference(slug, id, { inUse: true })).toEqual({ ok: true })
    }
    expect(await saveThumbnailReference(slug, ids[3]!, { inUse: true })).toEqual({
      ok: false,
      error: FOUR_IN_USE,
    })
    const refs = (await current()).thumbnails.references
    expect(refs.filter((ref) => ref.inUse).map((ref) => ref.id)).toEqual(ids.slice(0, 3))
  })

  it('removing a reference deletes its object', async () => {
    await uploadThumbnailReference(form(slug, pngFile('gone')))
    const [ref] = (await current()).thumbnails.references

    expect(await removeThumbnailReference(slug, ref!.id)).toEqual({ ok: true })
    expect((await current()).thumbnails.references).toEqual([])
    expect(storage.deleted).toEqual([ref!.r2Key])
  })

  it('keeps an object another reference still holds', async () => {
    const [first, second] = await addRefs(
      2,
      `boom-busters/thumb-refs/${FIRST_CHANNEL_ID}/shared.png`,
    )

    expect(await removeThumbnailReference(slug, first!)).toEqual({ ok: true })
    expect(storage.deleted).toEqual([])
    expect((await current()).thumbnails.references.map((ref) => ref.id)).toEqual([second])

    expect(await removeThumbnailReference(slug, second!)).toEqual({ ok: true })
    expect(storage.deleted).toEqual([`boom-busters/thumb-refs/${FIRST_CHANNEL_ID}/shared.png`])
  })

  it("saves the style note and the mark's corner", async () => {
    expect(
      await saveThumbnailStyle(slug, { styleNote: ' Flat colour, one face ', markPlacement: 'bl' }),
    ).toEqual({
      ok: true,
    })

    const saved = await current()
    expect(saved.thumbnails.styleNote).toBe('Flat colour, one face')
    expect(saved.thumbnails.markPlacement).toBe('bl')
  })

  it('saving the style sends no brandKit patch', async () => {
    await updateChannelSettings(db, FIRST_CHANNEL_ID, {
      brandKit: { look: { ...original.brandKit.look, watermarkPlacement: 'tr' } },
    })
    const before = await current()
    dbSpy.patches = []

    expect(await saveThumbnailStyle(slug, { styleNote: 'Calm', markPlacement: 'tr' })).toEqual({
      ok: true,
    })

    expect(dbSpy.patches).toEqual([{ thumbnails: { styleNote: 'Calm', markPlacement: 'tr' } }])
    expect('brandKit' in (dbSpy.patches[0] as object)).toBe(false)
    expect((await current()).brandKit).toEqual(before.brandKit)
  })

  it('refuses a corner the player draws over, and an unknown channel', async () => {
    const bad = await saveThumbnailStyle(slug, {
      styleNote: '',
      markPlacement: 'br' as unknown as 'tl',
    })
    expect(bad.ok).toBe(false)
    expect(
      await saveThumbnailStyle('no-such-channel', { styleNote: '', markPlacement: 'tl' }),
    ).toEqual({
      ok: false,
      error: 'Unknown channel',
    })
  })

  describe('adding a winner', () => {
    const made: string[] = []

    /** A package of the fixture's master record, in the state a test left it. */
    const winner = async (over: Partial<typeof thumbnailPackages.$inferInsert> = {}) => {
      const record = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
      const [row] = await db
        .insert(thumbnailPackages)
        .values({
          publishRecordId: record.id,
          position: made.length,
          source: 'generated',
          state: 'ready',
          idea: 'person',
          title: 'The $47 Billion Lie',
          composedKey: 'boom-busters/thumbs/x/won.jpg',
          approvedAt: new Date(),
          result: 'won',
          ...over,
        })
        .returning()
      made.push(row!.id)
      return row!
    }

    afterEach(async () => {
      for (const id of made.splice(0)) {
        await db.delete(thumbnailPackages).where(eq(thumbnailPackages.id, id))
      }
    })

    it('adds a winner as a reference that is not in use', async () => {
      const pack = await winner()

      expect(await addWinnerToReferences(pack.id)).toEqual({ ok: true })

      const [ref] = (await current()).thumbnails.references
      expect(ref).toMatchObject({
        mimeType: 'image/jpeg',
        note: 'Won its test: The $47 Billion Lie',
        inUse: false,
      })
      expect(ref!.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
      expect(ref!.r2Key).toMatch(
        new RegExp(`^boom-busters/thumb-refs/${FIRST_CHANNEL_ID}/[0-9a-f]{64}\\.jpg$`),
      )
      expect(storage.read).toEqual(['boom-busters/thumbs/x/won.jpg'])
      expect(storage.put).toEqual([{ key: ref!.r2Key, type: 'image/jpeg' }])
    })

    it('cuts a long title so the note fits', async () => {
      const pack = await winner({ title: 'x'.repeat(300) })
      expect(await addWinnerToReferences(pack.id)).toEqual({ ok: true })
      const [ref] = (await current()).thumbnails.references
      expect(ref!.note).toHaveLength(200)
      expect(ref!.note.startsWith('Won its test: xxx')).toBe(true)
    })

    it('refuses a package that did not win', async () => {
      const refusal = { ok: false, error: 'Only a thumbnail that won its test can be added.' }
      expect(await addWinnerToReferences((await winner({ result: 'lost' })).id)).toEqual(refusal)
      expect(await addWinnerToReferences((await winner({ result: null })).id)).toEqual(refusal)
      expect(await addWinnerToReferences((await winner({ composedKey: null })).id)).toEqual(refusal)
      expect(await addWinnerToReferences(newId<'thumbnail-reference'>())).toEqual(refusal)
      expect(storage.put).toEqual([])
      expect((await current()).thumbnails.references).toEqual([])
    })

    it('refuses a seventh reference and the same file twice', async () => {
      const pack = await winner()
      expect(await addWinnerToReferences(pack.id)).toEqual({ ok: true })
      expect(await addWinnerToReferences(pack.id)).toEqual({
        ok: false,
        error: 'That exact file is already a reference.',
      })

      await addRefs(5)
      const putBefore = storage.put.length
      expect(await addWinnerToReferences((await winner()).id)).toEqual({
        ok: false,
        error: 'Six reference thumbnails at most. Remove one first.',
      })
      expect(storage.put).toHaveLength(putBefore)
      expect((await current()).thumbnails.references).toHaveLength(6)
    })

    it('says so when nothing can store the picture', async () => {
      const pack = await winner()
      storage.configured = false
      expect(await addWinnerToReferences(pack.id)).toEqual({
        ok: false,
        error: 'Reference uploads need R2 configured; there is nowhere to store them.',
      })
      expect((await current()).thumbnails.references).toEqual([])
    })
  })

  it('needs a signed-in owner', async () => {
    authMock.auth.mockResolvedValueOnce(null)
    await expect(uploadThumbnailReference(form(slug, pngFile('anon')))).rejects.toThrow(
      'Not signed in',
    )
  })
})
