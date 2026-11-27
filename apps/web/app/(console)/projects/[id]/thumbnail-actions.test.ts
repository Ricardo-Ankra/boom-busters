// @vitest-environment node

import {
  deleteCastMember,
  dismissCastMember,
  ensurePublishRecord,
  FIXTURE_PROJECT_ID,
  getPublishRecord,
  getThumbnailPackage,
  insertCastMember,
  listThumbnailPackages,
  mergePublishMetadata,
  publishRecords,
  requireTestDatabase,
  seed,
  setCastPhotos,
  thumbnailPackages,
  updatePublishRecord,
} from '@boom-busters/db'
import { packageInFlight } from '@boom-busters/schemas'
import { eq } from 'drizzle-orm'
import type * as StorageLib from '@/lib/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { publishNow, removeThumbnail, schedulePublish, uploadThumbnail } from './publish-actions'
import {
  approveThumbnailSet,
  changeThumbnailPicture,
  generateThumbnailSet,
  makeDefaultThumbnail,
  markTestStarted,
  recomposeThumbnail,
  recordTestResult,
  regenerateThumbnailPicture,
  removeThumbnailPackageAction,
  saveThumbnailPackage,
  switchThumbnailPicture,
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

    it('sends the stamp of its own claim with the request', async () => {
      expect(await generateThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })

      const stamp = (await storedRecord()).metadata['thumbnailSetRequestedAt']
      expect(stamp).toEqual(expect.any(String))
      expect(inngestSeam.send.mock.calls[0]![0].data.requestedAt).toBe(stamp)
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
          data: {
            projectId: FIXTURE_PROJECT_ID,
            targetId: FIXTURE_PROJECT_ID,
            mode: 'set',
            requestedAt: expect.any(String),
          },
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
            baseKey: row.pictureKey,
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

    it('regenerate sends the picture it replaces', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { pictureKey: 'the-old-one.png' })
      expect(await regenerateThumbnailPicture(row.id)).toEqual({ ok: true })
      expect(inngestSeam.send.mock.calls[0]![0].data.baseKey).toBe('the-old-one.png')
    })

    it('regenerate is refused on a failed package that has a picture', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { state: 'failed', error: 'Compose failed.' })
      expect(await regenerateThumbnailPicture(row.id)).toEqual({
        ok: false,
        error: 'Compose this thumbnail again first. It is free.',
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect((await listThumbnailPackages(db, id))[0]).toEqual(row)
    })

    it('regenerate still paints a failed package that has no picture', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { pictureKey: null, composedKey: null, state: 'failed' })
      expect(await regenerateThumbnailPicture(row.id)).toEqual({ ok: true })
      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect(inngestSeam.send.mock.calls[0]![0].data).toMatchObject({
        mode: 'paint',
        baseKey: null,
      })
    })

    it('regenerate sends a null base key for a package with no picture', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { pictureKey: null, composedKey: null, state: 'failed' })
      expect(await regenerateThumbnailPicture(row.id)).toEqual({ ok: true })
      expect(inngestSeam.send.mock.calls[0]![0].data.baseKey).toBeNull()
    })
  })

  describe("the owner's brief", () => {
    const PLANNED = {
      subject: 'A tired auditor over a ledger',
      framing: 'Close, eye level',
      textSide: 'right' as const,
      stillSlotIds: ['s1'],
      depicts: [] as string[],
    }
    const PHOTO = {
      r2Key: 'boom-busters/cast/p/face.jpg',
      contentHash: 'face',
      mimeType: 'image/jpeg' as const,
      width: 800,
      height: 800,
      view: 'front' as const,
    }

    async function stored(id: string, packageId: string) {
      return (await listThumbnailPackages(db, id)).find((row) => row.id === packageId)!
    }

    /** A ready, painted package holding the planner's brief. */
    async function planned(id: string, values: Parameters<typeof addPackage>[2] = {}) {
      return addPackage(id, 0, {
        pictureKey: 'boom-busters/thumbs/p/a.png',
        picture: PLANNED,
        ...values,
      })
    }

    /** Runs a body with cast members on the fixture project, removing them after. */
    async function withCast(
      people: { name: string; portrait?: boolean; removed?: boolean }[],
      body: () => Promise<void>,
    ): Promise<void> {
      const made: string[] = []
      try {
        for (const person of people) {
          const member = await insertCastMember(db, {
            projectId: FIXTURE_PROJECT_ID,
            name: person.name,
            role: 'a test person',
          })
          made.push(member.id)
          if (person.portrait !== false) await setCastPhotos(db, member.id, [PHOTO])
          if (person.removed) await dismissCastMember(db, member.id)
        }
        await body()
      } finally {
        for (const memberId of made) await deleteCastMember(db, memberId)
      }
    }

    it('an untouched brief repaints as before', async () => {
      const id = await recordId()
      const row = await planned(id)

      expect(
        await regenerateThumbnailPicture(row.id, {
          subject: ' A tired auditor over a ledger ',
          framing: 'Close, eye level',
        }),
      ).toEqual({ ok: true })

      const after = await stored(id, row.id)
      expect(after.picture).toEqual(PLANNED)
      expect(after.depicts).toEqual([])
      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect(inngestSeam.send.mock.calls[0]![0].data).toEqual({
        projectId: FIXTURE_PROJECT_ID,
        targetId: FIXTURE_PROJECT_ID,
        mode: 'paint',
        packageId: row.id,
        baseKey: 'boom-busters/thumbs/p/a.png',
      })
    })

    it("the owner's brief is stored with the painting mark", async () => {
      await withCast([{ name: 'Adam Neumann' }], async () => {
        const id = await recordId()
        const row = await planned(id, { state: 'ready', error: null })

        expect(
          await regenerateThumbnailPicture(row.id, {
            subject: ' Adam Neumann barefoot on a glass office floor ',
            framing: '',
          }),
        ).toEqual({ ok: true })

        const after = await stored(id, row.id)
        expect(after.state).toBe('painting')
        expect(after.error).toBeNull()
        expect(after.depicts).toEqual(['Adam Neumann'])
        expect(after.picture).toEqual({
          subject: 'Adam Neumann barefoot on a glass office floor',
          framing: '',
          textSide: 'right',
          stillSlotIds: [],
          depicts: ['Adam Neumann'],
        })
        expect(inngestSeam.send).toHaveBeenCalledTimes(1)
        expect(inngestSeam.send.mock.calls[0]![0].data).toEqual({
          projectId: FIXTURE_PROJECT_ID,
          targetId: FIXTURE_PROJECT_ID,
          mode: 'paint',
          packageId: row.id,
          baseKey: 'boom-busters/thumbs/p/a.png',
        })
      })
    })

    it('a refused brief touches nothing', async () => {
      await withCast(
        [
          { name: 'Adam Neumann' },
          { name: 'Masayoshi Son', portrait: false },
          { name: 'Rebekah Neumann', removed: true },
        ],
        async () => {
          const id = await recordId()
          const row = await planned(id)
          const refusals: [string, string][] = [
            ['   ', 'Write what the picture shows.'],
            ['a'.repeat(401), 'The picture is at most 400 characters.'],
            ['Rebekah Neumann at a desk', 'Rebekah Neumann was removed from the cast.'],
            [
              'Masayoshi Son in a doorway',
              'Masayoshi Son has no portrait. Add one on the Cast card first.',
            ],
          ]
          for (const [subject, error] of refusals) {
            expect(await regenerateThumbnailPicture(row.id, { subject, framing: '' })).toEqual({
              ok: false,
              error,
            })
          }
          expect(
            await regenerateThumbnailPicture(row.id, {
              subject: 'A vault door',
              framing: 'a'.repeat(401),
            }),
          ).toEqual({ ok: false, error: 'The framing is at most 400 characters.' })
          expect(await stored(id, row.id)).toEqual(row)
          expect(inngestSeam.send).not.toHaveBeenCalled()
        },
      )
    })

    it('a brief that is not text is refused', async () => {
      const id = await recordId()
      const row = await planned(id)
      const junk = { subject: 5, framing: null } as unknown as { subject: string; framing: string }
      expect(await regenerateThumbnailPicture(row.id, junk)).toEqual({
        ok: false,
        error: 'Write what the picture shows.',
      })
      expect(
        await regenerateThumbnailPicture(row.id, 'a vault door' as unknown as typeof junk),
      ).toEqual({ ok: false, error: 'Write what the picture shows.' })
      expect(await stored(id, row.id)).toEqual(row)
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('the brief is put back when the send fails', async () => {
      await withCast([{ name: 'Adam Neumann' }], async () => {
        const id = await recordId()
        const row = await planned(id)
        inngestSeam.send.mockRejectedValueOnce(new Error('down'))
        vi.spyOn(console, 'error').mockImplementation(() => undefined)

        expect(
          await regenerateThumbnailPicture(row.id, {
            subject: 'Adam Neumann at a desk',
            framing: '',
          }),
        ).toEqual({ ok: false, error: 'Could not reach Inngest to start the work.' })

        const after = await stored(id, row.id)
        expect(after.state).toBe('ready')
        expect(after.error).toBeNull()
        expect(after.depicts).toEqual([])
        expect(after.picture).toEqual(PLANNED)
      })
    })

    it('the existing guards come first', async () => {
      const brief = { subject: 'A vault door left open', framing: '' }
      const id = await recordId()

      const inFlight = await planned(id, { state: 'painting' })
      expect(await regenerateThumbnailPicture(inFlight.id, brief)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      expect((await stored(id, inFlight.id)).picture).toEqual(PLANNED)
      await db.delete(thumbnailPackages).where(eq(thumbnailPackages.id, inFlight.id))

      const failed = await planned(id, { state: 'failed', error: 'Compose failed.' })
      expect(await regenerateThumbnailPicture(failed.id, brief)).toEqual({
        ok: false,
        error: 'Compose this thumbnail again first. It is free.',
      })
      expect((await stored(id, failed.id)).picture).toEqual(PLANNED)

      const uploaded = await addPackage(id, 1, { source: 'uploaded', pictureKey: null })
      expect(await regenerateThumbnailPicture(uploaded.id, brief)).toEqual({
        ok: false,
        error: 'Only a generated thumbnail has a picture to paint again.',
      })
      expect((await stored(id, uploaded.id)).picture).toBeNull()
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('a failed package with no picture takes a new brief', async () => {
      const id = await recordId()
      const row = await planned(id, { state: 'failed', pictureKey: null, composedKey: null })

      expect(
        await regenerateThumbnailPicture(row.id, {
          subject: 'A vault door left open',
          framing: '',
        }),
      ).toEqual({ ok: true })

      expect((await stored(id, row.id)).picture).toMatchObject({
        subject: 'A vault door left open',
        stillSlotIds: [],
      })
      expect(inngestSeam.send.mock.calls[0]![0].data.baseKey).toBeNull()
    })

    it('a package with no brief takes one, on the side its headline is set', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { picture: null, textSide: 'right' })

      expect(
        await regenerateThumbnailPicture(row.id, {
          subject: 'A vault door left open',
          framing: '',
        }),
      ).toEqual({ ok: true })

      expect((await stored(id, row.id)).picture).toEqual({
        subject: 'A vault door left open',
        framing: '',
        textSide: 'right',
        stillSlotIds: [],
        depicts: [],
      })
    })
  })

  describe('changeThumbnailPicture', () => {
    const NO_PICTURE = 'There is no picture to change. Regenerate the picture.'
    const NOT_COMPOSED = 'Compose this thumbnail again first. It is free.'

    /** The row exactly as stored, for "left as it was". */
    async function stored(id: string, packageId: string) {
      return (await listThumbnailPackages(db, id)).find((row) => row.id === packageId)!
    }

    /** Runs a body with cast members of the fixture project, removing them after. */
    async function withCast(
      present: string[],
      removed: string[],
      body: () => Promise<void>,
    ): Promise<void> {
      const made: string[] = []
      try {
        for (const name of [...present, ...removed]) {
          const member = await insertCastMember(db, {
            projectId: FIXTURE_PROJECT_ID,
            name,
            role: 'a test person',
          })
          made.push(member.id)
          if (removed.includes(name)) await dismissCastMember(db, member.id)
        }
        await body()
      } finally {
        for (const memberId of made) await deleteCastMember(db, memberId)
      }
    }

    it('a change marks the package and sends the note with its base key', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)

      expect(await changeThumbnailPicture(row.id, '  darker sky ')).toEqual({ ok: true })

      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      expect(inngestSeam.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'thumbnails/set.requested',
          data: {
            projectId: FIXTURE_PROJECT_ID,
            targetId: FIXTURE_PROJECT_ID,
            mode: 'change',
            packageId: row.id,
            note: 'darker sky',
            baseKey: row.pictureKey,
          },
        }),
      )
      expect((await stored(id, row.id)).state).toBe('painting')
    })

    it('a change is refused without a picture', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { pictureKey: null, composedKey: null, state: 'failed' })
      expect(await changeThumbnailPicture(row.id, 'darker sky')).toEqual({
        ok: false,
        error: NO_PICTURE,
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused while the package is being made', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { state: 'painting' })
      expect(await changeThumbnailPicture(row.id, 'darker sky')).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused while a set is being planned', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      await mergePublishMetadata(db, id, { thumbnailSetRequestedAt: new Date().toISOString() })
      expect(await changeThumbnailPicture(row.id, 'darker sky')).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused for an empty note and for a note past 300 characters', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      expect(await changeThumbnailPicture(row.id, '   ')).toEqual({
        ok: false,
        error: 'Write what to change.',
      })
      expect(await changeThumbnailPicture(row.id, 'x'.repeat(301))).toEqual({
        ok: false,
        error: 'A change is at most 300 characters.',
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused for a cast member the picture does not show', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { depicts: [] })
      await withCast(['Zelda Quillfeather'], [], async () => {
        expect(await changeThumbnailPicture(row.id, 'put Zelda Quillfeather on the left')).toEqual({
          ok: false,
          error: 'Zelda Quillfeather is not shown in this picture. A change cannot add a person.',
        })
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused for someone removed from the cast', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { depicts: [] })
      await withCast([], ['Mortimer Vandersloot'], async () => {
        expect(await changeThumbnailPicture(row.id, 'add Mortimer Vandersloot behind')).toEqual({
          ok: false,
          error: 'Mortimer Vandersloot was removed from the cast.',
        })
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused on a package that was painted but not composed', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, {
        state: 'failed',
        error: 'Compose failed.',
        pictureKey: 'p2.png',
        previousPictureKey: 'p1.png',
      })
      expect(await changeThumbnailPicture(row.id, 'darker sky')).toEqual({
        ok: false,
        error: NOT_COMPOSED,
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused on a package whose run died after the picture landed', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, {
        state: 'painting',
        pictureKey: 'p2.png',
        previousPictureKey: 'p1.png',
        updatedAt: new Date(Date.now() - 16 * 60_000),
      })
      expect(await changeThumbnailPicture(row.id, 'darker sky')).toEqual({
        ok: false,
        error: NOT_COMPOSED,
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a note that is not text is refused', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      for (const note of [undefined, 42]) {
        expect(await changeThumbnailPicture(row.id, note as unknown as string)).toEqual({
          ok: false,
          error: 'Write what to change.',
        })
      }
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change is refused on a record that is uploading', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      await updatePublishRecord(db, id, { status: 'live' })
      expect(await changeThumbnailPicture(row.id, 'darker sky')).toEqual({
        ok: false,
        error: 'This item is already on YouTube — edit it in Studio.',
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect(await stored(id, row.id)).toEqual(row)
    })

    it('a change that cannot be requested puts the state back', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { state: 'ready', error: 'old trouble' })
      inngestSeam.send.mockRejectedValueOnce(new Error('down'))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        expect(await changeThumbnailPicture(row.id, 'darker sky')).toEqual({
          ok: false,
          error: 'Could not reach Inngest to start the work.',
        })
      } finally {
        logged.mockRestore()
      }
      const after = await stored(id, row.id)
      expect(after.state).toBe('ready')
      expect(after.error).toBe('old trouble')
    })
  })

  describe('switchThumbnailPicture', () => {
    it('back to previous swaps the pictures and composes', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, {
        pictureKey: 'now.png',
        previousPictureKey: 'before.png',
      })

      expect(await switchThumbnailPicture(row.id)).toEqual({ ok: true })

      const after = (await listThumbnailPackages(db, id))[0]!
      expect(after).toMatchObject({
        pictureKey: 'before.png',
        previousPictureKey: 'now.png',
        state: 'painting',
      })
      expect(inngestSeam.send).toHaveBeenCalledTimes(1)
      const data = inngestSeam.send.mock.calls[0]![0].data
      expect(data).toEqual({
        projectId: FIXTURE_PROJECT_ID,
        targetId: FIXTURE_PROJECT_ID,
        mode: 'compose',
        packageId: row.id,
      })
      expect('note' in data).toBe(false)
      expect('baseKey' in data).toBe(false)
    })

    it('back to previous is refused without a previous picture', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      expect(await switchThumbnailPicture(row.id)).toEqual({
        ok: false,
        error: 'There is no previous picture.',
      })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect((await listThumbnailPackages(db, id))[0]).toEqual(row)
    })

    it('back to previous is refused while the package is being made', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { state: 'painting', previousPictureKey: 'before.png' })
      expect(await switchThumbnailPicture(row.id)).toEqual({ ok: false, error: IN_FLIGHT })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      expect((await listThumbnailPackages(db, id))[0]).toEqual(row)
    })

    it('back to previous that cannot be requested swaps back', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, {
        state: 'failed',
        error: 'old trouble',
        pictureKey: 'now.png',
        previousPictureKey: 'before.png',
      })
      inngestSeam.send.mockRejectedValueOnce(new Error('down'))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      try {
        expect(await switchThumbnailPicture(row.id)).toEqual({
          ok: false,
          error: 'Could not reach Inngest to start the work.',
        })
      } finally {
        logged.mockRestore()
      }
      expect((await listThumbnailPackages(db, id))[0]).toMatchObject({
        pictureKey: 'now.png',
        previousPictureKey: 'before.png',
        state: 'failed',
        error: 'old trouble',
      })
    })

    it("back to previous on an approved package leaves the record's keys alone", async () => {
      const id = await recordId()
      await updatePublishRecord(db, id, { uploadedThumbKeys: ['composed-0.jpg'] })
      const row = await addPackage(id, 0, {
        approvedAt: new Date(),
        pictureKey: 'now.png',
        previousPictureKey: 'before.png',
      })
      expect(await switchThumbnailPicture(row.id)).toEqual({ ok: true })
      expect((await storedRecord()).uploadedThumbKeys).toEqual(['composed-0.jpg'])
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

    it('a headline edit puts the package in flight', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { headline: 'OLD', error: 'a stale warning' })

      expect(await saveThumbnailPackage(row.id, { headline: 'NEW' })).toEqual({ ok: true })

      const stored = await getThumbnailPackage(db, row.id)
      expect(stored).toMatchObject({ state: 'painting', error: null })
      expect(packageInFlight(stored!, new Date())).toBe(true)
      // Nothing can approve it, or change it again, until the compose lands.
      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      expect(await saveThumbnailPackage(row.id, { headline: 'NEWER' })).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
    })

    it('a failed compose send restores the package', async () => {
      inngestSeam.send.mockRejectedValueOnce(new Error('unreachable'))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const id = await recordId()
      const row = await addPackage(id, 0, { headline: 'OLD', error: 'kept words' })
      try {
        expect(await saveThumbnailPackage(row.id, { headline: 'NEW' })).toEqual({
          ok: false,
          error: 'Could not reach Inngest to start the work.',
        })
      } finally {
        logged.mockRestore()
      }
      expect(await getThumbnailPackage(db, row.id)).toMatchObject({
        state: 'ready',
        error: 'kept words',
      })
    })

    it('a compose that cannot be requested puts the headline and the side back', async () => {
      inngestSeam.send.mockRejectedValueOnce(new Error('unreachable'))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const id = await recordId()
      const row = await addPackage(id, 0, {
        headline: 'OLD',
        textSide: 'left',
        title: 'Old title',
        error: 'kept words',
      })
      try {
        expect(
          await saveThumbnailPackage(row.id, {
            headline: 'NEW',
            textSide: 'right',
            title: 'New title',
          }),
        ).toEqual({ ok: false, error: 'Could not reach Inngest to start the work.' })
      } finally {
        logged.mockRestore()
      }
      expect(await getThumbnailPackage(db, row.id)).toMatchObject({
        state: 'ready',
        error: 'kept words',
        headline: 'OLD',
        textSide: 'left',
        // A title changed in the same save stays changed.
        title: 'New title',
      })
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

  describe('recomposeThumbnail', () => {
    it('sends a compose for a failed package that kept its picture, and buys nothing', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, {
        state: 'failed',
        error: 'The browser would not start.',
      })

      expect(await recomposeThumbnail(row.id)).toEqual({ ok: true })

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
      expect(await getThumbnailPackage(db, row.id)).toMatchObject({
        state: 'painting',
        error: null,
      })
    })

    it('refuses a package with no picture', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0, { pictureKey: null, state: 'failed' })
      const uploaded = await addPackage(id, 1, { source: 'uploaded', pictureKey: null })

      for (const target of [row, uploaded]) {
        expect(await recomposeThumbnail(target.id)).toEqual({
          ok: false,
          error: 'There is no picture to compose. Regenerate the picture.',
        })
      }
      expect(inngestSeam.send).not.toHaveBeenCalled()
    })

    it('refuses a package in flight, and restores the package when the send fails', async () => {
      const id = await recordId()
      const busy = await addPackage(id, 0, { state: 'painting' })
      expect(await recomposeThumbnail(busy.id)).toEqual({ ok: false, error: IN_FLIGHT })

      inngestSeam.send.mockRejectedValueOnce(new Error('unreachable'))
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const failed = await addPackage(id, 1, { state: 'failed', error: 'kept words' })
      try {
        expect((await recomposeThumbnail(failed.id)).ok).toBe(false)
      } finally {
        logged.mockRestore()
      }
      expect(await getThumbnailPackage(db, failed.id)).toMatchObject({
        state: 'failed',
        error: 'kept words',
      })
    })
  })

  describe('a set being planned (the claim, before any row)', () => {
    const SIXTEEN_MINUTES = 16 * 60_000

    async function claim(ageMs: number): Promise<void> {
      await mergePublishMetadata(db, await recordId(), {
        thumbnailSetRequestedAt: new Date(Date.now() - ageMs).toISOString(),
      })
    }

    it('approving is refused under a fresh claim, and allowed under a stale one', async () => {
      const id = await recordId()
      await addPackage(id, 0)
      await claim(1000)
      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      await claim(SIXTEEN_MINUTES)
      expect(await approveThumbnailSet('master', FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    })

    it('painting a picture again is refused under a fresh claim, and allowed under a stale one', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      await claim(1000)
      expect(await regenerateThumbnailPicture(row.id)).toEqual({ ok: false, error: IN_FLIGHT })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      await claim(SIXTEEN_MINUTES)
      expect(await regenerateThumbnailPicture(row.id)).toEqual({ ok: true })
    })

    it('setting the type again is refused under a fresh claim, and allowed under a stale one', async () => {
      const id = await recordId()
      const row = await addPackage(id, 0)
      await claim(1000)
      expect(await recomposeThumbnail(row.id)).toEqual({ ok: false, error: IN_FLIGHT })
      expect(inngestSeam.send).not.toHaveBeenCalled()
      await claim(SIXTEEN_MINUTES)
      expect(await recomposeThumbnail(row.id)).toEqual({ ok: true })
    })
  })

  describe('scheduling while a set is being made', () => {
    it('refuses to schedule while a package is in flight', async () => {
      const id = await recordId()
      await addPackage(id, 0, { state: 'painting' })

      const later = new Date(Date.now() + 3 * 86_400_000).toISOString()
      expect(await schedulePublish('master', FIXTURE_PROJECT_ID, later)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
      expect(await publishNow('master', FIXTURE_PROJECT_ID)).toEqual({
        ok: false,
        error: IN_FLIGHT,
      })
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
