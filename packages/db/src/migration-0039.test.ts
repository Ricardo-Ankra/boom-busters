import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXAMPLE_SLOT_IDS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_BIBLE_ID,
  FIRST_CHANNEL_ID,
  UlidSchema,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'

/**
 * Migration 0039 carries the first channel's bible and the slot registry as
 * literals, because a migration cannot import TypeScript. These checks keep
 * the literals equal to what the code holds and the statements in the order
 * the data needs. If a later task corrects an entry in `FIRST_CHANNEL_BIBLE`,
 * it updates the literal in the same commit.
 */

const migration = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle/0039_channel_bibles.sql'),
  'utf8',
)
const statements = migration.split('--> statement-breakpoint')

const firstInsertIndex = statements.findIndex(
  (s) => s.includes('INSERT INTO "channel_bibles"') && s.includes(`'${FIRST_CHANNEL_BIBLE_ID}'`),
)

describe('migration 0039', () => {
  it('inserts the first channel version 1 with the bible FIRST_CHANNEL_BIBLE holds', () => {
    expect(firstInsertIndex).toBeGreaterThanOrEqual(0)
    const insert = statements[firstInsertIndex]!
    expect(insert).toContain(`'${FIRST_CHANNEL_ID}'`)
    expect(insert).toContain("'Lifted from code'")

    const literal = /'(\{.*?\})'::jsonb/s.exec(insert)?.[1]
    expect(literal).toBeDefined()
    // SQL doubles a single quote inside a string literal.
    expect(JSON.parse(literal!.replaceAll("''", "'"))).toEqual(FIRST_CHANNEL_BIBLE)
  })

  it('writes it only when the first channel exists, so a fresh database gets nothing', () => {
    expect(statements[firstInsertIndex]).toMatch(
      new RegExp(`WHERE EXISTS \\(SELECT 1 FROM "channels" WHERE "id" = '${FIRST_CHANNEL_ID}'\\)`),
    )
  })

  it('stamps every version with the slot registry the code holds', () => {
    const inserts = statements.filter((s) => s.includes('INSERT INTO "channel_bibles"'))
    expect(inserts).toHaveLength(2)
    for (const insert of inserts) {
      const array = /ARRAY\[(.*?)\]::text\[\]/s.exec(insert)?.[1]
      expect(array).toBeDefined()
      const ids = [...array!.matchAll(/'([^']*)'/g)].map((match) => match[1])
      expect(ids).toEqual([...EXAMPLE_SLOT_IDS])
    }
  })

  it('carries the other channels over incomplete, with ids that are ULIDs', () => {
    const carry = statements.find(
      (s) => s.includes('INSERT INTO "channel_bibles"') && s.includes('Carried over'),
    )
    expect(carry).toBeDefined()
    expect(carry).toContain('c."bible"')
    expect(carry).toContain("'Carried over from the Channel tab'")
    expect(carry).toMatch(/false,\s*'Carried over/)

    // The id expression, evaluated the way Postgres would: a zero and 25 upper-case hex digits.
    const generated = '0' + 'abcdef0123456789abcdef012'.toUpperCase()
    expect(UlidSchema.safeParse(generated).success).toBe(true)
    expect(carry).toContain(
      "'0' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 25))",
    )
  })

  it('drops channels.bible only after it is copied and the pointers are set', () => {
    const copy = statements.findIndex((s) => s.includes('Carried over'))
    const pointer = statements.findIndex((s) =>
      s.includes('UPDATE "channels" SET "current_bible_id"'),
    )
    const backfill = statements.findIndex((s) => s.includes('UPDATE "projects" SET "bible_id"'))
    const notNull = statements.findIndex((s) =>
      s.includes('ALTER TABLE "projects" ALTER COLUMN "bible_id" SET NOT NULL'),
    )
    const drop = statements.findIndex((s) => s.includes('DROP COLUMN "bible"'))
    expect(firstInsertIndex).toBeGreaterThanOrEqual(0)
    expect(copy).toBeGreaterThan(firstInsertIndex)
    expect(pointer).toBeGreaterThan(copy)
    expect(backfill).toBeGreaterThan(pointer)
    expect(notNull).toBeGreaterThan(backfill)
    expect(drop).toBeGreaterThan(firstInsertIndex)
    expect(drop).toBeGreaterThan(copy)
  })
})
