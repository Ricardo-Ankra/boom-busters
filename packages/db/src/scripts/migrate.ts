import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createDb } from '../client'
import { requireDatabaseUrl } from './load-env'

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

async function main(): Promise<void> {
  const { sql, db } = createDb(requireDatabaseUrl(), { max: 1 })

  try {
    console.log(`Applying migrations from ${migrationsFolder}`)
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
