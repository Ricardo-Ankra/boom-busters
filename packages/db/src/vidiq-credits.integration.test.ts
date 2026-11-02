import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createChannel } from './channels'
import { createDb } from './client'
import { bibleDrafts, cases, channelBibles, channels, projects, vidiqCredits } from './schema'
import { requireTestDatabase } from './test-database'
import { recordVidiqCredits, vidiqCreditsThisMonth } from './vidiq-credits'

/** The VidIQ credits ledger against a real database. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('vidiq credits', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''

  beforeEach(async () => {
    await db.execute(
      dsql`truncate table ${vidiqCredits}, ${bibleDrafts}, ${channels}, ${channelBibles}, ${projects}, ${cases} restart identity cascade`,
    )
    channelId = (
      await createChannel(db, {
        name: 'A',
        handle: null,
        slug: 'a',
        settings: DEFAULT_SETTINGS,
        bible: EMPTY_BIBLE,
      })
    ).id
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('sums the UTC month asked for, workspace-wide, and no other', async () => {
    await recordVidiqCredits(db, {
      channelId,
      purpose: 'bible-research',
      tool: 'outliers',
      args: { q: 'a' },
      credits: 5,
    })
    const row = (credits: number, occurredAt: Date) => ({
      channelId,
      purpose: 'bible-research',
      tool: 'balance',
      args: {},
      credits,
      occurredAt,
    })
    await db
      .insert(vidiqCredits)
      .values([
        row(7, new Date('2020-10-02T00:00:00Z')),
        row(100, new Date('2020-09-30T23:59:59Z')),
        row(1000, new Date('2020-11-01T00:00:00Z')),
      ])

    expect(await vidiqCreditsThisMonth(db, new Date('2020-10-15T12:00:00Z'))).toBe(7)
    expect(await vidiqCreditsThisMonth(db, new Date('2020-09-10T00:00:00Z'))).toBe(100)
    // The row recorded just now is the only one in the real current month.
    expect(await vidiqCreditsThisMonth(db)).toBe(5)
  })
})
