import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from '../client'
import { testDatabaseUrl } from '../test-database'

/**
 * Apply migrations to the test database.
 *
 * A Neon branch is a point-in-time clone, not a follower: it carries the
 * schema it was cut from and does not pick up later migrations on its own. So
 * every migration has to be applied here too, or the integration suites fail
 * on a missing relation that exists everywhere else.
 *
 * This exists as its own script rather than as `DATABASE_URL=… pnpm db:migrate`
 * because that form trips the same-database guard in `load-env.ts`: overriding
 * `DATABASE_URL` alone leaves a stale `DATABASE_URL_UNPOOLED` from `.env.local`
 * pointing at production, and the guard — correctly — refuses to migrate one
 * database while the app reads another.
 */

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

async function main(): Promise<void> {
  const url = testDatabaseUrl()
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Create a Neon branch and put its connection string in\n' +
        '.env.local. See packages/db/src/test-database.ts.',
    )
  }

  const { sql, db } = createDb(url, { max: 1 })
  const host = new URL(url).hostname

  try {
    console.log(`Applying migrations to the TEST database (${host})`)
    await migrate(db, { migrationsFolder })
    console.log('Migrations applied.')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
