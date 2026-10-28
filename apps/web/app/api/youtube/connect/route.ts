import { randomBytes } from 'node:crypto'
import { getChannel } from '@boom-busters/db'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { channelHref } from '@/lib/channel-href'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { youtubeAuthUrl, youtubeConfigured } from '@/lib/youtube'
import { signOauthState } from '@/lib/youtube-state'

/**
 * The Connect button's destination (build spec section 9): starts the OAuth
 * dance for one channel (`?channel=<id>`). A random nonce lands in an
 * httpOnly cookie; the state sent to Google is the channel id and that nonce
 * under an HMAC, so the callback knows which channel the grant belongs to
 * and can refuse a forged redirect.
 */

export const runtime = 'nodejs'

export const STATE_COOKIE = 'bb-youtube-oauth-state'

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const origin = url.origin

  const channelId = url.searchParams.get('channel')
  if (!channelId) return new Response('A channel is required.', { status: 400 })
  const channel = await getChannel(db, channelId).catch(() => null)
  if (!channel) return new Response('That channel does not exist.', { status: 400 })
  if (channel.archivedAt !== null) {
    // An archived channel is read-only: back to its Connections tab, no OAuth.
    const to = channelHref(channel.slug, '/settings', { tab: 'connections', youtube: 'archived' })
    return Response.redirect(`${origin}${to}`, 302)
  }

  if (!youtubeConfigured()) {
    const to = channelHref(channel.slug, '/settings', {
      tab: 'connections',
      youtube: 'missing-client',
    })
    return Response.redirect(`${origin}${to}`, 302)
  }

  const nonce = randomBytes(24).toString('base64url')
  const jar = await cookies()
  jar.set(STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/api/youtube',
  })

  return Response.redirect(
    youtubeAuthUrl(signOauthState(channel.id, nonce, env.SECRETS_ENCRYPTION_KEY)),
    302,
  )
}
