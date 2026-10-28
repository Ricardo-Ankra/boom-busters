// @vitest-environment node

import {
  archiveChannel,
  channelYoutubeConnection,
  createChannel,
  recordChannelYoutubeVerify,
  requireTestDatabase,
  saveChannelYoutubeConnection,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { disconnectYoutubeAction, verifyYoutubeConnection } from './actions'

/**
 * Disconnect deletes only that channel's connection; a Google failure that is
 * passing (5xx, 429) leaves the connection's standing alone while an auth
 * failure still marks it invalid.
 */

const KEY = Buffer.alloc(32, 7).toString('base64')
vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/env', () => ({
  env: { SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
}))
const google = vi.hoisted(() => ({ pingChannel: vi.fn(), refreshAccessToken: vi.fn() }))
vi.mock('@/lib/youtube', () => ({
  pingChannel: google.pingChannel,
  refreshAccessToken: google.refreshAccessToken,
  youtubeConfigured: () => true,
  YoutubeAuthError: class extends Error {
    needsReconnect = true
  },
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

async function connected(slug: string, youtubeChannelId: string) {
  const channel = await createChannel(db, {
    name: slug,
    handle: null,
    slug: `${slug}-${Math.random().toString(36).slice(2, 9)}`,
    settings: DEFAULT_SETTINGS,
    bible: EMPTY_BIBLE,
  })
  await saveChannelYoutubeConnection(db, channel.id, {
    refreshToken: 'refresh-token',
    encryptionKey: KEY,
    youtubeChannelId: `${youtubeChannelId}-${channel.id}`,
    youtubeChannelTitle: null,
  })
  await recordChannelYoutubeVerify(db, channel.id, 'ok')
  return channel
}

describeDb('YouTube card actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    google.refreshAccessToken.mockResolvedValue({ accessToken: 'ya29.x' })
  })

  it('disconnect deletes only that channel row', async () => {
    const a = await connected('disc-a', 'UC-a')
    const b = await connected('disc-b', 'UC-b')
    expect(await disconnectYoutubeAction(a.id)).toEqual({ ok: true })
    expect(await channelYoutubeConnection(db, a.id)).toBeUndefined()
    expect(await channelYoutubeConnection(db, b.id)).toBeDefined()
  })

  it('disconnect refuses a malformed id and an unknown channel', async () => {
    expect(await disconnectYoutubeAction('nope')).toEqual({ ok: false, error: 'Unknown channel' })
    expect(await disconnectYoutubeAction('01BB0000000000000000000077')).toEqual({
      ok: false,
      error: 'Unknown channel',
    })
  })

  it('disconnect refuses an archived channel and keeps its row', async () => {
    const a = await connected('disc-arch', 'UC-arch')
    await archiveChannel(db, a.id)
    expect(await disconnectYoutubeAction(a.id)).toEqual({
      ok: false,
      error: 'This channel is archived',
    })
    expect(await channelYoutubeConnection(db, a.id)).toBeDefined()
  })

  it('a 503 ping leaves an ok connection ok', async () => {
    const a = await connected('verify-503', 'UC-503')
    google.pingChannel.mockResolvedValue({ ok: false, error: 'Backend Error', retriable: true })
    const result = await verifyYoutubeConnection(a.id)
    expect(result.ok).toBe(false)
    expect((await channelYoutubeConnection(db, a.id))?.verifyStatus).toBe('ok')
  })

  it('a 401 ping still marks the connection invalid', async () => {
    const a = await connected('verify-401', 'UC-401')
    google.pingChannel.mockResolvedValue({ ok: false, error: 'Invalid Credentials' })
    const result = await verifyYoutubeConnection(a.id)
    expect(result.ok).toBe(false)
    expect((await channelYoutubeConnection(db, a.id))?.verifyStatus).toBe('invalid')
  })
})
