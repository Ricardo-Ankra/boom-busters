import { getEnv, isMockMode } from '@boom-busters/schemas'
import 'server-only'

/**
 * Boot-time environment validation (build spec section 4). Importing this
 * module is what makes the app "refuse to start listing missing keys": the
 * first server module to touch `env` triggers the parse, and an incomplete
 * environment throws `EnvValidationError` naming every missing variable.
 */
export const env = getEnv()

/** Mock-provider mode, hard-guarded off in production. */
export const MOCK_MODE = isMockMode()
