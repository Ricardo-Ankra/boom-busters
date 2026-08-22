import { randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { youtubeAuthUrl, youtubeConfigured } from '@/lib/youtube'

/**
 * The Connect button's destination (build spec section 9): starts the OAuth
 * dance. A random state lands in an httpOnly cookie and rides along to
 * Google, so the callback can refuse a forged redirect.
 */

export const runtime = 'nodejs'

export const STATE_COOKIE = 'bb-youtube-oauth-state'

export async function GET(request: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.email) return new Response('Unauthorized', { status: 401 })

  const origin = new URL(request.url).origin
  if (!youtubeConfigured()) {
    return Response.redirect(`${origin}/settings?tab=connections&youtube=missing-client`, 302)
  }

  const state = randomBytes(24).toString('base64url')
  const jar = await cookies()
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/api/youtube',
  })

  return Response.redirect(youtubeAuthUrl(state), 302)
}
