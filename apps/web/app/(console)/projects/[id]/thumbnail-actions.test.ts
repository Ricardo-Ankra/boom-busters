// @vitest-environment node

import {
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  getThumbnailPackage,
  listThumbnailPackages,
  publishRecords,
  requireTestDatabase,
  seed,
  thumbnailPackages,
  updatePublishRecord,
} from '@boom-busters/db'
import { eq } from 'drizzle-orm'
import type * as StorageLib from '@/lib/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { uploadThumbnail, removeThumbnail } from './publish-actions'
import {
  approveThumbnailSet,
  generateThumbnailSet,
  makeDefaultThumbnail,
  markTestStarted,
  recordTestResult,
  regenerateThumbnailPicture,
  removeThumbnailPackageAction,
  saveThumbnailPackage,
} from './thumbnail-actions'

/**
 * The Publish card's thumbnail actions against the test database, on the
 * seeded fixture project. The Inngest client's `send` is a mock: the actions
 * only validate, write rows and send an event, and the event is what is
 * asserted. Every test starts and ends with no publish record (and so no
 * package) on the fixture, as the other Publish suites do.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const inngestSeam = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@/inngest/client', () => ({ inngest: { send: inngestSeam.send } }))
const storageSeam = vi.hoisted(() => ({
  putObject: vi.fn(),
  deleteObject: vi.fn(),
}))
vi.mock('@/lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof StorageLib>()),
  putObject: storageSeam.putObject,
  deleteObject: storageSeam.deleteObject,
  storageConfigured: () => true,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

const MISSING_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const IN_FLIGHT = 'A set is being made. Wait for it to finish.'

async function recordId(): Promise<string> {
  return (await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)).id
}

/** One package row on the fixture's record; ready, generated and composed unless said otherwise. */
async function addPackage(
  publishRecordId: string,
  position: number,
  values: Partial<typeof thumbnailPackages.$inferInsert> = {},
) {
  const [row] = await db
    .insert(thumbnailPackages)
    .values({
      publishRecordId,
      position,
      source: 'generated',
      state: 'ready',
      title: `Title ${position}`,
      pictureKey: `picture-${position}.png`,
      composedKey: `composed-${position}.jpg`,
      ...values,
    })
    .returning()
  return row!
}

async function storedRecord() {
  const record = await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID)
  return record!
}

/** A PNG header with the given size: all the upload action reads. */
function pngBytes(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

describeDb('the thumbnail actions', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    inngestSeam.send.mockReset()
    inngestSeam.send.mockResolvedValue({ ids: ['evt'] })
    storageSeam.putObject.mockReset()
    storageSeam.deleteObject.mockReset()
    await seed(db)
    await db.delete(publishRecords)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(publishRecords)
  })

  describe('generateThumbnailSet', () => {
    it('refuses a Short', async () => {
      expect(await generateThumbnailSet('short', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: "Generated sets are for the full film. A Short's thumbnail is an upload.",
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('refuses when the record is on YouTube', async () => {
      const id = await recordId()
      await updatePublishRecord(db, id, { status: 'scheduled' })
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'This item is already on YouTube — edit it in Studio.',
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('refuses a second set while one is being made', async () => {
      const id = await recordId()
      await addPackage(id, 0, { state: 'painting' })
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('a second Generate before the plan lands is refused', async () => {
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      // The plan has not landed: there is no package row yet.
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect((await storedRecord()).metadata['thumbnailSetRequestedAt']).toEqual(expect.any(String))
    })

    it('a failed send releases the claim', async () => {
      inngestSeam.send.mockRejectedValueOnce(new Error('unreachable'))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
          ok: false,
          error: 'Could not reach Inngest to start the set.',
        })
      } finally {
        logged.mockRestore()
      }
      expect((await storedRecord()).metadata['thumbnailSetRequestedAt']).toBeUndefined()

      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    })

    it('a set stuck for sixteen minutes no longer blocks a new one', async () => {
      const id = await recordId()
      await addPackage(id, 0, { state: 'planned', updatedAt: new Date(Date.now() - 16 * 60_000) })
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
    })

    it('refuses with three approved', async () => {
      const id = await recordId()
      for (const position of [0, 1, 2]) await addPackage(id, position, { approvedAt: new Date() })
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'Three thumbnails are already approved. Remove one to generate more.',
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('says so when the routed provider has no stored key, outside mock mode', async () => {
      vi.stubEnv('MOCK_PROVIDERS', '')
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'Thumbnails run on Gemini, but no Gemini key is stored in Settings, Connections.',
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('sends one set request and backfills uploads first', async () => {
      const id = await recordId()
      await updatePublishRecord(db, id, { uploadedThumbKeys: ['boom-busters/thumbs/x/old.png'] })

      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect(inngestSeam.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'thumbnails/set.requested',
          data: { projectId: FIXTURE_PROJECT_ID, targetId: FIXTURE_PROJECT_ID, mode: 'set' },
        }),
      )
      const rows = await listThumbnailPackages(db, id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        source: 'uploaded',
        composedKey: 'boom-busters/thumbs/x/old.png',
      })
      expect(rows[0]!.approvedAt).not.toBeNull()
    })
  })

  describe('a package id', () => {
    it('refuses a package id that does not exist', async () => {
      for (const bad of [MISSING_ID, 'not-an-id']) {
        expect(await regenerateThumbnailPicture(bad)).toEqual({
          ok: false,
          error: 'Unknown thumbnail',
        })
        expect(await saveThumbnailPackage(bad, { title: 'x' })).toEqual({
          ok: false,
          error: 'Unknown thumbnail',
        })
        expect(await makeDefaultThumbnail(bad)).toEqual({ ok: false, error: 'Unknown thumbnail' })
        expect(await removeThumbnailPackageAction(bad)).toEqual({
          ok: false,
          error: 'Unknown thumbnail',
        })
      }
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('applies the editable rule of the package record', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      await updatePublishRecord(db, id, { status: 'live' })
      expect(await regenerateThumbnailPicture(row.id)).toEqual({
        ok: false,
        error: 'This item is already on YouTube — edit it in Studio.',
      })
    })
  })

  describe('regenerateThumbnailPicture', () => {
    it('sends one paint event for that package and marks it painting', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)

      expect(await regenerateThumbnailPicture(row.id)).toEqual({ ok: true })

      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect(inngestSeam.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'thumbnails/set.requested',
          data: {
            projectId: FIXTURE_PROJECT_ID,
            targetId: FIXTURE_PROJECT_ID,
            mode: 'paint',
            packageId: row.id,
          },
        }),
      )
      expect((await listThumbnailPackages(db, id))[0]!.state).toBe('painting')
      // The second click, before the run starts, is refused.
      expect(await regenerateThumbnailPicture(row.id)).toEqual({ ok: false, error: IN_FLIGHT })
      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
    })

    it('puts the package back when Inngest cannot be reached', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      inngestSeam.send.mockRejectedValueOnce(new Error('down'))
      vi.spyOn(console, 'error').mockImplementation(() => undefined)

      expect(await regenerateThumbnailPicture(row.id)).toEqual({
        ok: false,
        error: 'Could not reach Inngest to start the work.',
      })
      expect((await listThumbnailPackages(db, id))[0]!.state).toBe('ready')
    })

    it('refuses an uploaded package', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { source: 'uploaded', pictureKey: null })
      expect((await regenerateThumbnailPicture(row.id)).ok).toBe(false)
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })
  })

  describe('saveThumbnailPackage', () => {
    it('a headline edit recomposes and buys nothing', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { headline: 'OLD' })

      expect(await saveThumbnailPackage(row.id, { headline: '  THE FALL  ' })).toEqual({
        ok: true,
      })

      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect(inngestSeam.send).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            projectId: FIXTURE_PROJECT_ID,
            targetId: FIXTURE_PROJECT_ID,
            mode: 'compose',
            packageId: row.id,
          },
        }),
      )
      expect((await listThumbnailPackages(db, id))[0]!.headline).toBe('THE FALL')
    })

    it('a text-side change recomposes too, and a long headline only warns on the card', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { textSide: 'left' })
      await saveThumbnailPackage(row.id, { textSide: 'right', headline: 'ONE TWO THREE FOUR FIVE' })
      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect((await listThumbnailPackages(db, id))[0]).toMatchObject({
        textSide: 'right',
        headline: 'ONE TWO THREE FOUR FIVE',
      })
    })

    it('saves the words and sends nothing when there is no picture yet', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { state: 'failed', pictureKey: null, composedKey: null })
      expect(await saveThumbnailPackage(row.id, { headline: 'NEW' })).toEqual({ ok: true })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect((await listThumbnailPackages(db, id))[0]!.headline).toBe('NEW')
    })

    it('refuses a headline change while the package is being painted', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { state: 'painting' })
      expect(await saveThumbnailPackage(row.id, { headline: 'NEW' })).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
    })

    it('refuses a title over 100 characters', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      expect((await saveThumbnailPackage(row.id, { title: 'x'.repeat(101) })).ok).toBe(false)
    })

    it('takes an idea on an uploaded package only', async () => {
      const id = await recordId()
      const uploaded = await addPackage(id, 0, { source: 'uploaded', pictureKey: null })
      const generated = await addPackage(id, 1)
      expect(await saveThumbnailPackage(uploaded.id, { idea: 'figure' })).toEqual({ ok: true })
      expect((await saveThumbnailPackage(generated.id, { idea: 'figure' })).ok).toBe(false)
      expect((await listThumbnailPackages(db, id))[0]!.idea).toBe('figure')
    })

    it('a title edit on the approved default updates the upload title', async () => {
      const id = await recordId()
      const first = await addPackage(id, 0, { title: 'Old', approvedAt: new Date() })
      await addPackage(id, 1, { title: 'Second', approvedAt: new Date() })
      await updatePublishRecord(db, id, {
        uploadedThumbKeys: ['composed-0.jpg', 'composed-1.jpg'],
        metadata: { title: 'Old', tags: ['keep'] },
      })

      expect(await saveThumbnailPackage(first.id, { title: 'A better title' })).toEqual({
        ok: true,
      })

      expect((await storedRecord()).metadata).toMatchObject({
        title: 'A better title',
        tags: ['keep'],
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('a title edit on the second package leaves the upload title alone', async () => {
      const id = await recordId()
      await addPackage(id, 0, { title: 'Default', approvedAt: new Date() })
      const second = await addPackage(id, 1, { title: 'Second', approvedAt: new Date() })
      await updatePublishRecord(db, id, {
        uploadedThumbKeys: ['composed-0.jpg', 'composed-1.jpg'],
        metadata: { title: 'Default' },
      })
      await saveThumbnailPackage(second.id, { title: 'Changed' })
      expect((await storedRecord()).metadata).toMatchObject({ title: 'Default' })
    })
  })

  describe('makeDefaultThumbnail and removeThumbnailPackageAction', () => {
    it('makes an approved package the default, with its image and title', async () => {
      const id = await recordId()
      await addPackage(id, 0, { title: 'First', approvedAt: new Date() })
      const second = await addPackage(id, 1, { title: 'Second', approvedAt: new Date() })
      await updatePublishRecord(db, id, {
        uploadedThumbKeys: ['composed-0.jpg', 'composed-1.jpg'],
      })

      expect(await makeDefaultThumbnail(second.id)).toEqual({ ok: true })

      const record = await storedRecord()
      expect(record.uploadedThumbKeys).toEqual(['composed-1.jpg', 'composed-0.jpg'])
      expect(record.metadata).toMatchObject({ title: 'Second' })
    })

    it('removes a package and deletes its objects after the row', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)

      expect(await removeThumbnailPackageAction(row.id)).toEqual({ ok: true })

      expect(await listThumbnailPackages(db, id)).toEqual([])
      expect(storageSeam.deleteObject.mock.calls.map((call) => call[0]).sort()).toEqual([
        'composed-0.jpg',
        'picture-0.png',
      ])
    })

    it('refuses to remove a package that is being painted', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { state: 'painting' })
      expect(await removeThumbnailPackageAction(row.id)).toEqual({ ok: false, error: IN_FLIGHT })
      expect(await listThumbnailPackages(db, id)).toHaveLength(1)
    })
  })

  describe('approveThumbnailSet', () => {
    it('approves the ready packages and writes the keys and the default title', async () => {
      const id = await recordId()
      await addPackage(id, 0, { title: 'The default' })
      await addPackage(id, 1)

      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

      const record = await storedRecord()
      expect(record.uploadedThumbKeys).toEqual(['composed-0.jpg', 'composed-1.jpg'])
      expect(record.metadata).toMatchObject({ title: 'The default' })
    })

    it('refuses to approve past three', async () => {
      const id = await recordId()
      await addPackage(id, 0, { source: 'uploaded', pictureKey: null, approvedAt: new Date() })
      for (const position of [1, 2, 3]) await addPackage(id, position)
      await updatePublishRecord(db, id, { uploadedThumbKeys: ['composed-0.jpg'] })

      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'Three thumbnails at most. Remove 1 before approving.',
      })
      expect((await storedRecord()).uploadedThumbKeys).toEqual(['composed-0.jpg'])
    })

    it('approval leaves a saved title alone when the default does not change', async () => {
      const id = await recordId()
      await addPackage(id, 0, { title: 'The default', approvedAt: new Date() })
      await addPackage(id, 1)
      await updatePublishRecord(db, id, {
        uploadedThumbKeys: ['composed-0.jpg'],
        metadata: { title: 'A draft title the owner typed', tags: ['keep'] },
      })

      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

      expect((await storedRecord()).metadata).toMatchObject({
        title: 'A draft title the owner typed',
        tags: ['keep'],
      })
    })

    it('approval replaces a saved title with the title of a new default', async () => {
      const id = await recordId()
      await addPackage(id, 0, { title: 'The default' })
      await updatePublishRecord(db, id, {
        metadata: { title: 'A draft title the owner typed', tags: ['keep'] },
      })

      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

      expect((await storedRecord()).metadata).toMatchObject({
        title: 'The default',
        tags: ['keep'],
      })
    })

    it('says when there is nothing new to approve', async () => {
      const id = await recordId()
      await addPackage(id, 0, { approvedAt: new Date() })
      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: 'There is nothing new to approve.',
      })
    })

    it('refuses while any package of the record is being made', async () => {
      const id = await recordId()
      await addPackage(id, 0)
      await addPackage(id, 1, { state: 'planned', pictureKey: null, composedKey: null })
      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
    })

    it('refuses a Short', async () => {
      expect((await approveThumbnailSet('short', FIXTURE_PROJECT_ID)).ok).toBe(false)
    })
  })

  describe('uploads', () => {
    it('an uploaded PNG gets a package row, and removing it removes both', async () => {
      const form = new FormData()
      form.set('targetType', 'master')
      form.set('targetId', FIXTURE_PROJECT_ID)
      form.set('file', new File([new Uint8Array(pngBytes(1280, 720))], 'thumb.png'))

      expect(await uploadThumbnail(form)).toEqual({ ok: true })

      const record = await storedRecord()
      const rows = await listThumbnailPackages(db, record.id)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ source: 'uploaded', state: 'ready' })
      expect(rows[0]!.approvedAt).not.toBeNull()
      const key = rows[0]!.composedKey!
      expect(record.uploadedThumbKeys).toEqual([key])

      expect(await removeThumbnail('master', FIXTURE_PROJECT_ID, key)).toEqual({ ok: true })

      expect(await listThumbnailPackages(db, record.id)).toEqual([])
      expect((await storedRecord()).uploadedThumbKeys).toEqual([])
      expect(storageSeam.deleteObject).toHaveBeenCalledWith(key)
    })

    it('uploading a third thumbnail leaves the saved title alone', async () => {
      const id = await recordId()
      await addPackage(id, 0, { title: 'A', composedKey: 'k0.jpg', approvedAt: new Date() })
      await addPackage(id, 1, { title: 'B', composedKey: 'k1.jpg', approvedAt: new Date() })
      await updatePublishRecord(db, id, {
        uploadedThumbKeys: ['k0.jpg', 'k1.jpg'],
        metadata: { title: 'A hand-edited' },
      })
      const form = new FormData()
      form.set('targetType', 'master')
      form.set('targetId', FIXTURE_PROJECT_ID)
      form.set('file', new File([new Uint8Array(pngBytes(1280, 720))], 'thumb.png'))

      expect(await uploadThumbnail(form)).toEqual({ ok: true })

      const record = await storedRecord()
      expect(record.uploadedThumbKeys).toHaveLength(3)
      expect(record.metadata['title']).toBe('A hand-edited')
    })

    it('removing a key stored before the table existed backfills its row first', async () => {
      const id = await recordId()
      await updatePublishRecord(db, id, { uploadedThumbKeys: ['old-a.png', 'old-b.png'] })

      expect(await removeThumbnail('master', FIXTURE_PROJECT_ID, 'old-a.png')).toEqual({ ok: true })

      expect((await storedRecord()).uploadedThumbKeys).toEqual(['old-b.png'])
      const rows = await db
        .select()
        .from(thumbnailPackages)
        .where(eq(thumbnailPackages.publishRecordId, id))
      expect(rows.map((row) => row.composedKey)).toEqual(['old-b.png'])
    })
  })
})

describeDb('the Test & Compare actions', () => {
  const NOT_ON_YOUTUBE = 'A test needs the video on YouTube and at least two approved thumbnails.'

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await db.delete(publishRecords)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await db.delete(publishRecords)
  })

  /** An uploaded record with approved packages; returns the record and package ids. */
  async function liveRecord(approved = 3, status: 'uploaded' | 'scheduled' | 'live' = 'live') {
    const id = await recordId()
    await updatePublishRecord(db, id, { status, youtubeVideoId: 'vid-1' })
    const ids: string[] = []
    for (let position = 0; position < approved; position += 1) {
      ids.push((await addPackage(id, position, { approvedAt: new Date() })).id)
    }
    return { id, ids }
  }

  const outcomes = async (id: string) =>
    (await listThumbnailPackages(db, id)).map((row) => [row.result, row.watchTimeShare])

  describe('markTestStarted', () => {
    it('marks a test started only with two approved packages on an uploaded video', async () => {
      const id = await recordId()
      await addPackage(id, 0, { approvedAt: new Date() })
      await addPackage(id, 1, { approvedAt: new Date() })
      // Still a draft: not on YouTube.
      expect(await markTestStarted('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: NOT_ON_YOUTUBE,
      })
      await updatePublishRecord(db, id, { status: 'uploaded' })
      expect(await markTestStarted('short', FIXTURE_PROJECT_ID)).toMatchObject({ ok: false })
      expect(await markTestStarted('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      const first = (await storedRecord()).testStartedAt
      expect(first).not.toBeNull()
      // Pressing it twice is harmless and keeps the first stamp.
      expect(await markTestStarted('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
      expect((await storedRecord()).testStartedAt).toEqual(first)
    })

    it('refuses with one approved package', async () => {
      await liveRecord(1)
      expect(await markTestStarted('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: NOT_ON_YOUTUBE,
      })
      expect((await storedRecord()).testStartedAt).toBeNull()
    })
  })

  describe('recordTestResult', () => {
    it('refuses a result before the test started', async () => {
      const { ids } = await liveRecord()
      expect(
        await recordTestResult('master', FIXTURE_PROJECT_ID, { outcome: { winner: ids[1]! } }),
      ).toEqual({ ok: false, error: 'Mark the test as started first.' })
      expect((await storedRecord()).testEndedAt).toBeNull()
    })

    it('a winner marks the others lost', async () => {
      const { id, ids } = await liveRecord()
      const extra = await addPackage(id, 3, {}) // unapproved: takes no part
      await markTestStarted('master', FIXTURE_PROJECT_ID)
      expect(
        await recordTestResult('master', FIXTURE_PROJECT_ID, {
          outcome: { winner: ids[1]! },
          shares: { [ids[0]!]: 30, [ids[1]!]: 70 },
        }),
      ).toEqual({ ok: true })
      expect(await outcomes(id)).toEqual([
        ['lost', 30],
        ['won', 70],
        ['lost', null],
        [null, null],
      ])
      expect((await getThumbnailPackage(db, extra.id))!.result).toBeNull()
      expect((await storedRecord()).testEndedAt).not.toBeNull()
    })

    it('the same and inconclusive are never recorded as wins or losses', async () => {
      const { id } = await liveRecord()
      await markTestStarted('master', FIXTURE_PROJECT_ID)
      await recordTestResult('master', FIXTURE_PROJECT_ID, { outcome: 'same' })
      expect(await outcomes(id)).toEqual([
        ['same', null],
        ['same', null],
        ['same', null],
      ])
      // A correction overwrites the earlier answer.
      await recordTestResult('master', FIXTURE_PROJECT_ID, { outcome: 'inconclusive' })
      expect((await listThumbnailPackages(db, id)).map((row) => row.result)).toEqual([
        'inconclusive',
        'inconclusive',
        'inconclusive',
      ])
    })

    it('refuses a share above 100, a negative one and an unknown package', async () => {
      const { id, ids } = await liveRecord()
      await markTestStarted('master', FIXTURE_PROJECT_ID)
      const refusal = { ok: false, error: 'A watch time share is a percentage from 0 to 100.' }
      for (const value of [100.5, -1, Number.NaN]) {
        expect(
          await recordTestResult('master', FIXTURE_PROJECT_ID, {
            outcome: 'same',
            shares: { [ids[0]!]: value },
          }),
        ).toEqual(refusal)
      }
      expect(
        await recordTestResult('master', FIXTURE_PROJECT_ID, {
          outcome: 'same',
          shares: { [MISSING_ID]: 10 },
        }),
      ).toMatchObject({ ok: false })
      expect(await outcomes(id)).toEqual([
        [null, null],
        [null, null],
        [null, null],
      ])
      expect((await storedRecord()).testEndedAt).toBeNull()
    })

    it('refuses a winner that is not an approved package of this record', async () => {
      const { id } = await liveRecord()
      const unapproved = await addPackage(id, 3, {})
      await markTestStarted('master', FIXTURE_PROJECT_ID)
      for (const winner of [MISSING_ID, unapproved.id]) {
        expect(
          await recordTestResult('master', FIXTURE_PROJECT_ID, { outcome: { winner } }),
        ).toEqual({ ok: false, error: 'That thumbnail is not part of this test.' })
      }
    })
  })
})
