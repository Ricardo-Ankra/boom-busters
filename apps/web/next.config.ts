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
  // `sharp` is a native module, loaded only when a pasted image turns out to
  // be an AVIF (decision 266, lib/remote-image.ts). Bundling it would break
  // the platform-specific binary, so Next leaves it where it is. `esbuild`
  // is the same kind of package: the graphics designer's compile check
  // (decision 295, lib/graphic-code/compile.ts) runs its native binary.
  serverExternalPackages: ['esbuild', 'postgres', 'sharp'],
  // The dry run (decision 295, lib/graphic-code/dry-run.ts) requires React,
  // react-dom/server and Remotion at run time by names the file trace cannot
  // read, so the Inngest route's function bundle would ship without them.
  // Only the files Node loads: the CommonJS builds.
  outputFileTracingIncludes: {
    '/api/inngest': [
      './node_modules/react/package.json',
      './node_modules/react/*.js',
      './node_modules/react/cjs/**/*',
      './node_modules/react-dom/package.json',
      './node_modules/react-dom/*.js',
      './node_modules/react-dom/cjs/**/*',
      './node_modules/remotion/package.json',
      './node_modules/remotion/dist/cjs/**/*',
      // The same files at their real pnpm paths: apps/web/node_modules holds
      // symlinks, and a deploy that copies by real path needs the targets.
      '../../node_modules/.pnpm/react@*/node_modules/react/package.json',
      '../../node_modules/.pnpm/react@*/node_modules/react/*.js',
      '../../node_modules/.pnpm/react@*/node_modules/react/cjs/**/*',
      '../../node_modules/.pnpm/react-dom@*/node_modules/react-dom/package.json',
      '../../node_modules/.pnpm/react-dom@*/node_modules/react-dom/*.js',
      '../../node_modules/.pnpm/react-dom@*/node_modules/react-dom/cjs/**/*',
      '../../node_modules/.pnpm/remotion@*/node_modules/remotion/package.json',
      '../../node_modules/.pnpm/remotion@*/node_modules/remotion/dist/cjs/**/*',
    ],
  },
  typedRoutes: true,
  // Next's floating dev-tools button is a 32px control that only exists in
  // dev. It fails the 40px hit-target audit the E2E suite runs over every
  // visible control, and it is not part of the app.
  devIndicators: false,
  experimental: {
    // Inngest handlers land in M2 and need the long ceiling (spec section 7).
    proxyTimeout: 30_000,
    // No serverActions.bodySizeLimit override: nothing sends a large body
    // through an action. It was tried for music uploads and cannot work —
    // Vercel 413s request bodies over ~4.5 MB at its edge regardless of what
    // Next would accept, which is why music goes browser → R2 directly
    // (decision 205, lib/storage.ts presignPut).
  },
}

export default nextConfig
