import { assertNoSubscriptionTokenOnServer, getEnv } from '@boom-busters/schemas'
import 'server-only'

/**
 * Boot-time environment validation (build spec section 4). Importing this
 * module is what makes the app "refuse to start listing missing keys": the
 * first server module to touch `env` triggers the parse, and an incomplete
 * environment throws `EnvValidationError` naming every missing variable.
 */
export const env = getEnv()

// The Claude subscription token lives on the owner's PC, never on a
// deployment (decision 469). Checked at the same moment as the rest of boot.
assertNoSubscriptionTokenOnServer()
