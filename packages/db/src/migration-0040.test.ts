import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Migration 0040 turns `cases.category` into text. The statements must run in
 * an order Postgres accepts: the column leaves the enum, then the enum is dropped.
 */

const migration = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle/0040_case_category_text.sql'),
  'utf8',
)
const statements = migration.split('--> statement-breakpoint')
const at = (needle: string) => statements.findIndex((s) => s.includes(needle))

describe('migration 0040', () => {
  it('casts the column to text through its enum text, so no row changes', () => {
    expect(migration).toContain(
      'ALTER TABLE "cases" ALTER COLUMN "category" SET DATA TYPE text USING "category"::text',
    )
  })

  it('refuses an empty category', () => {
    expect(migration).toMatch(/ADD CONSTRAINT "cases_category_not_empty" CHECK \(.*<> ''\)/)
  })

  it('drops the enum only after the column has left it', () => {
    const alter = at('SET DATA TYPE text')
    const drop = at('DROP TYPE "public"."case_category"')
    expect(alter).toBeGreaterThanOrEqual(0)
    expect(drop).toBeGreaterThan(alter)
  })
})
