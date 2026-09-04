import { describe, expect, it } from 'vitest'
import { createDb } from './client'

/**
 * postgres.js connects lazily, so building a client against a URL that goes
 * nowhere is safe — no query is ever issued. What matters is the options it
 * will connect WITH: `max_lifetime` bounds how stale a pooled socket can get
 * on a frozen-and-thawed serverless instance (the 2026-09-04 wedge), and
 * `prepare: false` keeps Neon's transaction-mode pooler happy.
 */
describe('createDb', () => {
  it('recycles pooled connections after five minutes', async () => {
    const { sql } = createDb('postgres://user:pass@localhost:5432/nowhere')
    try {
      expect(sql.options.max_lifetime).toBe(300)
    } finally {
      await sql.end({ timeout: 0 })
    }
  })

  it('keeps unnamed statements for the transaction-mode pooler', async () => {
    const { sql } = createDb('postgres://user:pass@localhost:5432/nowhere')
    try {
      expect(sql.options.prepare).toBe(false)
    } finally {
      await sql.end({ timeout: 0 })
    }
  })
})
