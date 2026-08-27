import * as Sentry from '@sentry/nextjs'

/**
 * The browser half of section 12's error tracking. `NEXT_PUBLIC_SENTRY_DSN`
 * is inlined at build time; without it this init is a no-op and the SDK
 * tree-shakes to almost nothing. Errors only — no session replay, no
 * tracing, nothing that films the owner using their own console.
 */

if (process.env['NEXT_PUBLIC_SENTRY_DSN']) {
  Sentry.init({
    dsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
    release: process.env['NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA'] ?? 'dev',
    environment: process.env['NEXT_PUBLIC_VERCEL_ENV'] ?? 'development',
    tracesSampleRate: 0,
  })
}

/** Next calls this on route changes; required export since Sentry v9. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
