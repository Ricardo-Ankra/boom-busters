import 'server-only'

import { hasEnvGroup, requireEnv } from '@boom-busters/schemas'

/**
 * The YouTube OAuth client (build spec section 9): connect once in Settings,
 * exactly these scopes, refresh token stored AES-GCM encrypted, connection
 * health surfaced as a status chip off a `channels.list` ping.
 *
 * The refresh token never leaves this server: media-utils gets short-lived
 * ACCESS tokens minted here (`refreshAccessToken`), passed in job payloads
 * by the publish-runner (M7.6).
 */

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
] as const

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels'

export function youtubeConfigured(): boolean {
  return hasEnvGroup('youtube')
}

export function youtubeRedirectUri(): string {
  const origin = (process.env['AUTH_URL'] ?? 'http://localhost:3000').replace(/\/$/, '')
  return `${origin}/api/youtube/callback`
}

/**
 * Where the Connect button sends the browser. `access_type=offline` +
 * `prompt=consent` together guarantee a refresh token comes back — Google
 * omits it on a repeat consent otherwise, which would store nothing and
 * read as connected.
 */
export function youtubeAuthUrl(state: string): string {
  const { YOUTUBE_CLIENT_ID } = requireEnv('youtube')
  const params = new URLSearchParams({
    client_id: YOUTUBE_CLIENT_ID,
    redirect_uri: youtubeRedirectUri(),
    response_type: 'code',
    scope: YOUTUBE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `${AUTH_ENDPOINT}?${params.toString()}`
}

export interface TokenGrant {
  accessToken: string
  /** Present on the initial code exchange; never on a refresh. */
  refreshToken?: string
  expiresInSec: number
}

export class YoutubeAuthError extends Error {
  /** True when the stored refresh token is dead and only re-consent helps. */
  readonly needsReconnect: boolean
  constructor(message: string, needsReconnect = false) {
    super(message)
    this.name = 'YoutubeAuthError'
    this.needsReconnect = needsReconnect
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenGrant> {
  const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET } = requireEnv('youtube')
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...body,
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
    }).toString(),
  })

  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (!response.ok || !payload.access_token) {
    // invalid_grant is Google for "this refresh token is revoked or
    // expired" — the one failure a retry can never fix.
    const needsReconnect = payload.error === 'invalid_grant'
    throw new YoutubeAuthError(
      `token endpoint answered ${response.status}` +
        (payload.error
          ? ` (${payload.error}${payload.error_description ? `: ${payload.error_description}` : ''})`
          : ''),
      needsReconnect,
    )
  }

  return {
    accessToken: payload.access_token,
    ...(payload.refresh_token !== undefined ? { refreshToken: payload.refresh_token } : {}),
    expiresInSec: payload.expires_in ?? 3600,
  }
}

/** The callback's half: authorisation code → tokens. */
export function exchangeCode(code: string): Promise<TokenGrant> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: youtubeRedirectUri(),
  })
}

/** The publish-runner's half: stored refresh token → short-lived access token. */
export function refreshAccessToken(refreshToken: string): Promise<TokenGrant> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken })
}

export interface ChannelPing {
  ok: boolean
  channelTitle?: string
  error?: string
}

/**
 * The connection-health ping (spec section 9): the cheapest authenticated
 * read there is — `channels.list mine=true`, 1 quota unit.
 */
export async function pingChannel(accessToken: string): Promise<ChannelPing> {
  const params = new URLSearchParams({ part: 'snippet', mine: 'true' })
  const response = await fetch(`${CHANNELS_ENDPOINT}?${params.toString()}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })

  const payload = (await response.json().catch(() => ({}))) as {
    items?: { snippet?: { title?: string } }[]
    error?: { message?: string }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: payload.error?.message ?? `channels.list answered ${response.status}`,
    }
  }
  const title = payload.items?.[0]?.snippet?.title
  if (!title) {
    return { ok: false, error: 'The Google account has no YouTube channel.' }
  }
  return { ok: true, channelTitle: title }
}
