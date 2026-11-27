import { FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import type { PlannedPackage } from '@boom-busters/schemas'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { createCase } from './cases'
import { ensureFirstChannel } from './channels'
import { createDb } from './client'
import { createProjectFromCase } from './projects'
import { ensurePublishRecord, getPublishRecord } from './publish'
import { cases, projects, publishRecords, thumbnailPackages } from './schema'
import { requireTestDatabase } from './test-database'
import {
  addUploadedPackage,
  approvePackages,
  claimThumbnailSetRequest,
  clearThumbnailSetRequest,
  approvedDepicts,
  ensureUploadedPackages,
  finishedTests,
  getThumbnailPackage,
  ideaResults,
  listThumbnailPackages,
  mergePublishMetadata,
  makeDefaultPackage,
  recordTestOutcome,
  recordsAwaitingTestReminder,
  releaseThumbnailWork,
  removeThumbnailPackage,
  replaceUnapprovedGenerated,
  landComposedThumbnail,
  syncApprovedToRecord,
  updateThumbnailPackage,
} from './thumbnail-packages'

/**
 * The packages of a master's publish record against a real database. Each test
 * makes its own project and record and removes them in `finally`; the shared
 * fixture project is never touched.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

function planned(title: string, depicts: string[] = []): PlannedPackage {
  return {
    idea: 'person',
    angle: `Angle for ${title}`,
    title,
    headline: 'THE FALL',
    picture: {
      subject: 'A man at a desk',
      framing: '',
      textSide: 'left',
      stillSlotIds: [],
      depicts,
    },
    claimIds: ['claim-1'],
  }
}

suite('thumbnail packages', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  afterAll(async () => {
    await sql.end()
  })

  /** A project and its master publish record of its own, removed afterwards. */
  async function withRecord(
    run: (record: { id: string; targetId: string }) => Promise<void>,
  ): Promise<void> {
    await ensureFirstChannel(db)
    const kase = await createCase(db, {
      channelId: FIRST_CHANNEL_ID,
      title: 'Thumbnail packages case',
      category: 'con',
    })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'On packages' })
    const record = await ensurePublishRecord(db, 'master', project.id)
    try {
      await run({ id: record.id, targetId: project.id })
    } finally {
      await db.delete(publishRecords).where(eq(publishRecords.id, record.id))
      await db.delete(projects).where(eq(projects.id, project.id))
      await db.delete(cases).where(eq(cases.id, kase.id))
    }
  }

  async function seedRow(
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
        composedKey: `composed-${position}.jpg`,
        ...values,
      })
      .returning()
    return row!
  }

  async function storedKeys(recordId: string): Promise<string[]> {
    const [row] = await db.select().from(publishRecords).where(eq(publishRecords.id, recordId))
    return row!.uploadedThumbKeys
  }

  it('backfills a row per stored key, once', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['a.png', 'b.png'] })
        .where(eq(publishRecords.id, record.id))
      const row = (await getPublishRecord(db, 'master', record.targetId))!

      await ensureUploadedPackages(db, row)
      await ensureUploadedPackages(db, row)

      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.map((r) => r.composedKey)).toEqual(['a.png', 'b.png'])
      expect(rows.map((r) => r.position)).toEqual([0, 1])
      for (const r of rows) {
        expect(r.source).toBe('uploaded')
        expect(r.state).toBe('ready')
        expect(r.approvedAt).not.toBeNull()
      }
    })
  })

  it('replaces unapproved generated packages and keeps approved and uploaded ones', async () => {
    await withRecord(async (record) => {
      const approved = await seedRow(record.id, 0, {
        approvedAt: new Date(),
        pictureKey: 'p0.png',
        composedKey: 'c0.jpg',
      })
      const uploaded = await seedRow(record.id, 1, { source: 'uploaded', composedKey: 'up.png' })
      await seedRow(record.id, 2, { pictureKey: 'p2.png', composedKey: 'c2.jpg' })
      await seedRow(record.id, 3, { pictureKey: 'p3.png', composedKey: null })

      const result = await replaceUnapprovedGenerated(db, record.id, [
        planned('One', ['Ada']),
        planned('Two'),
      ])

      expect(result.orphanedKeys.sort()).toEqual(['c2.jpg', 'p2.png', 'p3.png'])
      expect(result.inserted.map((r) => r.title)).toEqual(['One', 'Two'])
      expect(result.inserted.map((r) => r.position)).toEqual([2, 3])
      for (const r of result.inserted) {
        expect(r.state).toBe('planned')
        expect(r.source).toBe('generated')
      }
      expect(result.inserted[0]?.depicts).toEqual(['Ada'])
      expect(result.inserted[0]?.textSide).toBe('left')

      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.map((r) => r.id)).toEqual([
        approved.id,
        uploaded.id,
        ...result.inserted.map((r) => r.id),
      ])
    })
  })

  it('approval writes keys in position order and the default title', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 1, { title: 'Second', composedKey: 'two.jpg' })
      await seedRow(record.id, 0, { title: 'First', composedKey: 'one.jpg' })

      const result = await approvePackages(db, record.id)

      expect(result).toEqual({ ok: true, keys: ['one.jpg', 'two.jpg'], title: 'First' })
      expect(await storedKeys(record.id)).toEqual(['one.jpg', 'two.jpg'])
      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata['title']).toBe('First')
      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.every((r) => r.approvedAt !== null)).toBe(true)
    })
  })

  it('approval leaves a failed package unapproved', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { composedKey: 'good.jpg' })
      const failed = await seedRow(record.id, 1, {
        state: 'failed',
        composedKey: null,
        error: 'Painting failed',
      })

      const result = await approvePackages(db, record.id)

      expect(result).toEqual({ ok: true, keys: ['good.jpg'], title: 'Title 0' })
      const after = await getThumbnailPackage(db, failed.id)
      expect(after?.approvedAt).toBeNull()
      expect(await storedKeys(record.id)).toEqual(['good.jpg'])
    })
  })

  it('keeps another metadata key when approval writes the title', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ metadata: { description: 'Kept', title: 'Old' } })
        .where(eq(publishRecords.id, record.id))
      await seedRow(record.id, 0, { title: 'New title' })

      await approvePackages(db, record.id)

      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata).toEqual({ description: 'Kept', title: 'New title' })
    })
  })

  it('refuses approval past three and changes nothing', async () => {
    await withRecord(async (record) => {
      for (const position of [0, 1, 2]) {
        await seedRow(record.id, position, { approvedAt: new Date() })
      }
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['composed-0.jpg', 'composed-1.jpg', 'composed-2.jpg'] })
        .where(eq(publishRecords.id, record.id))
      const extra = await seedRow(record.id, 3, { composedKey: 'composed-3.jpg' })

      const result = await approvePackages(db, record.id)

      expect(result).toEqual({ ok: false, over: 1 })
      expect(await storedKeys(record.id)).toEqual([
        'composed-0.jpg',
        'composed-1.jpg',
        'composed-2.jpg',
      ])
      expect((await getThumbnailPackage(db, extra.id))?.approvedAt).toBeNull()
    })
  })

  it('making an approved package the default reorders the keys and the title', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { title: 'Zero', composedKey: 'k0.jpg', approvedAt: new Date() })
      await seedRow(record.id, 1, { title: 'One', composedKey: 'k1.jpg', approvedAt: new Date() })
      const third = await seedRow(record.id, 2, {
        title: 'Two',
        composedKey: 'k2.jpg',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['k0.jpg', 'k1.jpg', 'k2.jpg'] })
        .where(eq(publishRecords.id, record.id))

      await makeDefaultPackage(db, record.id, third.id)

      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.map((r) => r.title)).toEqual(['Two', 'Zero', 'One'])
      expect(rows.map((r) => r.position)).toEqual([0, 1, 2])
      expect(await storedKeys(record.id)).toEqual(['k2.jpg', 'k0.jpg', 'k1.jpg'])
      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata['title']).toBe('Two')
    })
  })

  it('making an unapproved package the default leaves the keys alone', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { composedKey: 'k0.jpg', approvedAt: new Date() })
      const second = await seedRow(record.id, 1, { title: 'Other', composedKey: 'k1.jpg' })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['k0.jpg'], metadata: { title: 'Kept title' } })
        .where(eq(publishRecords.id, record.id))

      await makeDefaultPackage(db, record.id, second.id)

      const rows = await listThumbnailPackages(db, record.id)
      expect(rows[0]?.id).toBe(second.id)
      expect(await storedKeys(record.id)).toEqual(['k0.jpg'])
      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata['title']).toBe('Kept title')
    })
  })

  it('the title follows the first approved package, not a failed one ahead of it', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, {
        title: 'Failed title',
        state: 'failed',
        composedKey: null,
        error: 'Painting failed',
      })
      await seedRow(record.id, 1, { title: 'Good title', composedKey: 'one.jpg' })

      const result = await approvePackages(db, record.id)

      expect(result).toEqual({ ok: true, keys: ['one.jpg'], title: 'Good title' })
      expect(await storedKeys(record.id)).toEqual(['one.jpg'])
      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata['title']).toBe('Good title')
    })
  })

  it('approval keeps a stored key that had no row', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['legacy.png'] })
        .where(eq(publishRecords.id, record.id))
      await seedRow(record.id, 0, { composedKey: 'new.jpg' })

      const result = await approvePackages(db, record.id)

      expect(result.ok).toBe(true)
      expect(await storedKeys(record.id)).toEqual(['new.jpg', 'legacy.png'])
      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.find((r) => r.composedKey === 'legacy.png')?.source).toBe('uploaded')
    })
  })

  it('making a package the default keeps a stored key that had no row', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['legacy.png'] })
        .where(eq(publishRecords.id, record.id))
      const generated = await seedRow(record.id, 0, {
        composedKey: 'new.jpg',
        approvedAt: new Date(),
      })

      await makeDefaultPackage(db, record.id, generated.id)

      expect(await storedKeys(record.id)).toEqual(['new.jpg', 'legacy.png'])
      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.map((r) => r.composedKey)).toEqual(['new.jpg', 'legacy.png'])
    })
  })

  it('removing the approved default hands the title to the next approved package', async () => {
    await withRecord(async (record) => {
      const first = await seedRow(record.id, 0, {
        title: 'First',
        composedKey: 'k0.jpg',
        approvedAt: new Date(),
      })
      await seedRow(record.id, 1, {
        title: 'Second',
        composedKey: 'k1.jpg',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['k0.jpg', 'k1.jpg'], metadata: { title: 'First' } })
        .where(eq(publishRecords.id, record.id))

      await removeThumbnailPackage(db, first.id)

      expect(await storedKeys(record.id)).toEqual(['k1.jpg'])
      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata['title']).toBe('Second')
    })
  })

  it('removing the only approved package leaves the title alone', async () => {
    await withRecord(async (record) => {
      const only = await seedRow(record.id, 0, {
        title: 'Only',
        composedKey: 'k0.jpg',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['k0.jpg'], metadata: { title: 'Only' } })
        .where(eq(publishRecords.id, record.id))

      await removeThumbnailPackage(db, only.id)

      expect(await storedKeys(record.id)).toEqual([])
      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata['title']).toBe('Only')
    })
  })

  it('removing an approved package removes its key', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, {
        composedKey: 'k0.jpg',
        pictureKey: 'p0.png',
        approvedAt: new Date(),
      })
      const second = await seedRow(record.id, 1, {
        composedKey: 'k1.jpg',
        pictureKey: 'p1.png',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['k0.jpg', 'k1.jpg'] })
        .where(eq(publishRecords.id, record.id))

      const result = await removeThumbnailPackage(db, second.id)

      expect(result?.orphanedKeys.sort()).toEqual(['k1.jpg', 'p1.png'])
      expect(await storedKeys(record.id)).toEqual(['k0.jpg'])
      expect(await getThumbnailPackage(db, second.id)).toBeUndefined()
      expect(await removeThumbnailPackage(db, second.id)).toBeUndefined()
    })
  })

  it('a composite landing on an approved draft swaps the key in place', async () => {
    await withRecord(async (record) => {
      const row = await seedRow(record.id, 1, {
        composedKey: 'b.jpg',
        state: 'painting',
        approvedAt: new Date(),
        error: 'old',
      })
      await seedRow(record.id, 0, { composedKey: 'a.jpg', approvedAt: new Date() })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['a.jpg', 'b.jpg'] })
        .where(eq(publishRecords.id, record.id))

      const landed = await landComposedThumbnail(db, row.id, {
        composedKey: 'b2.jpg',
        warnings: ['W'],
      })

      expect(landed).toEqual({ landed: true, deleteKeys: ['b.jpg'] })
      expect(await storedKeys(record.id)).toEqual(['a.jpg', 'b2.jpg'])
      expect(await getThumbnailPackage(db, row.id)).toMatchObject({
        composedKey: 'b2.jpg',
        warnings: ['W'],
        state: 'ready',
        error: null,
      })
    })
  })

  it('a composite landing after approval that happened mid-compose still swaps the key', async () => {
    await withRecord(async (record) => {
      // Unapproved when the compose started.
      const row = await seedRow(record.id, 0, { composedKey: 'old.jpg', state: 'painting' })
      await seedRow(record.id, 1, { composedKey: 'other.jpg', approvedAt: new Date() })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['other.jpg'] })
        .where(eq(publishRecords.id, record.id))

      // Approve lands while the browser works: the old composite is approved and listed.
      await db
        .update(thumbnailPackages)
        .set({ approvedAt: new Date() })
        .where(eq(thumbnailPackages.id, row.id))
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['old.jpg', 'other.jpg'] })
        .where(eq(publishRecords.id, record.id))

      const landed = await landComposedThumbnail(db, row.id, {
        composedKey: 'new.jpg',
        warnings: [],
      })

      expect(landed).toEqual({ landed: true, deleteKeys: ['old.jpg'] })
      expect(await storedKeys(record.id)).toEqual(['new.jpg', 'other.jpg'])
    })
  })

  it('a composite landing on a record that is uploading changes nothing and asks for the new object to be deleted', async () => {
    await withRecord(async (record) => {
      const row = await seedRow(record.id, 0, {
        composedKey: 'old.jpg',
        state: 'painting',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['old.jpg'], status: 'uploading' })
        .where(eq(publishRecords.id, record.id))

      const landed = await landComposedThumbnail(db, row.id, {
        composedKey: 'new.jpg',
        warnings: [],
      })

      expect(landed).toEqual({ landed: false, deleteKeys: ['new.jpg'] })
      expect(await storedKeys(record.id)).toEqual(['old.jpg'])
      expect(await getThumbnailPackage(db, row.id)).toMatchObject({
        composedKey: 'old.jpg',
        state: 'ready',
      })
    })
  })

  it('a composite for a package that is gone is deleted, and an identical one is kept', async () => {
    await withRecord(async (record) => {
      expect(
        await landComposedThumbnail(db, '01HQ0000000000000000000000', {
          composedKey: 'x.jpg',
          warnings: [],
        }),
      ).toEqual({ landed: false, deleteKeys: ['x.jpg'] })

      const row = await seedRow(record.id, 0, {
        composedKey: 'same.jpg',
        state: 'painting',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['same.jpg'], status: 'scheduled' })
        .where(eq(publishRecords.id, record.id))
      expect(
        await landComposedThumbnail(db, row.id, { composedKey: 'same.jpg', warnings: [] }),
      ).toEqual({ landed: false, deleteKeys: [] })
    })
  })

  it('the old object is kept while the record still lists it', async () => {
    await withRecord(async (record) => {
      // Unapproved package whose old composite is still in the record's list (held by another row).
      const row = await seedRow(record.id, 0, { composedKey: 'shared.jpg', state: 'painting' })
      await seedRow(record.id, 1, {
        source: 'uploaded',
        composedKey: 'shared.jpg',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['shared.jpg'] })
        .where(eq(publishRecords.id, record.id))

      const landed = await landComposedThumbnail(db, row.id, {
        composedKey: 'new.jpg',
        warnings: [],
      })

      expect(landed).toEqual({ landed: true, deleteKeys: [] })
      expect(await storedKeys(record.id)).toEqual(['shared.jpg'])
    })
  })

  async function savedTitle(record: { targetId: string }): Promise<unknown> {
    const stored = (await getPublishRecord(db, 'master', record.targetId))!
    return stored.metadata['title']
  }

  it('approving a second package leaves a hand-edited title alone', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { title: 'A', composedKey: 'k0.jpg' })
      await approvePackages(db, record.id)
      expect(await savedTitle(record)).toBe('A')
      await db
        .update(publishRecords)
        .set({ metadata: { title: "A'" } })
        .where(eq(publishRecords.id, record.id))
      await seedRow(record.id, 1, { title: 'B', composedKey: 'k1.jpg' })
      await addUploadedPackage(db, record.id, 'mine.png')

      await approvePackages(db, record.id)
      expect(await savedTitle(record)).toBe("A'")

      await syncApprovedToRecord(db, record.id)
      expect(await savedTitle(record)).toBe("A'")
    })
  })

  it('removing a non-default package leaves the title alone', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { title: 'A', composedKey: 'k0.jpg', approvedAt: new Date() })
      const second = await seedRow(record.id, 1, {
        title: 'B',
        composedKey: 'k1.jpg',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['k0.jpg', 'k1.jpg'], metadata: { title: "A'" } })
        .where(eq(publishRecords.id, record.id))

      await removeThumbnailPackage(db, second.id)

      expect(await storedKeys(record.id)).toEqual(['k0.jpg'])
      expect(await savedTitle(record)).toBe("A'")
    })
  })

  it('making another package the default writes its title', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { title: 'A', composedKey: 'k0.jpg', approvedAt: new Date() })
      const second = await seedRow(record.id, 1, {
        title: 'B',
        composedKey: 'k1.jpg',
        approvedAt: new Date(),
      })
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['k0.jpg', 'k1.jpg'], metadata: { title: "A'" } })
        .where(eq(publishRecords.id, record.id))

      await makeDefaultPackage(db, record.id, second.id)

      expect(await savedTitle(record)).toBe('B')
    })
  })

  it('an uploaded package takes the saved title', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ metadata: { title: 'x'.repeat(130) } })
        .where(eq(publishRecords.id, record.id))

      const added = await addUploadedPackage(db, record.id, 'mine.png')

      expect(added.title).toBe('x'.repeat(100))
    })
  })

  it("a backfilled package takes the project's title when no title is saved", async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['legacy.png'] })
        .where(eq(publishRecords.id, record.id))
      const row = (await getPublishRecord(db, 'master', record.targetId))!

      await ensureUploadedPackages(db, row)

      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.map((r) => r.title)).toEqual(['On packages'])
    })
  })

  it('making an uploaded package the default again restores its title', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['legacy.png'], metadata: { title: 'Canva title' } })
        .where(eq(publishRecords.id, record.id))
      const row = (await getPublishRecord(db, 'master', record.targetId))!
      await ensureUploadedPackages(db, row)
      const [uploaded] = await listThumbnailPackages(db, record.id)
      const generated = await seedRow(record.id, 1, {
        title: 'Generated title',
        composedKey: 'g.jpg',
        approvedAt: new Date(),
      })

      await makeDefaultPackage(db, record.id, generated.id)
      expect(await savedTitle(record)).toBe('Generated title')

      await makeDefaultPackage(db, record.id, uploaded!.id)
      expect(await savedTitle(record)).toBe('Canva title')
    })
  })

  it('lists depicted names of approved generated packages only', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { depicts: ['Ada', 'Bo'], approvedAt: new Date() })
      await seedRow(record.id, 1, { depicts: ['Bo', 'Cy'], approvedAt: new Date() })
      await seedRow(record.id, 2, { depicts: ['Unapproved'] })
      await seedRow(record.id, 3, {
        source: 'uploaded',
        depicts: ['Uploaded'],
        approvedAt: new Date(),
      })

      expect((await approvedDepicts(db, record.id)).sort()).toEqual(['Ada', 'Bo', 'Cy'])
    })
  })

  it('updates a package and adds an uploaded one after the highest position', async () => {
    await withRecord(async (record) => {
      const first = await seedRow(record.id, 0)

      const updated = await updateThumbnailPackage(db, first.id, {
        headline: 'NEW',
        state: 'failed',
      })
      expect(updated?.headline).toBe('NEW')
      expect(updated?.state).toBe('failed')
      expect(
        await updateThumbnailPackage(db, '01HQ0000000000000000000000', { headline: 'x' }),
      ).toBe(undefined)

      const added = await addUploadedPackage(db, record.id, 'mine.png')
      expect(added.source).toBe('uploaded')
      expect(added.composedKey).toBe('mine.png')
      expect(added.position).toBe(1)
      expect(added.state).toBe('ready')
      expect(added.approvedAt).toBeNull()
    })
  })

  it('a title edit on the first approved package reaches the record', async () => {
    await withRecord(async (record) => {
      const first = await seedRow(record.id, 0, {
        title: 'Old title',
        composedKey: 'k0.jpg',
        approvedAt: new Date(),
      })
      await seedRow(record.id, 1, { composedKey: 'k1.jpg', approvedAt: new Date() })
      await db
        .update(publishRecords)
        .set({
          uploadedThumbKeys: ['k0.jpg', 'k1.jpg'],
          metadata: { title: 'Old title', tags: ['keep'] },
        })
        .where(eq(publishRecords.id, record.id))

      await updateThumbnailPackage(db, first.id, { title: 'New title' })
      await syncApprovedToRecord(db, record.id, { titleChanged: true })

      const [row] = await db.select().from(publishRecords).where(eq(publishRecords.id, record.id))
      expect(row!.metadata).toMatchObject({ title: 'New title', tags: ['keep'] })
      expect(row!.uploadedThumbKeys).toEqual(['k0.jpg', 'k1.jpg'])
    })
  })

  it('finds live masters with two approved packages and no reminder', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ status: 'live', youtubeVideoId: 'vid123' })
        .where(eq(publishRecords.id, record.id))
      await seedRow(record.id, 0, { approvedAt: new Date() })

      const ids = async () =>
        (await recordsAwaitingTestReminder(db, FIRST_CHANNEL_ID)).map((r) => r.id)

      // One approved package is not a test.
      expect(await ids()).not.toContain(record.id)

      await seedRow(record.id, 1, { approvedAt: new Date() })
      const found = (await recordsAwaitingTestReminder(db, FIRST_CHANNEL_ID)).find(
        (r) => r.id === record.id,
      )
      expect(found).toEqual({ id: record.id, targetId: record.targetId, youtubeVideoId: 'vid123' })

      await db
        .update(publishRecords)
        .set({ testReminderSentAt: new Date() })
        .where(eq(publishRecords.id, record.id))
      expect(await ids()).not.toContain(record.id)
    })
  })
  it('does not remind for a test already marked started', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ status: 'live', youtubeVideoId: 'vid123', testStartedAt: new Date() })
        .where(eq(publishRecords.id, record.id))
      await seedRow(record.id, 0, { approvedAt: new Date() })
      await seedRow(record.id, 1, { approvedAt: new Date() })

      const ids = (await recordsAwaitingTestReminder(db, FIRST_CHANNEL_ID)).map((r) => r.id)
      expect(ids).not.toContain(record.id)
    })
  })

  it('does not remind for a video that went out more than fourteen days ago', async () => {
    await withRecord(async (record) => {
      const day = 24 * 60 * 60_000
      await db
        .update(publishRecords)
        .set({
          status: 'live',
          youtubeVideoId: 'vid123',
          publishAt: new Date(Date.now() - 15 * day),
        })
        .where(eq(publishRecords.id, record.id))
      await seedRow(record.id, 0, { approvedAt: new Date() })
      await seedRow(record.id, 1, { approvedAt: new Date() })
      const ids = async () =>
        (await recordsAwaitingTestReminder(db, FIRST_CHANNEL_ID)).map((r) => r.id)

      expect(await ids()).not.toContain(record.id)

      // With no publish time the upload start counts; a recent one is reminded.
      await db
        .update(publishRecords)
        .set({ publishAt: null, uploadStartedAt: new Date(Date.now() - 2 * day) })
        .where(eq(publishRecords.id, record.id))
      expect(await ids()).toContain(record.id)

      await db
        .update(publishRecords)
        .set({ uploadStartedAt: new Date(Date.now() - 20 * day) })
        .where(eq(publishRecords.id, record.id))
      expect(await ids()).not.toContain(record.id)
    })
  })

  it('a second claim inside fifteen minutes is refused, a stale one is taken', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ metadata: { title: 'Kept' } })
        .where(eq(publishRecords.id, record.id))
      const start = new Date('2026-11-25T10:00:00.000Z')
      const metadata = async () => (await getPublishRecord(db, 'master', record.targetId))!.metadata

      expect(await claimThumbnailSetRequest(db, record.id, start)).toBe(true)
      expect(await metadata()).toEqual({
        title: 'Kept',
        thumbnailSetRequestedAt: start.toISOString(),
      })

      const fourteen = new Date(start.getTime() + 14 * 60_000)
      expect(await claimThumbnailSetRequest(db, record.id, fourteen)).toBe(false)
      expect((await metadata())['thumbnailSetRequestedAt']).toBe(start.toISOString())

      const sixteen = new Date(start.getTime() + 16 * 60_000)
      expect(await claimThumbnailSetRequest(db, record.id, sixteen)).toBe(true)
      expect((await metadata())['thumbnailSetRequestedAt']).toBe(sixteen.toISOString())

      await clearThumbnailSetRequest(db, record.id)
      expect(await metadata()).toEqual({ title: 'Kept' })
      expect(await claimThumbnailSetRequest(db, record.id, sixteen)).toBe(true)
    })
  })

  it('a claim is refused while a package is in flight', async () => {
    await withRecord(async (record) => {
      await seedRow(record.id, 0, { state: 'painting' })

      expect(await claimThumbnailSetRequest(db, record.id, new Date())).toBe(false)
      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata['thumbnailSetRequestedAt']).toBeUndefined()

      // A package stuck for sixteen minutes no longer holds it.
      expect(
        await claimThumbnailSetRequest(db, record.id, new Date(Date.now() + 16 * 60_000)),
      ).toBe(true)
    })
  })

  it('releasing a project gives back the claim and fails what is in flight', async () => {
    await withRecord(async (record) => {
      await mergePublishMetadata(db, record.id, {
        title: 'Kept',
        thumbnailSetRequestedAt: new Date().toISOString(),
      })
      const planned = await seedRow(record.id, 0, { state: 'planned' })
      const painting = await seedRow(record.id, 1, { state: 'painting' })
      const ready = await seedRow(record.id, 2, { state: 'ready' })

      await releaseThumbnailWork(db, record.targetId, 'The project was stopped.')

      const metadata = (await getPublishRecord(db, 'master', record.targetId))!.metadata
      expect(metadata).toEqual({ title: 'Kept' })
      for (const id of [planned.id, painting.id]) {
        expect(await getThumbnailPackage(db, id)).toMatchObject({
          state: 'failed',
          error: 'The project was stopped.',
        })
      }
      expect(await getThumbnailPackage(db, ready.id)).toMatchObject({ state: 'ready', error: null })
    })
  })

  it('releasing a project that holds no claim leaves its record as it was', async () => {
    await withRecord(async (record) => {
      const before = (await getPublishRecord(db, 'master', record.targetId))!.updatedAt

      await releaseThumbnailWork(db, record.targetId, 'The project was stopped.')

      const after = (await getPublishRecord(db, 'master', record.targetId))!.updatedAt
      expect(after).toEqual(before)
    })
  })

  it('releasing a project with no publish record does not throw', async () => {
    await expect(
      releaseThumbnailWork(db, '01JZZZZZZZZZZZZZZZZZZZZZZZ', 'The project was stopped.'),
    ).resolves.toBeUndefined()
  })

  it('merges a metadata patch without replacing the rest', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ metadata: { title: 'Kept', tags: ['a'] } })
        .where(eq(publishRecords.id, record.id))

      await mergePublishMetadata(db, record.id, { thumbnailSetNote: 'Said' })

      const stored = (await getPublishRecord(db, 'master', record.targetId))!
      expect(stored.metadata).toEqual({ title: 'Kept', tags: ['a'], thumbnailSetNote: 'Said' })
    })
  })

  it("records every approved package's result and the end stamp together", async () => {
    await withRecord(async (record) => {
      const a = await seedRow(record.id, 0, { approvedAt: new Date() })
      const b = await seedRow(record.id, 1, { approvedAt: new Date() })
      const stale = await seedRow(record.id, 2, { approvedAt: new Date(), result: 'won' })
      const endedAt = new Date('2026-11-25T08:00:00Z')

      await recordTestOutcome(db, record.id, {
        results: { [a.id]: 'lost', [b.id]: 'won', [stale.id]: 'lost' },
        shares: { [a.id]: 40.5, [b.id]: 59.5, [stale.id]: null },
        endedAt,
      })

      const rows = await listThumbnailPackages(db, record.id)
      expect(rows.map((r) => [r.result, r.watchTimeShare])).toEqual([
        ['lost', 40.5],
        ['won', 59.5],
        ['lost', null],
      ])
      const [stored] = await db
        .select()
        .from(publishRecords)
        .where(eq(publishRecords.id, record.id))
      expect(stored!.testEndedAt).toEqual(endedAt)
    })
  })

  it('counts tests and wins per idea, one test per video', async () => {
    const before = await ideaResults(db, FIRST_CHANNEL_ID)
    const finishedBefore = await finishedTests(db, FIRST_CHANNEL_ID)
    const at = (rows: typeof before, idea: string) => rows.find((r) => r.idea === idea)!

    await withRecord(async (first) => {
      await withRecord(async (second) => {
        const approvedAt = new Date()
        // First video: a person won over a figure and a second person; one test per idea.
        await seedRow(first.id, 0, { approvedAt, idea: 'person', result: 'won' })
        await seedRow(first.id, 1, { approvedAt, idea: 'person', result: 'lost' })
        await seedRow(first.id, 2, { approvedAt, idea: 'figure', result: 'lost' })
        // Second video: the figure took part and lost; an unlabelled upload counts for no idea.
        await seedRow(second.id, 0, { approvedAt, idea: 'figure', result: 'lost' })
        await seedRow(second.id, 1, { approvedAt, idea: 'object', result: 'won' })
        await seedRow(second.id, 2, { approvedAt, idea: null, result: 'lost', source: 'uploaded' })

        const after = await ideaResults(db, FIRST_CHANNEL_ID)
        expect(after.map((r) => r.idea)).toEqual([
          'person',
          'figure',
          'object',
          'moment',
          'contrast',
        ])
        expect(at(after, 'person').tests - at(before, 'person').tests).toBe(1)
        expect(at(after, 'person').wins - at(before, 'person').wins).toBe(1)
        expect(at(after, 'figure').tests - at(before, 'figure').tests).toBe(2)
        expect(at(after, 'figure').wins - at(before, 'figure').wins).toBe(0)
        expect(at(after, 'object').tests - at(before, 'object').tests).toBe(1)
        expect(at(after, 'object').wins - at(before, 'object').wins).toBe(1)
        expect(at(after, 'moment')).toEqual(at(before, 'moment'))

        const finished = await finishedTests(db, FIRST_CHANNEL_ID)
        expect(finished.withWinner - finishedBefore.withWinner).toBe(2)
        expect(finished.same).toBe(finishedBefore.same)
        expect(finished.inconclusive).toBe(finishedBefore.inconclusive)
      })
    })
  })

  it('classifies a finished test as won, the same or inconclusive, once', async () => {
    const before = await finishedTests(db, FIRST_CHANNEL_ID)
    await withRecord(async (same) => {
      await withRecord(async (open) => {
        const approvedAt = new Date()
        await seedRow(same.id, 0, { approvedAt, idea: 'person', result: 'same' })
        await seedRow(same.id, 1, { approvedAt, idea: 'figure', result: 'same' })
        await seedRow(open.id, 0, { approvedAt, idea: 'person', result: 'inconclusive' })
        await seedRow(open.id, 1, { approvedAt, idea: 'figure', result: 'inconclusive' })
        // No result yet: not a finished test.
        await withRecord(async (untested) => {
          await seedRow(untested.id, 0, { approvedAt, idea: 'person' })
          const after = await finishedTests(db, FIRST_CHANNEL_ID)
          expect(after.same - before.same).toBe(1)
          expect(after.inconclusive - before.inconclusive).toBe(1)
          expect(after.withWinner).toBe(before.withWinner)
        })
      })
    })
  })
})
