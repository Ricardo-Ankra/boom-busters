import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIRST_CHANNEL_BIBLE, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'

/**
 * Migration 0037 carries the first channel's bible as a JSON literal, because
 * a migration cannot import TypeScript. These checks keep that literal equal
 * to `FIRST_CHANNEL_BIBLE` and the statements in the order the data needs.
 */

const migration = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle/0037_channels.sql'),
  'utf8',
)
const statements = migration.split('--> statement-breakpoint')

describe('migration 0037', () => {
  const insertIndex = statements.findIndex((s) => s.includes('INSERT INTO "channels"'))

  it('inserts the first channel with the bible FIRST_CHANNEL_BIBLE holds', () => {
    expect(insertIndex).toBeGreaterThanOrEqual(0)
    const insert = statements[insertIndex]!
    expect(insert).toContain(`'${FIRST_CHANNEL_ID}'`)

    const literal = /'(\{.*?\})'::jsonb/s.exec(insert)?.[1]
    expect(literal).toBeDefined()
    // SQL doubles a single quote inside a string literal.
    expect(JSON.parse(literal!.replaceAll("''", "'"))).toEqual(FIRST_CHANNEL_BIBLE)
  })

  it('drops settings last, after the first channel is made from it', () => {
    const dropIndex = statements.findIndex((s) => s.includes('DROP TABLE "settings"'))
    expect(dropIndex).toBeGreaterThan(insertIndex)
    expect(dropIndex).toBe(statements.length - 1)
  })

  it('sets the channel columns NOT NULL only after the backfill', () => {
    const backfill = statements.findIndex((s) => s.includes('UPDATE "cases" SET "channel_id"'))
    const notNull = statements.findIndex((s) =>
      /ALTER TABLE "cases" ALTER COLUMN "channel_id" SET NOT NULL/.test(s),
    )
    const foreignKey = statements.findIndex((s) => s.includes('"cases_channel_id_channels_id_fk"'))
    expect(backfill).toBeGreaterThan(insertIndex)
    expect(notNull).toBeGreaterThan(backfill)
    expect(foreignKey).toBeGreaterThan(backfill)
  })
})
