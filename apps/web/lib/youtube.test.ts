// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  exchangeCode,
  movePublishAt,
  pingChannel,
  refreshAccessToken,
  YOUTUBE_SCOPES,
  YoutubeAuthError,
  youtubeAuthUrl,
  youtubeRedirectUri,
} from './youtube'

/**
 * The OAuth client against a mocked Google. What matters: the scopes are
 * EXACTLY the three the spec names (section 9), the consent parameters
 * guarantee a refresh token, and `invalid_grant` — the one failure a retry
 * cannot fix — is distinguished from everything else.
 */

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('YOUTUBE_CLIENT_ID', 'client-id.apps.googleusercontent.com')
  vi.stubEnv('YOUTUBE_CLIENT_SECRET', 'client-secret')
  vi.stubEnv('AUTH_URL', 'https://boom-busters.example.com')
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('youtubeAuthUrl', () => {
  it('asks for exactly the three spec scopes, offline, with forced consent', () => {
    const url = new URL(youtubeAuthUrl('state-123'))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...YOUTUBE_SCOPES])
    expect(YOUTUBE_SCOPES).toHaveLength(3)
    // Together these guarantee the refresh token comes back — Google omits
    // it on a repeat consent otherwise.
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('state')).toBe('state-123')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://boom-busters.example.com/api/youtube/callback',
    )
  })

  it('the redirect URI follows AUTH_URL, trailing slash tolerated', () => {
    vi.stubEnv('AUTH_URL', 'https://app.example.com/')
    expect(youtubeRedirectUri()).toBe('https://app.example.com/api/youtube/callback')
  })
})

describe('exchangeCode', () => {
  it('posts the code and returns the full grant', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        access_token: 'ya29.access',
        refresh_token: '1//refresh',
        expires_in: 3599,
      }),
    )

    const grant = await exchangeCode('4/the-code')

    expect(grant).toEqual({
      accessToken: 'ya29.access',
      refreshToken: '1//refresh',
      expiresInSec: 3599,
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('4/the-code')
    expect(body.get('client_secret')).toBe('client-secret')
  })
})

describe('refreshAccessToken', () => {
  it('returns a short-lived access token without a refresh token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { access_token: 'ya29.fresh', expires_in: 3600 }))

    const grant = await refreshAccessToken('1//refresh')
    expect(grant.accessToken).toBe('ya29.fresh')
    expect(grant.refreshToken).toBeUndefined()
  })

  it('marks invalid_grant as needing reconnection — a retry cannot fix it', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'invalid_grant', error_description: 'Token has been revoked.' }),
    )

    const failure = await refreshAccessToken('1//dead').catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(YoutubeAuthError)
    expect((failure as YoutubeAuthError).needsReconnect).toBe(true)
    expect((failure as YoutubeAuthError).message).toContain('invalid_grant')
  })

  it('any other failure is retriable, not a reconnect demand', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'internal_failure' }))

    const failure = await refreshAccessToken('1//refresh').catch((error: unknown) => error)
    expect((failure as YoutubeAuthError).needsReconnect).toBe(false)
  })
})

describe('pingChannel', () => {
  it('answers with the channel title on success', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { items: [{ snippet: { title: 'Boom & Busters' } }] }),
    )

    expect(await pingChannel('ya29.access')).toEqual({
      ok: true,
      channelTitle: 'Boom & Busters',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('part=snippet')
    expect(url).toContain('mine=true')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer ya29.access')
  })

  it('a Google account with no channel is a stated failure, not a crash', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { items: [] }))
    const ping = await pingChannel('ya29.access')
    expect(ping.ok).toBe(false)
    expect(ping.error).toContain('no YouTube channel')
  })

  it('surfaces the API error message on a refused ping', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: { message: 'Access Not Configured.' } }))
    const ping = await pingChannel('ya29.access')
    expect(ping).toEqual({ ok: false, error: 'Access Not Configured.' })
  })
})

describe('movePublishAt', () => {
  const CURRENT_STATUS = {
    privacyStatus: 'private',
    publishAt: '2026-09-04T15:00:00.000Z',
    selfDeclaredMadeForKids: false,
    embeddable: true,
    license: 'youtube',
  }

  it('reads the whole status first and writes it back with only the moment changed', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { items: [{ status: CURRENT_STATUS }] }))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'vid-1' }))

    const moved = await movePublishAt('ya29.access', 'vid-1', '2026-09-11T15:00:00.000Z')

    expect(moved).toEqual({ ok: true })
    const [readUrl] = fetchMock.mock.calls[0] as [string]
    expect(readUrl).toContain('part=status')
    expect(readUrl).toContain('id=vid-1')

    const [writeUrl, writeInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(writeUrl).toContain('part=status')
    expect(writeInit.method).toBe('PUT')
    // The read-back status travels whole: a bare {publishAt} would reset
    // embeddability, licence and the made-for-kids declaration to defaults.
    expect(JSON.parse(writeInit.body as string)).toEqual({
      id: 'vid-1',
      status: { ...CURRENT_STATUS, publishAt: '2026-09-11T15:00:00.000Z' },
    })
  })

  it('refuses a video that is already public — nothing is written', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { items: [{ status: { privacyStatus: 'public' } }] }),
    )

    const moved = await movePublishAt('ya29.access', 'vid-1', '2026-09-11T15:00:00.000Z')

    expect(moved.ok).toBe(false)
    expect(moved.error).toContain('already public')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a video deleted in Studio is a stated failure, not a crash', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [] }))

    const moved = await movePublishAt('ya29.access', 'vid-gone', '2026-09-11T15:00:00.000Z')

    expect(moved.ok).toBe(false)
    expect(moved.error).toContain('no longer knows this video')
  })

  it('surfaces the API error message on a refused update', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { items: [{ status: CURRENT_STATUS }] }))
      .mockResolvedValueOnce(jsonResponse(403, { error: { message: 'The request is forbidden.' } }))

    const moved = await movePublishAt('ya29.access', 'vid-1', '2026-09-11T15:00:00.000Z')

    expect(moved).toEqual({ ok: false, error: 'The request is forbidden.' })
  })
})
