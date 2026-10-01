import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client'
import { requireTestDatabase } from './test-database'

/**
 * `readOnly` (decision 287): the live harness reads a production project over
 * a session that cannot write. Checked against a real connection because the
 * guarantee is Postgres', not this package's — a typo in the option name
 * would otherwise open a perfectly normal, writable connection.
 */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('createDb readOnly (decision 287)', () => {
  const { sql } = createDb(url ?? 'postgres://unused', { max: 1, readOnly: true })
  afterAll(() => sql.end())

  it('opens a session that refuses writes', async () => {
    const [row] = await sql`show default_transaction_read_only`
    expect(row?.default_transaction_read_only).toBe('on')
    await expect(sql`create temporary table t (x int)`).rejects.toThrow(/read-only/)
  })
})
