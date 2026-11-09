// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  listBibleVersions,
  requireTestDatabase,
  saveBibleVersion,
  seed,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, defaultFormat } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { addTermToKeywordsAction } from './search-report-actions'

/** The search report card's Add to keywords button, against the test database. */

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { email: 'owner@example.com' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('addTermToKeywordsAction', () => {
  let channelId = ''
  let projectId = ''

  beforeEach(async () => {
    await seed(db)
    const channel = await createChannel(db, {
      name: 'Keywords',
      handle: null,
      slug: `kw-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: { ...EMPTY_BIBLE, language: 'en', formats: [defaultFormat('Main')] },
    })
    channelId = channel.id
    const kase = await createCase(db, { title: 'Enron', category: 'collapse', channelId })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Enron' })).id
  })

  it('adds the trimmed term to the project format and says so', async () => {
    const result = await addTermToKeywordsAction(projectId, '  enron collapse  ')
    expect(result).toEqual({ ok: true, message: 'Added to the Main keywords.' })
    const versions = await listBibleVersions(db, channelId)
    expect(versions.at(-1)!.bible.formats[0]!.keywords).toEqual(['enron collapse'])
    expect(await addTermToKeywordsAction(projectId, 'Collapse Enron')).toEqual({
      ok: true,
      message: 'Already a keyword.',
    })
  })

  it('refuses an empty term and an unknown project', async () => {
    expect(await addTermToKeywordsAction(projectId, '   ')).toMatchObject({ ok: false })
    expect(await addTermToKeywordsAction('01J0000000000000000000ZZZZ', 'enron')).toEqual({
      ok: false,
      error: 'Unknown project',
    })
  })

  it('refuses to add a seventh keyword with a plain message', async () => {
    const { bible } = (await listBibleVersions(db, channelId)).at(-1)!
    await saveBibleVersion(
      db,
      channelId,
      {
        ...bible,
        formats: [{ ...bible.formats[0]!, keywords: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] }],
      },
      'Six keywords',
    )
    const result = await addTermToKeywordsAction(projectId, 'seventh term')
    expect(result).toEqual({
      ok: false,
      error: 'This format has 6 keywords already. Remove one in Settings first.',
    })
    expect(await listBibleVersions(db, channelId)).toHaveLength(2)
  })
})
