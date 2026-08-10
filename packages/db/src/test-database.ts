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
 * Locally: create a Neon branch (Branches -> New branch from `production`) and
 * put its connection string in `.env.local` as `TEST_DATABASE_URL`. A branch
 * is a copy-on-write clone, so the schema and migrations come with it.
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
  'database your deployment reads. Create a Neon branch and set TEST_DATABASE_URL\n' +
  'in .env.local to run them.'

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
