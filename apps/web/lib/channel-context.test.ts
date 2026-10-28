// @vitest-environment node

import {
  archiveChannel,
  channelForProject,
  createChannel,
  ensureFirstChannel,
  getChannel,
  requireTestDatabase,
} from '@boom-busters/db'
import type * as DbModule from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_SLUG } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { channelForProjectOrNotFound, channelFromSlug, landingSlug } from './channel-context'

/**
 * The server-side channel resolvers against the test database, with the
 * request's cookie jar replaced.
 */

const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get(name: string) {
    const value = this.values.get(name)
    return value === undefined ? undefined : { name, value }
  },
}))
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(jar) }))

// Real implementations by default; a test can make one reject once to prove a
// database failure is not mistaken for "not found".
vi.mock('@boom-busters/db', async (importOriginal) => {
  const actual = await importOriginal<typeof DbModule>()
  return {
    ...actual,
    channelForProject: vi.fn(actual.channelForProject),
    getChannel: vi.fn(actual.getChannel),
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

function input(slug: string) {
  return {
    name: `Channel ${slug}`,
    handle: null,
    slug,
    settings: DEFAULT_SETTINGS,
    bible: EMPTY_BIBLE,
  }
}

describeDb('channel context', () => {
  // Slugs are unique for good, so each run takes its own rather than clearing
  // tables other suites share.
  const tag = Date.now().toString(36)
  let psy = ''
  let archived = ''

  beforeEach(async () => {
    jar.values.clear()
    psy = `psy-${tag}-${Math.random().toString(36).slice(2, 6)}`
    archived = `old-${tag}-${Math.random().toString(36).slice(2, 6)}`
    await ensureFirstChannel(db)
    await createChannel(db, input(psy))
    const old = await createChannel(db, input(archived))
    await archiveChannel(db, old.id)
  })

  it('channelFromSlug returns the channel and raises the Next not-found error on a miss', async () => {
    expect((await channelFromSlug(psy)).slug).toBe(psy)

    const error = await channelFromSlug('missing').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as { digest?: string }).digest).toMatch(
      /^NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
    )
  })

  it('channelForProjectOrNotFound raises not-found for a missing project and rethrows any other failure', async () => {
    const missing = await channelForProjectOrNotFound('01BB0000000000000000000009').catch(
      (e: unknown) => e,
    )
    expect((missing as { digest?: string }).digest).toMatch(
      /^NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
    )

    const outage = new Error('connection terminated')
    vi.mocked(channelForProject).mockRejectedValueOnce(outage)
    await expect(channelForProjectOrNotFound('01BB0000000000000000000009')).rejects.toBe(outage)
  })

  it('landingSlug rethrows a database failure instead of falling through to the write path', async () => {
    const outage = new Error('connection terminated')
    vi.mocked(getChannel).mockRejectedValueOnce(outage)
    await expect(landingSlug()).rejects.toBe(outage)
  })

  it('landingSlug returns the cookie slug when it names a live channel', async () => {
    jar.values.set('bb-last-channel', psy)
    expect(await landingSlug()).toBe(psy)
  })

  it('landingSlug falls back to the default channel for an archived, unknown or absent cookie', async () => {
    for (const value of [archived, 'nope']) {
      jar.values.set('bb-last-channel', value)
      expect(await landingSlug()).toBe(FIRST_CHANNEL_SLUG)
    }
    jar.values.clear()
    expect(await landingSlug()).toBe(FIRST_CHANNEL_SLUG)
  })
})
