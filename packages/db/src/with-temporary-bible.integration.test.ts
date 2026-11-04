import {
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
} from '@boom-busters/schemas'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { currentBible, listBibleVersions, saveBibleVersion } from './bibles'
import { createCase } from './cases'
import { createChannel } from './channels'
import { createDb } from './client'
import { eq } from 'drizzle-orm'
import { createProjectFromCase, moveProjectBible } from './projects'
import { projects } from './schema'
import { seed } from './seed'
import { requireTestDatabase } from './test-database'
import { withTemporaryBible } from './with-temporary-bible'

/**
 * The test helper that swaps a channel's bible and puts it back, against a
 * real database: the pointer, the projects and the version numbering are what
 * the suites after it depend on.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('withTemporaryBible', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeAll(async () => {
    await seed(db)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('restores the current bible, the project it moved and the version count', async () => {
    const channel = await createChannel(db, {
      name: 'Temporary bible channel',
      handle: null,
      slug: `temp-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    const kase = await createCase(db, { channelId: channel.id, title: 'T', category: 'con' })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'On T' })
    const original = await currentBible(db, channel.id)
    const countBefore = (await listBibleVersions(db, channel.id)).length

    const seen = await withTemporaryBible(
      db,
      channel.id,
      { ...EMPTY_BIBLE, disclaimer: 'Only for the test.' },
      async () => {
        const inside = await currentBible(db, channel.id)
        await saveBibleVersion(db, channel.id, EMPTY_BIBLE, 'Saved by the code under test')
        await moveProjectBible(db, project.id, inside.id)
        return inside.bible.disclaimer
      },
    )

    expect(seen).toBe('Only for the test.')
    expect((await currentBible(db, channel.id)).id).toBe(original.id)
    const [row] = await db
      .select({ bibleId: projects.bibleId })
      .from(projects)
      .where(eq(projects.id, project.id))
    expect(row?.bibleId).toBe(original.id)
    const versions = await listBibleVersions(db, channel.id)
    expect(versions).toHaveLength(countBefore)
    expect(versions.at(-1)!.version).toBe(versions.length)
  })

  it('restores after fn throws, and rethrows', async () => {
    const original = await currentBible(db, FIRST_CHANNEL_ID)
    const countBefore = (await listBibleVersions(db, FIRST_CHANNEL_ID)).length
    await expect(
      withTemporaryBible(db, FIRST_CHANNEL_ID, { ...FIRST_CHANNEL_BIBLE, disclaimer: 'x' }, () =>
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom')
    expect((await currentBible(db, FIRST_CHANNEL_ID)).id).toBe(original.id)
    expect(await listBibleVersions(db, FIRST_CHANNEL_ID)).toHaveLength(countBefore)
  })
})
