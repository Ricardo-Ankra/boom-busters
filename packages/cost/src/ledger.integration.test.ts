import { costLedger, createDb, requireTestDatabase, seed, type Database } from '@boom-busters/db'
import { FIRST_CHANNEL_ID, newId } from '@boom-busters/schemas'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { jobSpendUsd, recordCost, unsettledRenderLedgerId } from './ledger'
import { reserve, settle } from './guard'
import { DEFAULT_WORKSPACE_SETTINGS } from '@boom-busters/schemas'

/**
 * A job's spend (spec 2026-11-04, section 9.2): the derivation sums its
 * own rows before every paid step, by the job id its calls carry in
 * `meta`, a reserved row counted at its estimate until it settles.
 */

const DATABASE_URL = requireTestDatabase()
const describeDb = DATABASE_URL ? describe : describe.skip

describeDb('jobSpendUsd', () => {
  let connection: ReturnType<typeof createDb>
  let db: Database

  beforeAll(async () => {
    connection = createDb(DATABASE_URL as string, { max: 4 })
    db = connection.db
    await seed(db)
  })

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ${costLedger}`)
  })

  it("sums a job's rows by meta.jobId, settled or reserved", async () => {
    const jobId = newId()
    await recordCost(db, {
      provider: 'anthropic',
      operation: 'llm.graphics',
      channelId: FIRST_CHANNEL_ID,
      actualUsd: 1.25,
      meta: { jobId, technique: 'stat-counter' },
    })
    await recordCost(db, {
      provider: 'anthropic',
      operation: 'llm.critic',
      channelId: FIRST_CHANNEL_ID,
      actualUsd: 0.5,
      meta: { jobId: newId() },
    })
    await reserve(
      db,
      {
        provider: 'anthropic',
        operation: 'llm.critic',
        channelId: FIRST_CHANNEL_ID,
        estimateUsd: 0.3,
        meta: { jobId },
      },
      { ...DEFAULT_WORKSPACE_SETTINGS.budgets, monthlyCeilingUsd: 100 },
    )
    expect(await jobSpendUsd(db, jobId)).toBe(1.55)
    expect(await jobSpendUsd(db, newId())).toBe(0)
  })
})

describeDb('unsettledRenderLedgerId', () => {
  let connection: ReturnType<typeof createDb>
  let db: Database

  beforeAll(async () => {
    connection = createDb(DATABASE_URL as string, { max: 4 })
    db = connection.db
    await seed(db)
  })

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ${costLedger}`)
  })

  it('finds the open render-master row by meta.renderId, and none once it settles', async () => {
    const renderId = newId<'render'>()
    const budgets = { ...DEFAULT_WORKSPACE_SETTINGS.budgets, monthlyCeilingUsd: 100 }
    const spec = {
      provider: 'remotion' as const,
      operation: 'render-master',
      channelId: FIRST_CHANNEL_ID,
      estimateUsd: 2,
    }
    await reserve(db, { ...spec, meta: { renderId: newId<'render'>() } }, budgets)
    const ledgerId = await reserve(db, { ...spec, meta: { renderId } }, budgets)

    expect(await unsettledRenderLedgerId(db, 'render-master', renderId)).toBe(ledgerId)
    expect(await unsettledRenderLedgerId(db, 'render-draft', renderId)).toBeUndefined()

    await settle(db, ledgerId, 1.5)
    expect(await unsettledRenderLedgerId(db, 'render-master', renderId)).toBeUndefined()
  })
})
