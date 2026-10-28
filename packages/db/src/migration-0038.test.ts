import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'

/**
 * Migration 0038 carries the first channel's bible as a JSON literal, because
 * a migration cannot import TypeScript. These checks keep that literal equal
 * to the bible as stage A shaped it (`FIRST_CHANNEL_BIBLE_AT_0037`, frozen
 * here: the live `FIRST_CHANNEL_BIBLE` has since grown) and the statements in
 * the order the data needs.
 */

const FIRST_CHANNEL_BIBLE_AT_0037 = {
  subject: 'corporate collapses, frauds, meltdowns and turnarounds',
  whatACaseIs:
    'A good case has: a documented paper trail (court filings, regulator actions, major-outlet reporting), a clear turn where the story changes, and consequences that can be shown rather than described. A bad case is one where the only sources are other YouTube videos, or where the interesting part is speculation about what someone was thinking.',
  subjectKind: "the company's common name as Wikipedia titles it",
  audience: 'adults who watch long-form money documentaries',
  narrationRegister: 'plain, specific, unhurried',
  visualRegister:
    "the Netflix money documentary. Dark, patient, photographic realism. The people, in the rooms where it happened: principals at the table, in the corridor, at the podium, re-created with a reconstruction's restraint. Empty rooms, documents and objects are punctuation between them, not the film.",
  titleStyle: 'Sober, specific, curiosity-driven',
  ctaLine: 'The full story is on the channel',
  caseCategories: [
    { key: 'collapse', label: 'Collapse' },
    { key: 'con', label: 'Con' },
    { key: 'meltdown', label: 'Meltdown' },
    { key: 'turnaround', label: 'Turnaround' },
    { key: 'empire', label: 'Empire' },
  ],
  scriptRulesMd: '',
  directionRulesMd: '',
}

const migration = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle/0038_channels.sql'),
  'utf8',
)
const statements = migration.split('--> statement-breakpoint')

describe('migration 0038', () => {
  const insertIndex = statements.findIndex((s) => s.includes('INSERT INTO "channels"'))

  it('inserts the first channel with the bible FIRST_CHANNEL_BIBLE holds', () => {
    expect(insertIndex).toBeGreaterThanOrEqual(0)
    const insert = statements[insertIndex]!
    expect(insert).toContain(`'${FIRST_CHANNEL_ID}'`)

    const literal = /'(\{.*?\})'::jsonb/s.exec(insert)?.[1]
    expect(literal).toBeDefined()
    // SQL doubles a single quote inside a string literal.
    expect(JSON.parse(literal!.replaceAll("''", "'"))).toEqual(FIRST_CHANNEL_BIBLE_AT_0037)
  })

  it('drops settings last, after the first channel is made from it', () => {
    const dropIndex = statements.findIndex((s) => s.includes('DROP TABLE "settings"'))
    expect(dropIndex).toBeGreaterThan(insertIndex)
    expect(dropIndex).toBe(statements.length - 1)
  })

  it('creates the unique index on the YouTube channel id before settings is dropped', () => {
    const indexAt = statements.findIndex(
      (s) =>
        s.includes('CREATE UNIQUE INDEX "youtube_connections_youtube_channel_id_key"') &&
        s.includes('"youtube_connections" USING btree ("youtube_channel_id")'),
    )
    const dropIndex = statements.findIndex((s) => s.includes('DROP TABLE "settings"'))
    expect(indexAt).toBeGreaterThanOrEqual(0)
    expect(indexAt).toBeLessThan(dropIndex)
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
