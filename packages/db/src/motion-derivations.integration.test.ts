import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureFirstChannel } from './channels'
import { createDb } from './client'
import {
  createDerivation,
  finishDerivation,
  getDerivation,
  DERIVATION_STALE_MS,
  latestDerivation,
  runningDerivation,
  touchDerivation,
  updateTechniqueProgress,
} from './motion-derivations'
import { motionDerivations } from './schema'
import { requireTestDatabase } from './test-database'

/** A derivation's row (spec 2026-11-04, sections 9.1 and 11.3): what was asked, the progress per technique, the spend. */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

suite('motion derivations', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${motionDerivations} restart identity cascade`)
    channelId = (await ensureFirstChannel(db)).id
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('creates a derivation with a pending row per technique', async () => {
    const row = await createDerivation(db, {
      channelId,
      techniques: ['stat-counter', 'bar-chart'],
      rounds: 2,
      capUsd: 5,
    })
    expect(row.state).toBe('running')
    expect(row.capUsd).toBe('5.0000')
    expect(row.progress).toEqual([
      { technique: 'stat-counter', state: 'pending', versionId: null, reason: null, costUsd: 0 },
      { technique: 'bar-chart', state: 'pending', versionId: null, reason: null, costUsd: 0 },
    ])
    expect((await runningDerivation(db, channelId))?.id).toBe(row.id)
    expect((await latestDerivation(db, channelId))?.id).toBe(row.id)
  })

  it("updates one technique's progress and leaves the others", async () => {
    const row = await createDerivation(db, {
      channelId,
      techniques: ['stat-counter', 'bar-chart'],
      rounds: 1,
      capUsd: 5,
    })
    await updateTechniqueProgress(db, row.id, 'bar-chart', {
      state: 'stopped-at-cap',
      reason: 'The cap of $5 was reached at $5.10',
      costUsd: 1.5,
    })
    const after = await getDerivation(db, row.id)
    expect(after?.progress[0]).toEqual(row.progress[0])
    expect(after?.progress[1]).toMatchObject({ state: 'stopped-at-cap', costUsd: 1.5 })
  })

  it('a running row nobody has touched for a quarter of an hour is not running (final review, issue 1)', async () => {
    const row = await createDerivation(db, {
      channelId,
      techniques: ['stat-counter'],
      rounds: 1,
      capUsd: 5,
    })
    expect((await runningDerivation(db, channelId))?.id).toBe(row.id)
    const stale = new Date(Date.now() - DERIVATION_STALE_MS - 1000)
    await db
      .update(motionDerivations)
      .set({ updatedAt: stale })
      .where(eq(motionDerivations.id, row.id))
    expect(await runningDerivation(db, channelId)).toBeNull()
    await touchDerivation(db, row.id)
    expect((await runningDerivation(db, channelId))?.id).toBe(row.id)
    expect((await latestDerivation(db, channelId))?.id).toBe(row.id)
  })

  it('finishes with the spend', async () => {
    const row = await createDerivation(db, {
      channelId,
      techniques: ['stat-counter'],
      rounds: 1,
      capUsd: 5,
    })
    await finishDerivation(db, row.id, { state: 'stopped', spentUsd: 5.1 })
    const after = await getDerivation(db, row.id)
    expect(after?.state).toBe('stopped')
    expect(after?.spentUsd).toBe('5.1000')
    expect(after?.finishedAt).toBeInstanceOf(Date)
    expect(await runningDerivation(db, channelId)).toBeNull()
    expect((await latestDerivation(db, channelId))?.id).toBe(row.id)
  })
})
