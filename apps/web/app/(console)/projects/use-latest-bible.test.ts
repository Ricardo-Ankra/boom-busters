// @vitest-environment node

import {
  channelForProject,
  createCase,
  createChannel,
  createProjectFromCase,
  currentBible,
  requireTestDatabase,
  saveBibleVersion,
  seed,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { moveToLatestBibleAction } from './actions'

/**
 * Moving a project onto its channel's latest bible, against the test database.
 * The action refuses a latest that is incomplete and a version already in use.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/inngest/client', () => ({ inngest: { send: vi.fn() } }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('moveToLatestBibleAction', () => {
  let channelId = ''
  let projectId = ''

  beforeEach(async () => {
    await seed(db)
    const channel = await createChannel(db, {
      name: 'Latest bible channel',
      handle: null,
      slug: `latest-${Math.random().toString(36).slice(2, 8)}`,
      settings: DEFAULT_SETTINGS,
      bible: FIRST_CHANNEL_BIBLE,
    })
    channelId = channel.id
    const kase = await createCase(db, { channelId, title: 'L', category: 'collapse' })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'On latest' })).id
  })

  it('moves the project to a complete newer version', async () => {
    const v2 = await saveBibleVersion(db, channelId, { ...FIRST_CHANNEL_BIBLE, subject: 'x' }, 'e')

    expect(await moveToLatestBibleAction(projectId)).toEqual({ ok: true })
    expect((await channelForProject(db, projectId)).bibleId).toBe(v2.id)
  })

  it('refuses an incomplete latest version and leaves the project where it was', async () => {
    const v1 = await currentBible(db, channelId)
    await saveBibleVersion(db, channelId, EMPTY_BIBLE, 'half written')

    expect(await moveToLatestBibleAction(projectId)).toEqual({
      ok: false,
      error: 'The latest bible is incomplete. Complete it in the Bible tab first.',
    })
    expect((await channelForProject(db, projectId)).bibleId).toBe(v1.id)
  })

  it('refuses a second press on the same version', async () => {
    await saveBibleVersion(db, channelId, { ...FIRST_CHANNEL_BIBLE, subject: 'x' }, 'e')
    expect(await moveToLatestBibleAction(projectId)).toEqual({ ok: true })

    expect(await moveToLatestBibleAction(projectId)).toEqual({
      ok: false,
      error: 'This project already uses the latest bible',
    })
  })
})
