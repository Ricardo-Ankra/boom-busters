import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { functions } from '@/inngest/functions'
import { resolveServeOrigin } from '@/inngest/serve-origin'

/**
 * The Inngest serve route (build spec section 7).
 *
 * Authentication is Inngest's signing key, verified by `serve()` — this route
 * is deliberately outside the session check in `proxy.ts`, because the caller
 * is Inngest's servers, not a browser with a cookie. A mismatched signature is
 * rejected and logged (spec section 12).
 *
 * `maxDuration = 300` per the step-duration rule: no single step may block on
 * long provider work, so 300s is a ceiling for a pathological step rather than
 * a budget to spend.
 *
 * `serveOrigin` makes the app name the URL Inngest should call back on rather
 * than letting the SDK infer it from the request — see `serve-origin.ts` for
 * why inference is wrong on Vercel.
 */
export const maxDuration = 300

/** Steps talk to Postgres and (later) the render broker; Node, not Edge. */
export const runtime = 'nodejs'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  serveOrigin: resolveServeOrigin(),
})
