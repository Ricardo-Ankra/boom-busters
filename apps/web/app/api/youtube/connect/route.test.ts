// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'

/** The Connect button's destination: an archived channel is read-only, so no OAuth starts. */

vi.mock('@/auth', () => ({ auth: () => Promise.resolve({ user: { email: 'owner@example.com' } }) }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/env', () => ({ env: { SECRETS_ENCRYPTION_KEY: 'a'.repeat(44) } }))
const store = vi.hoisted(() => ({ getChannel: vi.fn() }))
vi.mock('@boom-busters/db', () => store)
const jar = vi.hoisted(() => ({ set: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(jar) }))
const authUrl = vi.hoisted(() => vi.fn(() => 'https://accounts.google.com/o/oauth2/auth'))
vi.mock('@/lib/youtube', () => ({ youtubeAuthUrl: authUrl, youtubeConfigured: () => true }))

const request = (id: string) =>
  new Request(`http://localhost:3000/api/youtube/connect?channel=${id}`)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/youtube/connect', () => {
  it('sends an archived channel back to its Connections tab with an archived outcome', async () => {
    store.getChannel.mockResolvedValue({ id: 'c1', slug: 'old', archivedAt: new Date() })

    const response = await GET(request('c1'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(
      'http://localhost:3000/c/old/settings?tab=connections&youtube=archived',
    )
    expect(authUrl).not.toHaveBeenCalled()
    expect(jar.set).not.toHaveBeenCalled()
  })

  it('starts the OAuth dance for a live channel', async () => {
    store.getChannel.mockResolvedValue({ id: 'c1', slug: 'live', archivedAt: null })

    const response = await GET(request('c1'))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('accounts.google.com')
    expect(jar.set).toHaveBeenCalled()
  })
})
