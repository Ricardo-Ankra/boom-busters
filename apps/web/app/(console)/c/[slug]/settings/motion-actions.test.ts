// @vitest-environment node

import {
  assets,
  getChannelSettings,
  insertLogo,
  insertMotionReference,
  listMotionReferences,
  motionReferences,
  requireTestDatabase,
  seed,
  setReferenceReading,
  updateChannelSettings,
  setReferenceReadState,
  upsertChannelAsset,
} from '@boom-busters/db'
import { denseFrameTimes, FIRST_CHANNEL_ID, overviewFrameTimes } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { referenceFrameKey, referenceKey } from '@/lib/reference-keys'
import {
  addReferenceWindowAction,
  archiveReferenceAction,
  createReferenceFrameUploadsAction,
  createReferenceUploadAction,
  draftMotionIdentityAction,
  finaliseReferenceAction,
  readReferenceAction,
  remarkReferenceAction,
  saveReadingAction,
  updateReferenceAction,
} from './motion-actions'

/**
 * The Motion tab's reference actions (spec 2026-11-04, sections 7.2 and
 * 8.4) against the test database, with the seams a server action cannot
 * bring to a unit test replaced: the session, cache revalidation, R2 (every
 * upload landed) and the Inngest client.
 */

const authMock = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ user: { email: string } } | null> => ({
    user: { email: 'owner@example.com' },
  })),
}))
vi.mock('@/auth', () => authMock)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))

const storage = vi.hoisted(() => ({
  configured: true,
  deleted: [] as string[],
  headSize: 120_000,
}))
vi.mock('@/lib/storage', () => ({
  R2_PREFIX: 'boom-busters',
  storageConfigured: () => storage.configured,
  presignPut: async (key: string) => `https://r2.example/${key}?signed`,
  headObject: async () => ({ size: storage.headSize, contentType: 'image/jpeg' }),
  deleteObject: async (key: string) => {
    storage.deleted.push(key)
  },
}))

const sent = vi.hoisted(() => ({ send: vi.fn(async (_event: unknown) => ({ ids: ['evt'] })) }))
vi.mock('@/inngest/client', () => ({ inngest: { send: sent.send } }))

const describeDb = requireTestDatabase() ? describe : describe.skip
const HASH = 'a'.repeat(64)
const channelId = FIRST_CHANNEL_ID

const still = {
  kind: 'image',
  title: 'A board of type',
  purpose: 'look',
  carryOver: 'borrow the weight, not the words',
} as const

function clipFrames(window: { startMs: number; endMs: number }, durationMs: number) {
  return [
    ...denseFrameTimes(window.startMs, window.endMs).map((atMs) => ({
      set: 'dense' as const,
      atMs,
      width: 640,
      height: 360,
    })),
    ...overviewFrameTimes(durationMs).map((atMs) => ({
      set: 'overview' as const,
      atMs,
      width: 320,
      height: 180,
    })),
  ]
}

describeDb('motion reference actions', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    storage.configured = true
    storage.deleted = []
    process.env['MOCK_PROVIDERS'] = '1'
    await seed(db)
    await db.delete(motionReferences)
    await db.delete(assets)
  })

  it('refuses a clip over 90 seconds and a still over 8 MB', async () => {
    const clip = await createReferenceUploadAction(channelId, {
      fileType: 'video/mp4',
      fileSize: 1000,
      contentHash: HASH,
      durationMs: 91_000,
    })
    expect(clip.ok).toBe(false)
    expect(clip.error).toMatch(/over 90 seconds/)
    const big = await createReferenceUploadAction(channelId, {
      fileType: 'image/png',
      fileSize: 9 * 1024 * 1024,
      contentHash: HASH,
    })
    expect(big.ok).toBe(false)
    expect(big.error).toMatch(/8 MB/)
    const other = await createReferenceUploadAction(channelId, {
      fileType: 'image/gif',
      fileSize: 1000,
      contentHash: HASH,
    })
    expect(other.error).toMatch(/PNG, JPEG or WebP still/)
  })

  it('issues a presigned PUT for the original under the reference key', async () => {
    const r = await createReferenceUploadAction(channelId, {
      fileType: 'video/quicktime',
      fileSize: 1000,
      contentHash: HASH,
      durationMs: 10_000,
    })
    expect(r.ok).toBe(true)
    expect(r.key).toBe(referenceKey({ channelId, contentHash: HASH, ext: 'mov' }))
    expect(r.url).toContain('?signed')
  })

  it('issues one frame URL per time under the reference key', async () => {
    const r = await createReferenceFrameUploadsAction(channelId, {
      contentHash: HASH,
      dense: [1000, 1083],
      overview: [0, 500],
    })
    expect(r.ok).toBe(true)
    expect(r.uploads!.map((u) => u.key)).toEqual([
      referenceFrameKey({ channelId, contentHash: HASH, set: 'dense', atMs: 1000 }),
      referenceFrameKey({ channelId, contentHash: HASH, set: 'dense', atMs: 1083 }),
      referenceFrameKey({ channelId, contentHash: HASH, set: 'overview', atMs: 0 }),
      referenceFrameKey({ channelId, contentHash: HASH, set: 'overview', atMs: 500 }),
    ])
  })

  it('refuses a finalise whose frames do not match the window', async () => {
    const r = await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'video/mp4',
      width: 1920,
      height: 1080,
      durationMs: 10_000,
      frames: clipFrames({ startMs: 0, endMs: 1000 }, 10_000),
      input: { ...still, kind: 'video', windowStartMs: 1000, windowEndMs: 2000 },
      read: false,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/do not match the window/)
    expect(await listMotionReferences(db, channelId)).toEqual([])
  })

  it("stores a clip with its frames and reads it on the owner's word", async () => {
    const window = { startMs: 1000, endMs: 3000 }
    const r = await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'video/mp4',
      width: 1920,
      height: 1080,
      durationMs: 10_000,
      frames: clipFrames(window, 10_000),
      input: { ...still, kind: 'video', windowStartMs: 1000, windowEndMs: 3000 },
      read: true,
    })
    expect(r.ok).toBe(true)
    const [row] = await listMotionReferences(db, channelId)
    expect(row?.frames.dense).toHaveLength(24)
    expect(row?.frames.overview).toHaveLength(20)
    expect(row?.frames.dense[0]?.r2Key).toBe(
      referenceFrameKey({ channelId, contentHash: HASH, set: 'dense', atMs: 1000 }),
    )
    expect(row?.readState).toBe('reading')
    expect(sent.send).toHaveBeenCalledTimes(1)
    expect(sent.send.mock.calls[0]![0]).toMatchObject({
      name: 'motion/reference.ingested',
      data: { channelId, referenceId: row?.id },
    })
  })

  it('stores a still as its own one frame and leaves it unread on Save without reading', async () => {
    const r = await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 1200,
      height: 800,
      frames: [],
      input: still,
      read: false,
    })
    expect(r.ok).toBe(true)
    const [row] = await listMotionReferences(db, channelId)
    expect(row?.kind).toBe('image')
    expect(row?.frames).toEqual({
      dense: [
        {
          atMs: 0,
          r2Key: referenceKey({ channelId, contentHash: HASH, ext: 'png' }),
          width: 1200,
          height: 800,
        },
      ],
      overview: [],
    })
    expect(row?.readState).toBe('unread')
    expect(sent.send).not.toHaveBeenCalled()
    // The same bytes again: one asset row, the title refreshed, a second reference.
    const again = await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 1200,
      height: 800,
      frames: [],
      input: { ...still, title: 'Again' },
      read: false,
    })
    expect(again.ok).toBe(true)
    expect(await db.select().from(assets)).toHaveLength(1)
    expect(await listMotionReferences(db, channelId)).toHaveLength(2)
  })

  /** `count` references over other bytes, so the pack is full (or nearly). */
  async function fillPack(count = 12) {
    const asset = (await upsertChannelAsset(db, channelId, {
      kind: 'image',
      r2Key: 'boom-busters/references/x/y.png',
      contentHash: 'y',
      width: 10,
      height: 10,
      title: 'y',
    }))!
    for (let n = 0; n < count; n += 1) {
      await insertMotionReference(db, channelId, {
        assetId: asset.id,
        kind: 'image',
        title: `R${n}`,
        sourceUrl: null,
        rights: 'Reference only',
        purpose: 'look',
        negative: false,
        windowStartMs: null,
        windowEndMs: null,
        carryOver: 'x',
        avoid: '',
        frames: { dense: [], overview: [] },
      })
    }
  }

  it('deletes the upload when the pack is full', async () => {
    await fillPack()
    const r = await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 10,
      height: 10,
      frames: [],
      input: still,
      read: false,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/twelve references/)
    expect(storage.deleted).toEqual([referenceKey({ channelId, contentHash: HASH, ext: 'png' })])
  })

  it('reads an unread reference on Read, edits its words, keeps readAt when the owner edits the reading, and archives', async () => {
    await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 10,
      height: 10,
      frames: [],
      input: still,
      read: false,
    })
    const [row] = await listMotionReferences(db, channelId)
    const id = row!.id

    expect((await readReferenceAction(channelId, id)).ok).toBe(true)
    expect(sent.send).toHaveBeenCalledTimes(1)
    const busy = await readReferenceAction(channelId, id)
    expect(busy.ok).toBe(false)
    expect(busy.error).toMatch(/being read/)

    const edited = await updateReferenceAction(channelId, {
      id,
      input: { ...still, title: 'Renamed', sourceUrl: 'https://example.com/x', negative: true },
    })
    expect(edited.ok).toBe(true)
    const [renamed] = await listMotionReferences(db, channelId)
    expect(renamed?.title).toBe('Renamed')
    expect(renamed?.sourceUrl).toBe('https://example.com/x')
    expect(renamed?.negative).toBe(true)

    await setReferenceReading(db, id, {
      medium: 'm',
      palette: [],
      type: 't',
      enters: 'e',
      exits: 'x',
      motion: 'mo',
      absent: 'a',
      notes: '',
      readAt: '2026-11-04T10:00:00.000Z',
      model: 'test/model',
    })
    const saved = await saveReadingAction(channelId, {
      id,
      reading: {
        medium: 'edited',
        palette: ['#000'],
        type: 't',
        enters: 'e',
        exits: 'x',
        motion: 'mo',
        absent: 'a',
        notes: 'n',
      },
    })
    expect(saved.ok).toBe(true)
    const [read] = await listMotionReferences(db, channelId)
    expect(read?.reading?.medium).toBe('edited')
    expect(read?.reading?.readAt).toBe('2026-11-04T10:00:00.000Z')
    expect(read?.reading?.model).toBe('test/model')
    expect(read?.reading?.editedAt).toBeTruthy()

    expect((await archiveReferenceAction(channelId, id)).ok).toBe(true)
    expect(await listMotionReferences(db, channelId)).toEqual([])
  })

  it('the draft keeps a channel-only technique in use (spec 8.5)', async () => {
    const motion = (await getChannelSettings(db, channelId)).motion
    await updateChannelSettings(db, channelId, {
      motion: { ...motion, techniques: [...motion.techniques, 'ledger-wipe'] },
    })
    const r = await draftMotionIdentityAction(channelId, { brief: 'slow' })
    expect(r.ok).toBe(true)
    expect(r.draft!.identity.techniques).toContain('ledger-wipe')
  })

  it('the real draft keeps the channel-only key in use and drops an invented one (deferred minors)', async () => {
    const motion = (await getChannelSettings(db, channelId)).motion
    await updateChannelSettings(db, channelId, {
      motion: { ...motion, techniques: [...motion.techniques, 'ledger-wipe'] },
    })
    process.env['MOCK_PROVIDERS'] = ''
    callLlm.mockResolvedValueOnce({
      text: JSON.stringify({
        identity: { techniques: [...motion.techniques, 'ink-blot'] },
        why: 'the catalogue, and one it made up',
      }),
    })
    const r = await draftMotionIdentityAction(channelId, { brief: 'slow' })
    expect(r.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(r.draft!.identity.techniques).toContain('ledger-wipe')
    expect(r.draft!.identity.techniques).not.toContain('ink-blot')
  })

  it('drafts the identity from the brief in mock mode and leaves the settings untouched', async () => {
    const r = await draftMotionIdentityAction(channelId, { brief: 'slow and dark' })
    expect(r.ok).toBe(true)
    expect(r.draft!.identity.styleGuideMd).toContain('slow and dark')
    expect(r.draft!.why).toMatch(/^\[mock\]/)
    expect((await getChannelSettings(db, channelId)).motion.styleGuideMd).toBe('')
    const long = await draftMotionIdentityAction(channelId, { brief: 'x'.repeat(1001) })
    expect(long.ok).toBe(false)
    expect(long.error).toMatch(/1000 characters/)
  })

  it('refuses an upload when the pack is already full (final review, issue 7)', async () => {
    await fillPack()
    const r = await createReferenceUploadAction(channelId, {
      fileType: 'image/png',
      fileSize: 1000,
      contentHash: HASH,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/twelve references/)
  })

  it('keeps the original when another reference holds the same bytes and the pack is full (final review, issue 2)', async () => {
    // The first reference stores these bytes; eleven more fill the pack.
    await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 10,
      height: 10,
      frames: [],
      input: still,
      read: false,
    })
    await fillPack(11)
    const r = await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 10,
      height: 10,
      frames: [],
      input: { ...still, title: 'Again' },
      read: false,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/twelve references/)
    expect(storage.deleted).toEqual([])
  })

  it("refuses bytes that are already one of the channel's marks (final review, issue 3)", async () => {
    await insertLogo(db, channelId, {
      r2Key: 'boom-busters/logos/mark.png',
      contentHash: HASH,
      title: 'Acme',
      width: 100,
      height: 40,
    })
    const r = await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 100,
      height: 40,
      frames: [],
      input: still,
      read: false,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/already stored as a mark/)
    expect(await listMotionReferences(db, channelId)).toEqual([])
  })

  it('refuses a re-mark and a reading edit while the reference is being read, and reads again once the read has stalled (final review, issues 4 and 5)', async () => {
    const window = { startMs: 1000, endMs: 3000 }
    await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'video/mp4',
      width: 1920,
      height: 1080,
      durationMs: 10_000,
      frames: clipFrames(window, 10_000),
      input: { ...still, kind: 'video', windowStartMs: 1000, windowEndMs: 3000 },
      read: true,
    })
    const [row] = await listMotionReferences(db, channelId)
    const id = row!.id
    expect(row?.readState).toBe('reading')
    const remark = await remarkReferenceAction(channelId, {
      id,
      windowStartMs: 2000,
      windowEndMs: 4000,
      frames: clipFrames({ startMs: 2000, endMs: 4000 }, 10_000),
      read: false,
    })
    expect(remark.ok).toBe(false)
    expect(remark.error).toMatch(/being read/)
    const edit = await saveReadingAction(channelId, { id, reading: {} })
    expect(edit.ok).toBe(false)
    expect(edit.error).toMatch(/being read/)
    expect((await readReferenceAction(channelId, id)).error).toMatch(/being read/)

    // Ten minutes on with no answer: the read has stalled and may be asked for again.
    await setReferenceReadState(db, id, 'reading', null, new Date(Date.now() - 11 * 60_000))
    sent.send.mockClear()
    expect((await readReferenceAction(channelId, id)).ok).toBe(true)
    expect(sent.send).toHaveBeenCalledTimes(1)
  })

  describe('a new window on a stored clip (decision 448)', () => {
    /** A clip stored with its first window, 1 to 3 s of 10 s. */
    const aClip = async () => {
      await finaliseReferenceAction(channelId, {
        contentHash: HASH,
        fileType: 'video/mp4',
        width: 1920,
        height: 1080,
        durationMs: 10_000,
        frames: clipFrames({ startMs: 1000, endMs: 3000 }, 10_000),
        input: { ...still, kind: 'video', windowStartMs: 1000, windowEndMs: 3000 },
        read: false,
      })
      return (await listMotionReferences(db, channelId))[0]!
    }
    const second = {
      ...still,
      kind: 'video' as const,
      title: 'The hold after the count',
      purpose: 'pacing' as const,
      windowStartMs: 4000,
      windowEndMs: 6000,
    }

    it('stores the window as its own reference on the same stored clip, and reads it on the word', async () => {
      const source = await aClip()
      const r = await addReferenceWindowAction(channelId, {
        fromId: source.id,
        frames: clipFrames({ startMs: 4000, endMs: 6000 }, 10_000),
        input: second,
        read: true,
      })
      expect(r.ok).toBe(true)
      const rows = await listMotionReferences(db, channelId)
      expect(rows).toHaveLength(2)
      const added = rows.find((row) => row.id === r.id)!
      expect(added.assetId).toBe(source.assetId)
      expect(added).toMatchObject({
        title: 'The hold after the count',
        purpose: 'pacing',
        windowStartMs: 4000,
        windowEndMs: 6000,
        readState: 'reading',
      })
      expect(added.frames.dense[0]?.r2Key).toBe(
        referenceFrameKey({ channelId, contentHash: HASH, set: 'dense', atMs: 4000 }),
      )
      // The source keeps its own window.
      expect(rows.find((row) => row.id === source.id)).toMatchObject({
        windowStartMs: 1000,
        windowEndMs: 3000,
      })
      expect(sent.send).toHaveBeenCalledTimes(1)
      expect(sent.send.mock.calls[0]![0]).toMatchObject({
        name: 'motion/reference.ingested',
        data: { channelId, referenceId: r.id },
      })
      expect(storage.deleted).toEqual([])
    })

    it('refuses a title another reference holds, frames that do not match, a still, and an unknown source', async () => {
      const source = await aClip()
      const frames = clipFrames({ startMs: 4000, endMs: 6000 }, 10_000)
      const taken = await addReferenceWindowAction(channelId, {
        fromId: source.id,
        frames,
        input: { ...second, title: still.title },
        read: false,
      })
      expect(taken).toEqual({
        ok: false,
        error: 'Another reference is already called that. Give this window its own title.',
      })
      const mismatch = await addReferenceWindowAction(channelId, {
        fromId: source.id,
        frames: clipFrames({ startMs: 1000, endMs: 3000 }, 10_000),
        input: second,
        read: false,
      })
      expect(mismatch.error).toMatch(/do not match the window/)
      await finaliseReferenceAction(channelId, {
        contentHash: 'b'.repeat(64),
        fileType: 'image/png',
        width: 10,
        height: 10,
        frames: [],
        input: { ...still, title: 'A still' },
        read: false,
      })
      const stillRow = (await listMotionReferences(db, channelId)).find(
        (row) => row.title === 'A still',
      )!
      expect(
        (
          await addReferenceWindowAction(channelId, {
            fromId: stillRow.id,
            frames,
            input: second,
            read: false,
          })
        ).error,
      ).toBe('A still has no window to mark.')
      expect(
        (
          await addReferenceWindowAction(channelId, {
            fromId: '01J0000000000000000000NONE',
            frames,
            input: second,
            read: false,
          })
        ).ok,
      ).toBe(false)
      expect(await listMotionReferences(db, channelId)).toHaveLength(2)
      expect(sent.send).not.toHaveBeenCalled()
    })

    it('refuses a window when the pack is full', async () => {
      const source = await aClip()
      await fillPack(11)
      const r = await addReferenceWindowAction(channelId, {
        fromId: source.id,
        frames: clipFrames({ startMs: 4000, endMs: 6000 }, 10_000),
        input: second,
        read: false,
      })
      expect(r.ok).toBe(false)
      expect(r.error).toMatch(/twelve references/)
    })
  })

  it('puts the state back when the read cannot be queued (final review, issue 4)', async () => {
    await finaliseReferenceAction(channelId, {
      contentHash: HASH,
      fileType: 'image/png',
      width: 10,
      height: 10,
      frames: [],
      input: still,
      read: false,
    })
    const [row] = await listMotionReferences(db, channelId)
    sent.send.mockRejectedValueOnce(new Error('Inngest is down'))
    const r = await readReferenceAction(channelId, row!.id)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/could not be queued/)
    expect((await listMotionReferences(db, channelId))[0]?.readState).toBe('unread')
  })

  it('says why uploads need storage', async () => {
    storage.configured = false
    const r = await createReferenceUploadAction(channelId, {
      fileType: 'image/png',
      fileSize: 1000,
      contentHash: HASH,
    })
    expect(r.error).toMatch(/R2 configured/)
  })
})
