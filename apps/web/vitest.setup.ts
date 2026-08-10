import { loadEnvFiles, testDatabaseUrl } from '@boom-busters/db'
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Next loads `.env.local` for the app; Vitest does not. The Inngest tests hit
 * a real database through `lib/db`, which validates the boot env, so the same
 * file has to be loaded here. Real environment variables still win, which is
 * how CI supplies its own.
 */
loadEnvFiles()

/**
 * Inside this process, `DATABASE_URL` *is* the test database.
 *
 * The code under test — the gate helpers, the runners, the run-mirror
 * middleware — imports the app's own `db` singleton, which reads
 * `DATABASE_URL`. Rebinding it here is what stops those suites truncating the
 * database a deployment is serving, without making the application code
 * test-aware.
 *
 * With no `TEST_DATABASE_URL`, it is pointed at a host that cannot resolve
 * rather than left alone. postgres.js connects lazily, so the suites reach
 * their `describe.skip` and never dial it; anything that did try would fail
 * loudly instead of quietly succeeding against production.
 */
process.env['DATABASE_URL'] =
  testDatabaseUrl() ?? 'postgresql://unset:unset@test-database-url-is-not-set.invalid:5432/none'

afterEach(cleanup)
