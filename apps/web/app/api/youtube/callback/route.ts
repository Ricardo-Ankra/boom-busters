import {
  channelYoutubeConnection,
  getChannel,
  recordChannelYoutubeVerify,
  saveChannelYoutubeConnection,
} from '@boom-busters/db'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { channelHref } from '@/lib/channel-href'
import { landingSlug } from '@/lib/channel-context'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { exchangeCode, pingChannel, YoutubeAuthError } from '@/lib/youtube'
import { verifyOauthState } from '@/lib/youtube-state'
import { STATE_COOKIE } from '../connect/route'

/**
 * Where Google sends the browser back (build spec section 9). The state names
 * the channel and is checked against the nonce cookie, so a grant can only
 * land on the channel the Connect button was pressed for. The authorisation
 * code becomes a refresh token, stored AES-GCM encrypted on that channel's
 * connection; a `channels.list` ping with the short-lived access token stamps
 * it verified in the same breath. A ping that names a different YouTube
 * channel than the one stored marks the connection invalid.
 */

export const runtime = 'nodejs'

// With no channel known (a failed state check), the landing channel's Connections tab.
async function back(origin: string, outcome: string, slug?: string): Promise<Response> {
  const to = channelHref(slug ?? (await landingSlug()), '/settings', {
    tab: 'connections',
    youtube: outcome,
  })
  return Response.redirect(`${origin}${to}`, 302)
}

async function liveChannel(channelId: string): Promise<{ id: string; slug: string } | null> {
  const channel = await getChannel(db, channelId).catch(() => null)
  return channel && channel.archivedAt === null ? { id: channel.id, slug: channel.slug } : null
}

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const origin = url.origin

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const nonce = jar.get(STATE_COOKIE)?.value
  jar.delete(STATE_COOKIE)

  const verified =
    state && nonce ? verifyOauthState(state, nonce, env.SECRETS_ENCRYPTION_KEY) : null
  const channel = verified ? await liveChannel(verified.channelId) : null
  if (!channel) return await back(origin, 'state-mismatch')
  const slug = channel.slug

  // The user clicked Cancel on Google's consent screen, not an error.
  if (url.searchParams.get('error') !== null) return await back(origin, 'declined', slug)
  if (!code) return await back(origin, 'state-mismatch')

  let grant
  try {
    grant = await exchangeCode(code)
  } catch (error) {
    // The message only: Google's error body can echo request parameters, and
    // the code in this exchange is a secret that must not reach the logs.
    console.error(
      '[youtube] code exchange failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return await back(origin, error instanceof YoutubeAuthError ? 'exchange-failed' : 'error', slug)
  }

  if (!grant.refreshToken) {
    // prompt=consent should make this impossible; if Google omits it
    // anyway, storing nothing and saying so beats pretending.
    return await back(origin, 'no-refresh-token', slug)
  }

  // Wrapped so a store or ping failure mid-OAuth still lands on the Settings
  // screen with an outcome, never on a raw error page (audit, decision 238).
  try {
    const ping = await pingChannel(grant.accessToken)
    // Keep a stored YouTube channel id as it is: the verify below compares the
    // ping against it, so a reconnect to a different account cannot replace
    // the id and then record `ok`.
    const stored = await channelYoutubeConnection(db, channel.id)
    if (
      ping.ok &&
      stored?.youtubeChannelId &&
      ping.channelId &&
      stored.youtubeChannelId !== ping.channelId
    ) {
      // A different YouTube account answered. Nothing from this grant is
      // stored: the previous token, id and title stay, so no upload can reach
      // the wrong account, and the connection is marked invalid.
      await recordChannelYoutubeVerify(db, channel.id, 'invalid', ping.channelId)
      return await back(origin, 'channel-changed', slug)
    }
    await saveChannelYoutubeConnection(db, channel.id, {
      refreshToken: grant.refreshToken,
      encryptionKey: env.SECRETS_ENCRYPTION_KEY,
      youtubeChannelId: stored?.youtubeChannelId ?? ping.channelId ?? null,
      youtubeChannelTitle: ping.ok
        ? (ping.channelTitle ?? null)
        : (stored?.youtubeChannelTitle ?? null),
    })
    await recordChannelYoutubeVerify(
      db,
      channel.id,
      ping.ok ? 'ok' : 'invalid',
      ping.ok ? ping.channelId : undefined,
    )
    if (!ping.ok) {
      console.error('[youtube] connected but the channel ping failed:', ping.error)
      return await back(origin, 'no-channel', slug)
    }
  } catch (error) {
    console.error(
      '[youtube] storing the connection failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return await back(origin, 'error', slug)
  }

  return await back(origin, 'connected', slug)
}
