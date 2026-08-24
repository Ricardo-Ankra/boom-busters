import { loadEnvFiles } from './scripts/load-env'

/**
 * The database the destructive test suites are allowed to touch.
 *
 * Integration tests here TRUNCATE tables — the run mirror, the cost ledger,
 * cases and projects — and rewrite the settings row. That is fine against a
 * throwaway database and catastrophic against the one a deployment is serving,
 * and until this existed they were the same database: `DATABASE_URL` from
 * `.env.local` pointed at the Neon instance Vercel also reads, so `pnpm test`
 * quietly erased production state.
 *
 * So the tests no longer read `DATABASE_URL` at all. They read
 * `TEST_DATABASE_URL`, which nothing else in the app looks at, and which you
 * have to set deliberately. Unset, every destructive suite skips and says so.
 * There is no way to point these at production by forgetting something.
 *
 * Locally: a Docker container, never a Neon branch (decision 185: a cloud
 * test database burned through the Neon project's data-transfer quota and
 * took production down with it, 2026-08-24). Start it once with
 *   docker run -d --name boom-busters-test-db --restart unless-stopped \
 *     -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=boom_busters \
 *     -p 5433:5432 postgres:16-alpine
 * then set TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5433/boom_busters"
 * in `.env.local` and apply the schema with `pnpm db:migrate:test`.
 * In CI: the workflow sets it to the ephemeral Postgres service container.
 */
export function testDatabaseUrl(): string | undefined {
  loadEnvFiles()
  const url = process.env['TEST_DATABASE_URL']?.trim()
  return url === '' ? undefined : url
}

/** Printed once when a destructive suite skips, so the skip is not silent. */
export const TEST_DATABASE_SKIP_REASON =
  'TEST_DATABASE_URL is not set, so the database integration tests were skipped.\n' +
  'They truncate tables, so they will not fall back to DATABASE_URL — that is the\n' +
  'database your deployment reads. Start the local container (see\n' +
  'packages/db/src/test-database.ts) and set TEST_DATABASE_URL in .env.local to run them.'

let warned = false

/**
 * The URL if the suite may run, otherwise `undefined` — having explained why,
 * once per process rather than once per file.
 */
export function requireTestDatabase(): string | undefined {
  const url = testDatabaseUrl()
  if (url) return url

  if (!warned) {
    warned = true
    console.warn(`\n${TEST_DATABASE_SKIP_REASON}\n`)
  }
  return undefined
}
