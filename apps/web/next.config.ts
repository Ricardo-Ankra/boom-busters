import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config as loadEnvFile } from 'dotenv'
import type { NextConfig } from 'next'

/**
 * One `.env.local` at the repository root, not one per workspace: the same
 * DATABASE_URL and SECRETS_ENCRYPTION_KEY are needed by `pnpm db:migrate`,
 * `pnpm db:seed` and the app, and two copies drift. Next only reads env from
 * the app directory, so the root file is loaded here.
 *
 * `override: false` keeps real environment variables (Vercel, CI) winning.
 */
const repoRoot = resolve(import.meta.dirname, '../..')
for (const file of ['.env.local', '.env']) {
  const path = resolve(repoRoot, file)
  if (existsSync(path)) loadEnvFile({ path, override: false, quiet: true })
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build step, so
  // Next compiles them alongside the app. One fewer build to keep in sync.
  transpilePackages: [
    '@boom-busters/schemas',
    '@boom-busters/db',
    '@boom-busters/ui-tokens',
    // Only the `/geo` subpath is imported — world geometry for the
    // visual board's MapPreview; no React or Remotion comes with it.
    '@boom-busters/compositions',
    '@boom-busters/timeline',
  ],
  serverExternalPackages: ['postgres'],
  typedRoutes: true,
  // Next's floating dev-tools button is a 32px control that only exists in
  // dev. It fails the 40px hit-target audit the E2E suite runs over every
  // visible control, and it is not part of the app.
  devIndicators: false,
  experimental: {
    // Inngest handlers land in M2 and need the long ceiling (spec section 7).
    proxyTimeout: 30_000,
    serverActions: {
      // Music beds upload through a server action and the library allows
      // 25 MB per track (MUSIC_MAX_BYTES). Next's default cap is 1 MB, which
      // rejected every real audio file before the action ever ran — the
      // extra headroom covers multipart boundaries and the form fields.
      bodySizeLimit: '30mb',
    },
  },
}

export default nextConfig
