import { recordVerifyResult, setCredential } from '@boom-busters/db'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { exchangeCode, pingChannel, YoutubeAuthError } from '@/lib/youtube'
import { STATE_COOKIE } from '../connect/route'

/**
 * Where Google sends the browser back (build spec section 9). The
 * authorisation code becomes a refresh token, stored AES-GCM encrypted in
 * provider_credentials under 'youtube'; a `channels.list` ping with the
 * short-lived access token stamps the connection verified in the same
 * breath — the first-run checklist's "Connect YouTube" is only done when
 * the account demonstrably has a channel.
 */

export const runtime = 'nodejs'

function back(origin: string, outcome: string): Response {
  return Response.redirect(`${origin}/settings?tab=connections&youtube=${outcome}`, 302)
}

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const origin = url.origin

  // The user clicked Cancel on Google's consent screen — not an error.
  if (url.searchParams.get('error') !== null) return back(origin, 'declined')

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const expected = jar.get(STATE_COOKIE)?.value
  jar.delete(STATE_COOKIE)

  if (!code || !state || !expected || state !== expected) {
    return back(origin, 'state-mismatch')
  }

  let grant
  try {
    grant = await exchangeCode(code)
  } catch (error) {
    console.error('[youtube] code exchange failed', error)
    return back(origin, error instanceof YoutubeAuthError ? 'exchange-failed' : 'error')
  }

  if (!grant.refreshToken) {
    // prompt=consent should make this impossible; if Google omits it
    // anyway, storing nothing and saying so beats pretending.
    return back(origin, 'no-refresh-token')
  }

  await setCredential(db, 'youtube', grant.refreshToken, env.SECRETS_ENCRYPTION_KEY)

  const ping = await pingChannel(grant.accessToken)
  await recordVerifyResult(db, 'youtube', ping.ok ? 'ok' : 'invalid')
  if (!ping.ok) {
    console.error('[youtube] connected but the channel ping failed:', ping.error)
    return back(origin, 'no-channel')
  }

  return back(origin, 'connected')
}
