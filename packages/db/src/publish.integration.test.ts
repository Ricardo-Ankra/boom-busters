import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { FIXTURE_PROJECT_ID, fixtureCase, fixtureProject } from './fixtures'
import {
  beginUpload,
  countUploadsSince,
  ensurePublishRecord,
  getPublishRecord,
  listPublishRecords,
  scheduledPublishItems,
} from './publish'
import { cases, projects, publishRecords, shorts } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * The double-upload guard against a real database: one record per target
 * (unique index), one winner per draft (atomic UPDATE), and the budget
 * counts upload STARTS whatever became of them.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('publish bookkeeping', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${cases} restart identity cascade`)
    await db.execute(dsql`truncate table ${publishRecords} restart identity cascade`)
    await db.insert(cases).values(fixtureCase)
    await db.insert(projects).values(fixtureProject)
  })

  afterAll(async () => {
    await sql.end()
  })

  it('one record per target — the unique index refuses a second', async () => {
    await db.insert(publishRecords).values({ targetType: 'master', targetId: FIXTURE_PROJECT_ID })
    // Drizzle wraps the pg error, so assert the behaviour: it rejects, and
    // exactly one master record exists afterwards.
    await expect(
      db.insert(publishRecords).values({ targetType: 'master', targetId: FIXTURE_PROJECT_ID }),
    ).rejects.toThrow()
    const rows = await db.select().from(publishRecords)
    expect(rows.filter((row) => row.targetType === 'master')).toHaveLength(1)
    // The same project as a SHORT target is a different thing and fine.
    await db.insert(publishRecords).values({ targetType: 'short', targetId: FIXTURE_PROJECT_ID })
  })

  it('beginUpload claims a draft exactly once and stamps the start', async () => {
    const [record] = await db
      .insert(publishRecords)
      .values({ targetType: 'master', targetId: FIXTURE_PROJECT_ID })
      .returning()

    const first = await beginUpload(db, record!.id)
    expect(first?.status).toBe('uploading')
    expect(first?.uploadStartedAt).not.toBeNull()

    // The double-fire: the row is no longer 'draft', so nothing is claimed.
    const second = await beginUpload(db, record!.id)
    expect(second).toBeUndefined()

    const stored = await getPublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    expect(stored?.status).toBe('uploading')
  })

  it('ensurePublishRecord makes a draft once and hands it back thereafter', async () => {
    const first = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    expect(first.status).toBe('draft')

    const second = await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    expect(second.id).toBe(first.id)

    const rows = await db.select().from(publishRecords)
    expect(rows).toHaveLength(1)
  })

  it('listPublishRecords reads the master and the named Shorts in one go', async () => {
    await ensurePublishRecord(db, 'master', FIXTURE_PROJECT_ID)
    await ensurePublishRecord(db, 'short', '01HQ00000000000000000000S1')
    await ensurePublishRecord(db, 'short', '01HQ00000000000000000000S2')
    // A Short this project does not own is never returned.
    await ensurePublishRecord(db, 'short', '01HQ00000000000000000000S9')

    const rows = await listPublishRecords(db, {
      projectId: FIXTURE_PROJECT_ID,
      shortIds: ['01HQ00000000000000000000S1', '01HQ00000000000000000000S2'],
    })
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.targetType).sort()).toEqual(['master', 'short', 'short'])

    const masterOnly = await listPublishRecords(db, {
      projectId: FIXTURE_PROJECT_ID,
      shortIds: [],
    })
    expect(masterOnly).toHaveLength(1)
  })

  it('scheduledPublishItems joins every slotted target back to its project', async () => {
    await db.insert(publishRecords).values({
      targetType: 'master',
      targetId: FIXTURE_PROJECT_ID,
      status: 'scheduled',
      publishAt: new Date('2026-08-28T15:00:00Z'),
    })

    const segmentRef = { chapterId: '01HQ00000000000000000000C1', fromParagraph: 0, toParagraph: 1 }
    const [slotted] = await db
      .insert(shorts)
      .values({ projectId: FIXTURE_PROJECT_ID, title: 'The nine-day collapse', segmentRef })
      .returning()
    await db.insert(publishRecords).values({
      targetType: 'short',
      targetId: slotted!.id,
      status: 'live',
      publishAt: new Date('2026-08-26T10:00:00Z'),
    })

    // A draft never slotted stays off the calendar.
    const [draftShort] = await db
      .insert(shorts)
      .values({ projectId: FIXTURE_PROJECT_ID, title: 'Unslotted', segmentRef })
      .returning()
    await ensurePublishRecord(db, 'short', draftShort!.id)

    const items = await scheduledPublishItems(db)
    // Sorted by publish time; the Short's label is its card title, the
    // master's is the project's, and both carry the project for the deep link.
    expect(items.map((item) => item.label)).toEqual(['The nine-day collapse', fixtureProject.title])
    expect(items.map((item) => item.projectId)).toEqual([FIXTURE_PROJECT_ID, FIXTURE_PROJECT_ID])
    expect(items[0]).toMatchObject({ targetType: 'short', status: 'live' })
    expect(items[1]).toMatchObject({ targetType: 'master', status: 'scheduled' })
  })

  it('countUploadsSince counts starts in the window, failures included', async () => {
    const now = new Date('2026-08-22T18:00:00Z')
    const dayStart = new Date('2026-08-22T07:00:00Z')

    const values = [
      // Started today, later failed — still spent its quota units.
      {
        targetId: '01HQ00000000000000000000T1',
        status: 'failed' as const,
        at: '2026-08-22T09:00:00Z',
      },
      {
        targetId: '01HQ00000000000000000000T2',
        status: 'scheduled' as const,
        at: '2026-08-22T12:00:00Z',
      },
      // Started YESTERDAY in quota terms.
      {
        targetId: '01HQ00000000000000000000T3',
        status: 'scheduled' as const,
        at: '2026-08-22T05:00:00Z',
      },
      // Never started.
      { targetId: '01HQ00000000000000000000T4', status: 'draft' as const, at: null },
    ]
    for (const value of values) {
      await db.insert(publishRecords).values({
        targetType: 'short',
        targetId: value.targetId,
        status: value.status,
        uploadStartedAt: value.at === null ? null : new Date(value.at),
      })
    }

    expect(await countUploadsSince(db, dayStart)).toBe(2)
    expect(now.getTime()).toBeGreaterThan(dayStart.getTime())
  })
})
