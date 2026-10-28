// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signOauthState } from '@/lib/youtube-state'
import { GET } from './route'

/**
 * The OAuth callback: the signed state plus the nonce cookie are the CSRF
 * lock and name the channel, a declined consent is not an error, and the
 * refresh token only lands encrypted on that channel's connection.
 */

const KEY = 'a'.repeat(44)
const CHANNEL_ID = '01J00000000000000000000001'
const NONCE = 'the-nonce'

const session = vi.hoisted(() => ({ value: null as { user: { email: string } } | null }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve(session.value) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/env', () => ({ env: { SECRETS_ENCRYPTION_KEY: 'a'.repeat(44) } }))

const store = vi.hoisted(() => ({
  getChannel: vi.fn(),
  channelYoutubeConnection: vi.fn(),
  saveChannelYoutubeConnection: vi.fn(),
  recordChannelYoutubeVerify: vi.fn(),
}))
vi.mock('@boom-busters/db', () => store)

const google = vi.hoisted(() => ({
  exchangeCode: vi.fn(),
  pingChannel: vi.fn(),
}))
vi.mock('@/lib/youtube', () => ({
  exchangeCode: google.exchangeCode,
  pingChannel: google.pingChannel,
  youtubeAuthUrl: vi.fn(),
  youtubeConfigured: () => true,
  YoutubeAuthError: class extends Error {},
}))

const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get(name: string) {
    const value = this.values.get(name)
    return value === undefined ? undefined : { name, value }
  },
  set(name: string, value: string) {
    this.values.set(name, value)
  },
  delete(name: string) {
    this.values.delete(name)
  },
}))
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(jar) }))

function request(params: Record<string, string>): Request {
  const url = new URL('http://localhost:3000/api/youtube/callback')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return new Request(url)
}

function goodState(): string {
  return signOauthState(CHANNEL_ID, NONCE, KEY)
}

function redirectedTo(response: Response): string {
  expect(response.status).toBe(302)
  return response.headers.get('location') ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { email: 'owner@example.com' } }
  jar.values.clear()
  jar.values.set('bb-youtube-oauth-state', NONCE)
  store.getChannel.mockResolvedValue({ id: CHANNEL_ID, slug: 'second', archivedAt: null })
  store.channelYoutubeConnection.mockResolvedValue(undefined)
  google.exchangeCode.mockResolvedValue({
    accessToken: 'ya29.access',
    refreshToken: '1//refresh',
    expiresInSec: 3599,
  })
  google.pingChannel.mockResolvedValue({
    ok: true,
    channelId: 'UC-second',
    channelTitle: 'Second Channel',
  })
})

function expectNothingWritten(): void {
  expect(store.saveChannelYoutubeConnection).not.toHaveBeenCalled()
  expect(store.recordChannelYoutubeVerify).not.toHaveBeenCalled()
  expect(google.exchangeCode).not.toHaveBeenCalled()
}

describe('GET /api/youtube/callback', () => {
  it('requires a session', async () => {
    session.value = null
    const response = await GET(request({ code: 'x', state: goodState() }))
    expect(response.status).toBe(401)
  })

  it('a declined consent screen goes back to the channel without touching anything', async () => {
    const response = await GET(request({ error: 'access_denied', state: goodState() }))
    expect(redirectedTo(response)).toContain('/c/second/settings?tab=connections&youtube=declined')
    expectNothingWritten()
    expect(jar.values.has('bb-youtube-oauth-state')).toBe(false)
  })

  it('refuses a forged state', async () => {
    const response = await GET(request({ code: 'x', state: 'attacker-state' }))
    expect(redirectedTo(response)).toContain('youtube=state-mismatch')
    expectNothingWritten()
  })

  it('refuses a state with a swapped channel id', async () => {
    const parts = Buffer.from(goodState(), 'base64url').toString('utf8').split('.')
    parts[0] = '01J00000000000000000000002'
    const forged = Buffer.from(parts.join('.'), 'utf8').toString('base64url')
    const response = await GET(request({ code: 'x', state: forged }))
    expect(redirectedTo(response)).toContain('youtube=state-mismatch')
    expectNothingWritten()
  })

  it('a missing nonce cookie is a state mismatch and writes nothing', async () => {
    jar.values.clear()
    const response = await GET(request({ code: 'x', state: goodState() }))
    expect(redirectedTo(response)).toContain('youtube=state-mismatch')
    expectNothingWritten()
  })

  it('a nonce that does not match the cookie is a state mismatch', async () => {
    jar.values.set('bb-youtube-oauth-state', 'some-other-nonce')
    const response = await GET(request({ code: 'x', state: goodState() }))
    expect(redirectedTo(response)).toContain('youtube=state-mismatch')
    expectNothingWritten()
    expect(jar.values.has('bb-youtube-oauth-state')).toBe(false)
  })

  it('a state for an unknown channel is a state mismatch', async () => {
    store.getChannel.mockRejectedValue(new Error('no such channel'))
    const response = await GET(request({ code: 'x', state: goodState() }))
    expect(redirectedTo(response)).toContain('youtube=state-mismatch')
    expectNothingWritten()
  })

  it('a state for an archived channel is a state mismatch', async () => {
    store.getChannel.mockResolvedValue({ id: CHANNEL_ID, slug: 'second', archivedAt: new Date() })
    const response = await GET(request({ code: 'x', state: goodState() }))
    expect(redirectedTo(response)).toContain('youtube=state-mismatch')
    expectNothingWritten()
  })

  it("stores the grant on the state's channel and sends the browser to its Connections tab", async () => {
    const response = await GET(request({ code: '4/the-code', state: goodState() }))

    expect(redirectedTo(response)).toBe(
      'http://localhost:3000/c/second/settings?tab=connections&youtube=connected',
    )
    expect(store.saveChannelYoutubeConnection).toHaveBeenCalledWith({}, CHANNEL_ID, {
      refreshToken: '1//refresh',
      encryptionKey: KEY,
      youtubeChannelId: 'UC-second',
      youtubeChannelTitle: 'Second Channel',
    })
    expect(store.recordChannelYoutubeVerify).toHaveBeenCalledWith({}, CHANNEL_ID, 'ok', 'UC-second')
    // One-shot state: the cookie is gone whatever happened.
    expect(jar.values.has('bb-youtube-oauth-state')).toBe(false)
  })

  it('a reconnect to the same YouTube channel stores what the ping returned', async () => {
    store.channelYoutubeConnection.mockResolvedValue({
      youtubeChannelId: 'UC-second',
      youtubeChannelTitle: 'Old title',
    })
    const response = await GET(request({ code: '4/x', state: goodState() }))
    expect(redirectedTo(response)).toContain('youtube=connected')
    expect(store.saveChannelYoutubeConnection).toHaveBeenCalledWith(
      {},
      CHANNEL_ID,
      expect.objectContaining({
        youtubeChannelId: 'UC-second',
        youtubeChannelTitle: 'Second Channel',
      }),
    )
  })

  it('a ping that returns a different YouTube channel keeps the stored id and records invalid', async () => {
    store.channelYoutubeConnection.mockResolvedValue({
      youtubeChannelId: 'UC-original',
      youtubeChannelTitle: 'Original',
    })
    const response = await GET(request({ code: '4/x', state: goodState() }))

    expect(redirectedTo(response)).toContain('youtube=channel-changed')
    // The stored id is not replaced by the new account's id...
    expect(store.saveChannelYoutubeConnection).toHaveBeenCalledWith(
      {},
      CHANNEL_ID,
      expect.objectContaining({ youtubeChannelId: 'UC-original' }),
    )
    // ...and the verify sees the mismatch, which the store writes as invalid.
    expect(store.recordChannelYoutubeVerify).toHaveBeenCalledWith({}, CHANNEL_ID, 'ok', 'UC-second')
  })

  it('a grant with no refresh token stores nothing and says so', async () => {
    google.exchangeCode.mockResolvedValue({ accessToken: 'ya29.only', expiresInSec: 3599 })
    const response = await GET(request({ code: '4/x', state: goodState() }))
    expect(redirectedTo(response)).toContain('youtube=no-refresh-token')
    expect(store.saveChannelYoutubeConnection).not.toHaveBeenCalled()
  })

  it('a failed channel ping stores the token but stamps invalid', async () => {
    google.pingChannel.mockResolvedValue({ ok: false, error: 'no channel' })
    const response = await GET(request({ code: '4/x', state: goodState() }))
    expect(redirectedTo(response)).toContain('youtube=no-channel')
    expect(store.saveChannelYoutubeConnection).toHaveBeenCalled()
    expect(store.recordChannelYoutubeVerify).toHaveBeenCalledWith(
      {},
      CHANNEL_ID,
      'invalid',
      undefined,
    )
  })
})
