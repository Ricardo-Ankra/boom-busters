import NextAuth, { type NextAuthConfig } from 'next-auth'
import type { Provider } from 'next-auth/providers'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { isAllowedEmail } from './lib/auth-allowlist'

/**
 * Auth.js with a hard allowlist of exactly one email (build spec section 2).
 *
 * Session strategy is JWT, not database: the app has one account, so a
 * sessions table would hold a single row, and a database adapter would force
 * `proxy.ts` off the edge runtime just to read it.
 *
 * Reads `process.env` directly rather than `lib/env.ts` so this module stays
 * importable from the proxy without pulling the database client in behind it.
 */

const OWNER_EMAIL = process.env['OWNER_EMAIL'] ?? ''

/**
 * Mock-provider mode (spec section 13) lets Playwright sign in without real
 * Google OAuth. Guarded three ways: never in a production build, never
 * without the explicit env flag, and it still enforces the same allowlist —
 * so even in mock mode you cannot sign in as anyone but the owner.
 */
const MOCK_ENABLED =
  process.env['NODE_ENV'] !== 'production' &&
  (process.env['MOCK_PROVIDERS'] === '1' || process.env['MOCK_PROVIDERS']?.toLowerCase() === 'true')

function buildProviders(): Provider[] {
  const providers: Provider[] = []

  const googleId = process.env['AUTH_GOOGLE_ID']
  const googleSecret = process.env['AUTH_GOOGLE_SECRET']
  if (googleId && googleSecret) {
    providers.push(Google({ clientId: googleId, clientSecret: googleSecret }))
  }

  if (MOCK_ENABLED) {
    providers.push(
      Credentials({
        id: 'mock',
        name: 'Mock owner (development only)',
        credentials: { email: { label: 'Email', type: 'email' } },
        authorize(credentials) {
          const email = typeof credentials?.['email'] === 'string' ? credentials['email'] : ''
          const requested = email.trim() === '' ? OWNER_EMAIL : email
          if (!isAllowedEmail(requested, OWNER_EMAIL)) return null
          return { id: 'owner', email: OWNER_EMAIL, name: 'Owner' }
        },
      }),
    )
  }

  return providers
}

export const authConfig = {
  providers: buildProviders(),
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: '/signin', error: '/signin' },
  trustHost: true,
  callbacks: {
    /** The single check standing between the console and the open internet. */
    signIn({ user, profile }) {
      return isAllowedEmail(profile?.email ?? user.email, OWNER_EMAIL)
    },
    jwt({ token, user }) {
      if (user?.email) token.email = user.email
      return token
    },
    session({ session, token }) {
      if (token.email) session.user.email = token.email
      return session
    },
    /**
     * Re-checked on every request through the proxy: a JWT minted before
     * OWNER_EMAIL changed must not keep working.
     */
    authorized({ auth }) {
      return isAllowedEmail(auth?.user?.email, OWNER_EMAIL)
    },
  },
} satisfies NextAuthConfig

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

/** Whether the mock credentials provider is registered — the sign-in page
 * shows its button only then, and E2E asserts on that. */
export const mockSignInEnabled = MOCK_ENABLED
