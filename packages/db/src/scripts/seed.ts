import { createDb } from '../client'
import { seed } from '../seed'
import { encryptionKeyOrEmpty, requireDatabaseUrl } from './load-env'

async function main(): Promise<void> {
  const { sql, db } = createDb(requireDatabaseUrl(), { max: 1 })
  const encryptionKey = encryptionKeyOrEmpty()

  try {
    const result = await seed(db, { encryptionKey: encryptionKey || undefined })
    console.log('Seeded the fixture case, project, dossier and claims.')
    if (result.credentialsImported.length > 0) {
      console.log(`Imported provider keys from env: ${result.credentialsImported.join(', ')}`)
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
