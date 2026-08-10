import { NextResponse } from 'next/server'
import { auth } from './auth'

/**
 * Middleware-protected everything (build spec section 2).
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts`; the behaviour is unchanged.
 * Anything not explicitly public redirects to /signin, so a route added in a
 * later milestone is protected by default rather than by remembering to add
 * it to a list.
 */

/**
 * `/api/inngest` is public to the session check because its caller is Inngest,
 * not a browser: it authenticates with a signing key that `serve()` verifies
 * on every request (spec section 12). Redirecting it to /signin would simply
 * break the orchestrator.
 */
const PUBLIC_PATHS = ['/signin', '/api/auth', '/api/inngest']

export default auth((request) => {
  const { pathname } = request.nextUrl

  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  const isSignedIn = Boolean(request.auth?.user?.email)

  if (!isSignedIn && !isPublic) {
    const signIn = new URL('/signin', request.nextUrl)
    // Deep links from a notification survive the round trip through sign-in
    // (spec section 11.4: notifications link to the exact review screen).
    signIn.searchParams.set('callbackUrl', `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(signIn)
  }

  if (isSignedIn && pathname === '/signin') {
    return NextResponse.redirect(new URL('/', request.nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
