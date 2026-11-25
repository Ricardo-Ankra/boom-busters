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
  approvedDepicts,
  ensureUploadedPackages,
  getThumbnailPackage,
  listThumbnailPackages,
  makeDefaultPackage,
  recordTestOutcome,
  recordsAwaitingTestReminder,
  removeThumbnailPackage,
  replaceUnapprovedGenerated,
  swapApprovedKey,
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

  it('swaps an approved key in place and ignores an unknown one', async () => {
    await withRecord(async (record) => {
      await db
        .update(publishRecords)
        .set({ uploadedThumbKeys: ['a.jpg', 'b.jpg', 'c.jpg'] })
        .where(eq(publishRecords.id, record.id))

      await swapApprovedKey(db, record.id, 'b.jpg', 'b2.jpg')
      expect(await storedKeys(record.id)).toEqual(['a.jpg', 'b2.jpg', 'c.jpg'])

      await swapApprovedKey(db, record.id, 'missing.jpg', 'x.jpg')
      expect(await storedKeys(record.id)).toEqual(['a.jpg', 'b2.jpg', 'c.jpg'])
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
      await syncApprovedToRecord(db, record.id)

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
})
