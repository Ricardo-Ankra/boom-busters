import { newId } from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureFirstChannel } from './channels'
import { createDb } from './client'
import { listVerdicts, recordVerdict } from './motion-verdicts'
import { motionVerdicts } from './schema'
import { requireTestDatabase } from './test-database'

/** The preference ledger (spec 2026-11-04, section 11): every verdict the owner gives, with what it was given on. */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('motion verdicts', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${motionVerdicts} restart identity cascade`)
    channelId = (await ensureFirstChannel(db)).id
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('records a verdict with a comparison and lists newest first', async () => {
    const a = newId()
    const b = newId()
    const first = await recordVerdict(db, {
      channelId,
      kind: 'steer',
      exemplarId: a,
      steer: 'slower',
    })
    const second = await recordVerdict(db, {
      channelId,
      kind: 'prefer',
      exemplarId: a,
      comparison: { a, b },
    })
    expect(first.steer).toBe('slower')
    expect(second.comparison).toEqual({ a, b })
    expect(second.slotId).toBeNull()
    const listed = await listVerdicts(db, channelId)
    expect(listed.map((row) => row.id)).toEqual([second.id, first.id])
  })
})
