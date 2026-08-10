import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { config } from 'dotenv'

/**
 * The database the E2E suite is allowed to touch.
 *
 * Global setup truncates the run mirror and the cost ledger, reseeds and
 * rewrites the settings row, and the specs then toggle the kill switch and
 * edit budgets. Against the database a deployment is serving, that is
 * destruction dressed as a test run — and until this existed they were the
 * same database.
 *
 * So E2E reads `TEST_DATABASE_URL`, which nothing else in the app looks at,
 * and refuses to run without it rather than falling back to `DATABASE_URL`.
 * The refusal is deliberate: an E2E suite that silently skipped would report
 * success having tested nothing.
 */
export function e2eDatabaseUrl(): string {
  const repoRoot = resolve(import.meta.dirname, '..')
  for (const file of ['.env.local', '.env']) {
    const path = resolve(repoRoot, file)
    if (existsSync(path)) config({ path, override: false, quiet: true })
  }

  const url = process.env['TEST_DATABASE_URL']?.trim()
  if (url) return url

  throw new Error(
    [
      'TEST_DATABASE_URL is not set, and the E2E suite will not fall back to DATABASE_URL.',
      '',
      'This suite truncates the run mirror and the cost ledger, reseeds the fixture',
      'project and rewrites the settings row. DATABASE_URL is the database your',
      'deployment reads, so running against it would erase live state.',
      '',
      'Create a Neon branch (Branches -> New branch from production) and add its',
      'connection string to .env.local as TEST_DATABASE_URL. A branch is a',
      'copy-on-write clone, so the schema and migrations come with it.',
      '',
      'CI sets it to the ephemeral Postgres service container.',
    ].join('\n'),
  )
}
