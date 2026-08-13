/**
 * One-off: delete voice takes whose audio was bought and never stored.
 *
 * These are the `mock://` rows written by the pre-`takeStorage` runner on a
 * deployment with live providers and no bucket — see PROGRESS.md M4.6. The
 * bytes are gone, so the row holds nothing but a claim that blocks the
 * paragraph from being narrated again: `claimTake` matches on
 * (project, chapter, paragraph, text, voice) and hands the dead take straight
 * back.
 *
 * Deliberately narrow. It takes a project id, touches only `mock://` rows, and
 * leaves the cost ledger alone — the money was spent and the Costs screen
 * should keep saying so.
 *
 *   pnpm --filter @boom-busters/db exec tsx src/scripts/clear-unstored-takes.ts <projectId>
 */
import { sql } from 'drizzle-orm'
import { createDb } from '../client'
import { loadEnvFiles, requireDatabaseUrl } from './load-env'

loadEnvFiles()

const projectId = process.argv[2]
if (!projectId) throw new Error('Pass a project id.')

const { db, sql: connection } = createDb(requireDatabaseUrl())

const deleted = await db.execute(sql`
  delete from voice_takes
  where project_id = ${projectId} and r2_key like 'mock://%'
  returning id
`)

console.log(`Deleted ${(deleted as unknown as unknown[]).length} unstored takes from ${projectId}.`)

const left = await db.execute(sql`
  select count(*) as remaining from voice_takes where project_id = ${projectId}
`)
console.table(left)

await connection.end()
