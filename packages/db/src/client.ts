import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

export type Database = ReturnType<typeof createDb>['db']

/**
 * Creates a connection. Prefer `getDb()` in the app — this exists so tests and
 * scripts can open (and close) their own throwaway connection.
 */
export function createDb(connectionString: string, options?: { max?: number }) {
  const sql = postgres(connectionString, {
    max: options?.max ?? 5,
    // Serverless functions get one short-lived connection per invocation;
    // a long idle timeout would exhaust Neon's pooler.
    idle_timeout: 20,
    connect_timeout: 10,
    /**
     * Neon's pooled endpoint is PgBouncer in transaction mode, which rejects
     * the named prepared statements postgres.js uses by default. The Vercel
     * integration injects the POOLED url as DATABASE_URL, so this is the
     * configuration that actually gets used in production.
     *
     * It costs nothing on a direct connection: postgres.js simply sends
     * unnamed statements, which are still parameterised and still safe.
     */
    prepare: false,
  })
  return { sql, db: drizzle(sql, { schema }) }
}

let singleton: { sql: postgres.Sql; db: ReturnType<typeof drizzle<typeof schema>> } | undefined

/** Memoised connection for the web app. */
export function getDb(connectionString?: string): Database {
  if (!singleton) {
    const url = connectionString ?? process.env['DATABASE_URL']
    if (!url) throw new Error('DATABASE_URL is not set')
    singleton = createDb(url)
  }
  return singleton.db
}

/** Test/script teardown. */
export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.sql.end({ timeout: 5 })
    singleton = undefined
  }
}
