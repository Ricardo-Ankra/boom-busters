import type { Instrumentation } from 'next'

/**
 * Error tracking (build spec section 12): Sentry over the web app and the
 * Inngest functions — which execute inside this same Next server, so one
 * init covers both. Release-tagged with the deployed commit.
 *
 * Inert by design until `SENTRY_DSN` exists: the SDK is not even imported
 * without it, so local dev, CI and a DSN-less deployment run exactly the
 * code they ran before Sentry existed. Sourcemap upload (needs
 * SENTRY_AUTH_TOKEN and the build plugin) is deliberately not wired —
 * server stacks are readable enough, and a build that needs a Sentry
 * account to pass is a build that fails for the wrong reasons.
 */

export async function register(): Promise<void> {
  if (!process.env['SENTRY_DSN']) return

  const Sentry = await import('@sentry/nextjs')
  Sentry.init({
    dsn: process.env['SENTRY_DSN'],
    release: process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'dev',
    environment: process.env['VERCEL_ENV'] ?? 'development',
    // Errors only. Tracing is spend and noise this single-user console
    // does not need; the run mirror already tells the story of a pipeline.
    tracesSampleRate: 0,
  })
}

/** Uncaught errors from nested React Server Components (Next 15+ hook). */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env['SENTRY_DSN']) return
  const Sentry = await import('@sentry/nextjs')
  await Sentry.captureRequestError(...args)
}
