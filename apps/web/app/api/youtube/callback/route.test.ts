// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

/**
 * The OAuth callback: the state cookie is the CSRF lock, a declined consent
 * is not an error, and the refresh token only lands encrypted — the
 * credential write and the verified stamp travel together.
 */

const session = vi.hoisted(() => ({ value: null as { user: { email: string } } | null }))
vi.mock('@/auth', () => ({ auth: () => Promise.resolve(session.value) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/env', () => ({ env: { SECRETS_ENCRYPTION_KEY: 'a'.repeat(44) } }))

const store = vi.hoisted(() => ({
  setCredential: vi.fn(),
  recordVerifyResult: vi.fn(),
}))
vi.mock('@boom-busters/db', () => ({
  setCredential: store.setCredential,
  recordVerifyResult: store.recordVerifyResult,
}))

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

function redirectedTo(response: Response): string {
  expect(response.status).toBe(302)
  return response.headers.get('location') ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { email: 'owner@example.com' } }
  jar.values.clear()
  jar.values.set('bb-youtube-oauth-state', 'expected-state')
  google.exchangeCode.mockResolvedValue({
    accessToken: 'ya29.access',
    refreshToken: '1//refresh',
    expiresInSec: 3599,
  })
  google.pingChannel.mockResolvedValue({ ok: true, channelTitle: 'Boom & Busters' })
})

describe('GET /api/youtube/callback', () => {
  it('requires a session', async () => {
    session.value = null
    const response = await GET(request({ code: 'x', state: 'expected-state' }))
    expect(response.status).toBe(401)
  })

  it('a declined consent screen goes back without touching anything', async () => {
    const response = await GET(request({ error: 'access_denied' }))
    expect(redirectedTo(response)).toContain('youtube=declined')
    expect(google.exchangeCode).not.toHaveBeenCalled()
    expect(store.setCredential).not.toHaveBeenCalled()
  })

  it('refuses a forged state — the cookie is the lock', async () => {
    const response = await GET(request({ code: 'x', state: 'attacker-state' }))
    expect(redirectedTo(response)).toContain('youtube=state-mismatch')
    expect(google.exchangeCode).not.toHaveBeenCalled()
  })

  it('stores the refresh token encrypted and stamps the ping verdict', async () => {
    const response = await GET(request({ code: '4/the-code', state: 'expected-state' }))

    expect(redirectedTo(response)).toContain('youtube=connected')
    expect(store.setCredential).toHaveBeenCalledWith({}, 'youtube', '1//refresh', 'a'.repeat(44))
    expect(store.recordVerifyResult).toHaveBeenCalledWith({}, 'youtube', 'ok')
    // One-shot state: the cookie is gone whatever happened.
    expect(jar.values.has('bb-youtube-oauth-state')).toBe(false)
  })

  it('a grant with no refresh token stores nothing and says so', async () => {
    google.exchangeCode.mockResolvedValue({ accessToken: 'ya29.only', expiresInSec: 3599 })
    const response = await GET(request({ code: '4/x', state: 'expected-state' }))
    expect(redirectedTo(response)).toContain('youtube=no-refresh-token')
    expect(store.setCredential).not.toHaveBeenCalled()
  })

  it('a failed channel ping stores the token but stamps invalid', async () => {
    google.pingChannel.mockResolvedValue({ ok: false, error: 'no channel' })
    const response = await GET(request({ code: '4/x', state: 'expected-state' }))
    expect(redirectedTo(response)).toContain('youtube=no-channel')
    expect(store.setCredential).toHaveBeenCalled()
    expect(store.recordVerifyResult).toHaveBeenCalledWith({}, 'youtube', 'invalid')
  })
})
