import { Inngest } from 'inngest'
import { RunMirrorMiddleware } from './middleware/run-mirror'

/**
 * The Inngest client (build spec section 7).
 *
 * App id is the repo's kebab-case name, per the naming rules in spec section 3.
 *
 * Keys are read from `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` by the SDK
 * itself. They are not validated at boot: the Inngest Dev Server needs neither,
 * so demanding them would make `pnpm dev` and CI impossible without a cloud
 * account. When Inngest is unreachable, the send fails and the pressed button
 * says so (`send` in projects/actions.ts).
 */
export const inngest = new Inngest({
  id: 'boom-busters',
  middleware: [RunMirrorMiddleware],
  /**
   * Cloud only for a production build. Every Vercel deployment sets
   * `NODE_ENV=production`, local dev sets `development` and Vitest sets
   * `test` — so this is precisely "talk to Inngest Cloud when deployed, and to
   * the Dev Server (or nothing) otherwise". Without it the SDK treats a test
   * run as production and spends seconds per run trying to reach
   * `api.inngest.com` for registration and tracing.
   */
  isDev: process.env['INNGEST_DEV'] === '1' || process.env['NODE_ENV'] !== 'production',
})
