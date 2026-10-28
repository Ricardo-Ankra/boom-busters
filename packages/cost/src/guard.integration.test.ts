import {
  costLedger,
  createCase,
  createChannel,
  createDb,
  createProjectFromCase,
  getChannelBySlug,
  requireTestDatabase,
  seed,
  type Database,
} from '@boom-busters/db'
import {
  BudgetExceededError,
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
  TransientProviderError,
} from '@boom-busters/schemas'
import type { Settings } from '@boom-busters/schemas'
import { FIXTURE_PROJECT_ID } from '@boom-busters/db'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { budgetStatus, release, reserve, settle, withCost } from './guard'
import {
  listLedger,
  monthOtherChannelsUsd,
  monthSpendByProject,
  monthSpendByProvider,
  monthSpendUsd,
  monthTotalUsd,
  recordCost,
} from './ledger'

/**
 * The cost guard is mostly SQL: an advisory lock, an aggregate and an insert
 * in one transaction. Testing it against a mock would test the mock.
 *
 * This truncates the ledger, so it runs only against TEST_DATABASE_URL — never
 * the database a deployment reads. See `requireTestDatabase`.
 */
const DATABASE_URL = requireTestDatabase()
const describeDb = DATABASE_URL ? describe : describe.skip

/** Mid-month, so a test never straddles a real month boundary. */
const NOW = new Date('2026-03-15T12:00:00.000Z')

/** Defaults with the ceiling overridden — the one number the guard reads. */
function settingsWith(patch: { budgets?: Partial<Settings['budgets']> }): Settings {
  return {
    ...DEFAULT_SETTINGS,
    budgets: { ...DEFAULT_SETTINGS.budgets, ...patch.budgets },
  }
}

describeDb('cost guard', () => {
  let connection: ReturnType<typeof createDb>
  let db: Database

  beforeAll(async () => {
    connection = createDb(DATABASE_URL as string, { max: 6 })
    db = connection.db
    // The ledger's project rows reference a real project.
    await seed(db)
  })

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE ${costLedger}`)
  })

  // -------------------------------------------------------------------------
  // Cap edges
  // -------------------------------------------------------------------------

  it('lets a call through when there is room', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })

    const value = await withCost(
      db,
      { provider: 'anthropic', operation: 'research', estimateUsd: 1 },
      async () => ({ result: 'dossier', actualUsd: 0.9 }),
      { settings, now: NOW },
    )

    expect(value).toBe('dossier')
    expect(await monthSpendUsd(db, 'anthropic', NOW)).toBeCloseTo(0.9)
  })

  it('allows spend that lands exactly on the cap', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })

    await withCost(
      db,
      { provider: 'anthropic', operation: 'a', estimateUsd: 9 },
      async () => ({ result: null, actualUsd: 9 }),
      { settings, now: NOW },
    )
    await withCost(
      db,
      { provider: 'anthropic', operation: 'b', estimateUsd: 1 },
      async () => ({ result: null, actualUsd: 1 }),
      { settings, now: NOW },
    )

    expect(await monthSpendUsd(db, 'anthropic', NOW)).toBeCloseTo(10)
  })

  it('refuses the call that would cross the cap, not the one that reaches it', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })
    await recordCost(db, {
      provider: 'anthropic',
      operation: 'prior',
      actualUsd: 10,
      occurredAt: NOW,
    })

    await expect(
      withCost(
        db,
        { provider: 'anthropic', operation: 'over', estimateUsd: 0.0001 },
        async () => ({ result: null }),
        { settings, now: NOW },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('does not trip on a floating-point artefact', async () => {
    // 29.9 + 0.1 > 30 is *true* in IEEE 754. Rounding to the ledger's own
    // scale before comparing is what stops a budget gate opening on nothing.
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 30 } })
    await recordCost(db, {
      provider: 'anthropic',
      operation: 'prior',
      actualUsd: 29.9,
      occurredAt: NOW,
    })

    await expect(
      withCost(
        db,
        { provider: 'anthropic', operation: 'edge', estimateUsd: 0.1 },
        async () => ({ result: 'ok', actualUsd: 0.1 }),
        { settings, now: NOW },
      ),
    ).resolves.toBe('ok')
  })

  it('carries the arithmetic on the error, so the gate card can show it', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 5 } })
    await recordCost(db, {
      provider: 'google',
      operation: 'prior',
      actualUsd: 4.8,
      occurredAt: NOW,
    })

    const error = await withCost(
      db,
      { provider: 'google', operation: 'tts', estimateUsd: 0.5 },
      async () => ({ result: null }),
      { settings, now: NOW },
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(BudgetExceededError)
    const budget = error as BudgetExceededError
    expect(budget.provider).toBe('google')
    expect(budget.budgetUsd).toBeCloseTo(5)
    expect(budget.monthSpendUsd).toBeCloseTo(4.8)
    expect(budget.estimateUsd).toBeCloseTo(0.5)
    expect(budget.gated).toBe(true)
  })

  it('never calls the provider when it refuses', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 0 } })
    let called = 0

    await expect(
      withCost(
        db,
        { provider: 'anthropic', operation: 'research', estimateUsd: 0.01 },
        async () => {
          called += 1
          return { result: null }
        },
        { settings, now: NOW },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError)

    expect(called).toBe(0)
    expect(await listLedger(db)).toEqual([])
  })

  // -------------------------------------------------------------------------
  // The ceiling is global
  // -------------------------------------------------------------------------

  /**
   * The whole point of one number: spend on any provider counts against it.
   * Under the old per-provider caps this call would have sailed through with
   * anthropic untouched.
   */
  it("counts every provider's spend against the one ceiling", async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })
    await recordCost(db, { provider: 'google', operation: 'a', actualUsd: 6, occurredAt: NOW })
    await recordCost(db, {
      provider: 'elevenlabs',
      operation: 'b',
      actualUsd: 3.5,
      occurredAt: NOW,
    })

    await expect(
      withCost(
        db,
        { provider: 'anthropic', operation: 'research', estimateUsd: 1 },
        async () => ({ result: null }),
        { settings, now: NOW },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('a ceiling of zero refuses everything, which is all the kill switch ever did', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 0 } })

    await expect(
      withCost(
        db,
        { provider: 'anthropic', operation: 'research', estimateUsd: 0.01 },
        async () => ({ result: null }),
        { settings, now: NOW },
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError)
  })

  // -------------------------------------------------------------------------
  // Approved overage (the budget gate's resume path)
  // -------------------------------------------------------------------------

  it('lets an approved overage raise this month, and only this month', async () => {
    const settings = settingsWith({
      budgets: { monthlyCeilingUsd: 5, approvedOverage: { month: '2026-03', usd: 3 } },
    })
    await recordCost(db, {
      provider: 'elevenlabs',
      operation: 'prior',
      actualUsd: 5,
      occurredAt: NOW,
    })

    await expect(
      withCost(
        db,
        { provider: 'elevenlabs', operation: 'tts', estimateUsd: 2 },
        async () => ({ result: 'audio', actualUsd: 2 }),
        { settings, now: NOW },
      ),
    ).resolves.toBe('audio')

    // April's guard sees the same grant expired.
    const april = new Date('2026-04-02T00:00:00.000Z')
    const status = await budgetStatus(db, settings, { estimateUsd: 0.01, now: april })
    expect(status.ceilingUsd).toBeCloseTo(5)
  })

  // -------------------------------------------------------------------------
  // Concurrent estimate reservation
  // -------------------------------------------------------------------------

  it('serialises concurrent reservations so only what fits gets through', async () => {
    // Room for exactly three $1 calls. Ten fan-out steps race for it; the
    // advisory lock is what stops all ten reading "there is room" at once.
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 3 } })

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        withCost(
          db,
          { provider: 'fal', operation: `slot-${index}`, estimateUsd: 1 },
          async () => ({ result: index, actualUsd: 1 }),
          { settings, now: NOW },
        ),
      ),
    )

    const accepted = attempts.filter((a) => a.status === 'fulfilled')
    const refused = attempts.filter((a) => a.status === 'rejected')

    expect(accepted).toHaveLength(3)
    expect(refused).toHaveLength(7)
    for (const rejection of refused) {
      expect((rejection as PromiseRejectedResult).reason).toBeInstanceOf(BudgetExceededError)
    }
    expect(await monthSpendUsd(db, 'fal', NOW)).toBeCloseTo(3)
  })

  it('counts an unsettled reservation at its estimate', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })
    const ledgerId = await reserve(
      db,
      { provider: 'openai', operation: 'in-flight', estimateUsd: 4 },
      settings,
      NOW,
    )

    expect(await monthSpendUsd(db, 'openai', NOW)).toBeCloseTo(4)

    await settle(db, ledgerId, 1.25)
    expect(await monthSpendUsd(db, 'openai', NOW)).toBeCloseTo(1.25)
  })

  // -------------------------------------------------------------------------
  // Settlement
  // -------------------------------------------------------------------------

  it('records the estimate when the provider reports no usage', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 1 } })

    await withCost(
      db,
      { provider: 'pexels', operation: 'search', estimateUsd: 0.02 },
      async () => ({ result: [] }),
      { settings, now: NOW },
    )

    const [entry] = await listLedger(db)
    expect(entry?.actualUsd).toBeCloseTo(0.02)
    expect(entry?.settled).toBe(true)
  })

  it('releases the reservation when the call spent nothing', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })

    await expect(
      withCost(
        db,
        { provider: 'anthropic', operation: 'research', estimateUsd: 5 },
        async () => {
          throw new TransientProviderError('anthropic', 'connect timeout')
        },
        { settings, now: NOW },
      ),
    ).rejects.toBeInstanceOf(TransientProviderError)

    // Four retries of a blip must not add up to a budget gate on $0 of spend.
    expect(await listLedger(db)).toEqual([])
    expect(await monthSpendUsd(db, 'anthropic', NOW)).toBe(0)
  })

  it('keeps spend the provider already charged for on a failed call', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })

    await expect(
      withCost(
        db,
        { provider: 'elevenlabs', operation: 'tts', estimateUsd: 0.5 },
        async () => {
          throw new TransientProviderError('elevenlabs', 'stream aborted', { spentUsd: 0.12 })
        },
        { settings, now: NOW },
      ),
    ).rejects.toThrow()

    expect(await monthSpendUsd(db, 'elevenlabs', NOW)).toBeCloseTo(0.12)
  })

  it('drops a reservation on release', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })
    const ledgerId = await reserve(
      db,
      { provider: 'openai', operation: 'x', estimateUsd: 1 },
      settings,
      NOW,
    )
    await release(db, ledgerId)
    expect(await monthSpendUsd(db, 'openai', NOW)).toBe(0)
  })

  // -------------------------------------------------------------------------
  // Aggregates
  // -------------------------------------------------------------------------

  it('keeps months separate', async () => {
    await recordCost(db, {
      provider: 'anthropic',
      operation: 'february',
      actualUsd: 7,
      occurredAt: new Date('2026-02-28T23:59:59.000Z'),
    })
    await recordCost(db, {
      provider: 'anthropic',
      operation: 'march',
      actualUsd: 2,
      occurredAt: new Date('2026-03-01T00:00:00.000Z'),
    })

    expect(await monthSpendUsd(db, 'anthropic', NOW)).toBeCloseTo(2)
    expect(await monthSpendUsd(db, 'anthropic', new Date('2026-02-10T00:00:00.000Z'))).toBeCloseTo(
      7,
    )
  })

  it('aggregates per provider and in total for the Costs screen', async () => {
    await recordCost(db, { provider: 'anthropic', operation: 'a', actualUsd: 3, occurredAt: NOW })
    await recordCost(db, { provider: 'google', operation: 'b', actualUsd: 1.5, occurredAt: NOW })
    await recordCost(db, { provider: 'google', operation: 'c', actualUsd: 0.5, occurredAt: NOW })

    expect(await monthSpendByProvider(db, NOW)).toEqual({ anthropic: 3, google: 2 })
    expect(await monthTotalUsd(db, NOW)).toBeCloseTo(5)
  })

  it('records uncapped spend without consulting a budget', async () => {
    // Renders are gated by the pre-render confirm, not a monthly cap
    // (spec section 8.1) — but they still have to show up in the ledger.
    await recordCost(db, {
      provider: 'remotion',
      operation: 'render-master',
      projectId: FIXTURE_PROJECT_ID,
      actualUsd: 0.25,
      occurredAt: NOW,
    })

    expect(await monthTotalUsd(db, NOW)).toBeCloseTo(0.25)
    const [entry] = await listLedger(db, { provider: 'remotion' })
    expect(entry?.projectId).toBe(FIXTURE_PROJECT_ID)
  })

  // -------------------------------------------------------------------------
  // Read-only status
  // -------------------------------------------------------------------------

  it('reports what the guard would decide without reserving anything', async () => {
    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })
    await recordCost(db, { provider: 'anthropic', operation: 'p', actualUsd: 9.5, occurredAt: NOW })

    const status = await budgetStatus(db, settings, { estimateUsd: 1, now: NOW })

    expect(status).toMatchObject({
      ceilingUsd: 10,
      wouldRefuse: true,
    })
    expect(status.remainingUsd).toBeCloseTo(0.5)
    // Read-only: asking must not consume budget.
    expect(await listLedger(db)).toHaveLength(1)
  })

  // -------------------------------------------------------------------------
  // Two channels, one ceiling
  // -------------------------------------------------------------------------

  describe('two channels', () => {
    let otherChannelId = ''
    let otherCaseId = ''
    let otherProjectId = ''

    beforeEach(async () => {
      const other =
        (await getChannelBySlug(db, 'second-test')) ??
        (await createChannel(db, {
          name: 'Second test channel',
          handle: null,
          slug: 'second-test',
          settings: DEFAULT_SETTINGS,
          bible: EMPTY_BIBLE,
        }))
      otherChannelId = other.id
      const madeCase = await createCase(db, {
        channelId: otherChannelId,
        title: `Ledger isolation ${Date.now()}`,
        category: 'con',
      })
      otherCaseId = madeCase.id
      otherProjectId = (await createProjectFromCase(db, { caseId: madeCase.id, title: 'On B' })).id
    })

    afterEach(async () => {
      await db.execute(sql`TRUNCATE TABLE ${costLedger}`)
      await db.execute(sql`delete from projects where case_id = ${otherCaseId}`)
      await db.execute(sql`delete from cases where id = ${otherCaseId}`)
    })

    const settings = settingsWith({ budgets: { monthlyCeilingUsd: 10 } })

    async function channelOf(ledgerId: string): Promise<string | null> {
      const [row] = await db
        .select({ channelId: costLedger.channelId })
        .from(costLedger)
        .where(eq(costLedger.id, ledgerId))
      return row?.channelId ?? null
    }

    it('writes the project channel on a reservation that names only the project', async () => {
      const onB = await reserve(
        db,
        { provider: 'anthropic', operation: 'a', projectId: otherProjectId, estimateUsd: 1 },
        settings,
        NOW,
      )
      const onA = await reserve(
        db,
        { provider: 'anthropic', operation: 'b', projectId: FIXTURE_PROJECT_ID, estimateUsd: 1 },
        settings,
        NOW,
      )
      expect(await channelOf(onB)).toBe(otherChannelId)
      expect(await channelOf(onA)).toBe(FIRST_CHANNEL_ID)
    })

    it('writes a named channel when there is no project, and none for workspace spend', async () => {
      const named = await reserve(
        db,
        { provider: 'anthropic', operation: 'a', channelId: otherChannelId, estimateUsd: 1 },
        settings,
        NOW,
      )
      const workspace = await reserve(
        db,
        { provider: 'anthropic', operation: 'b', estimateUsd: 1 },
        settings,
        NOW,
      )
      expect(await channelOf(named)).toBe(otherChannelId)
      expect(await channelOf(workspace)).toBeNull()
    })

    it('records unguarded spend against the project channel', async () => {
      const id = await recordCost(db, {
        provider: 'remotion',
        operation: 'render-master',
        projectId: otherProjectId,
        actualUsd: 0.25,
        occurredAt: NOW,
      })
      expect(await channelOf(id)).toBe(otherChannelId)
    })

    it("never lists channel B's projects or providers in channel A's breakdowns", async () => {
      await recordCost(db, {
        provider: 'anthropic',
        operation: 'a',
        projectId: FIXTURE_PROJECT_ID,
        actualUsd: 2,
        occurredAt: NOW,
      })
      await recordCost(db, {
        provider: 'google',
        operation: 'b',
        projectId: otherProjectId,
        actualUsd: 3,
        occurredAt: NOW,
      })

      const byProject = await monthSpendByProject(db, NOW, FIRST_CHANNEL_ID)
      expect(byProject.map((row) => row.projectId)).toEqual([FIXTURE_PROJECT_ID])
      expect((await monthSpendByProject(db, NOW, otherChannelId)).map((r) => r.projectId)).toEqual([
        otherProjectId,
      ])
      expect(await monthSpendByProvider(db, NOW, FIRST_CHANNEL_ID)).toEqual({ anthropic: 2 })
      expect(await monthSpendByProvider(db, NOW, otherChannelId)).toEqual({ google: 3 })
      // No channel asked for: the workspace, as before.
      expect(await monthSpendByProvider(db, NOW)).toEqual({ anthropic: 2, google: 3 })
      expect(
        (await listLedger(db, { channelId: FIRST_CHANNEL_ID })).map((e) => e.provider),
      ).toEqual(['anthropic'])
    })

    it("sums every other channel's rows, workspace spend included, for monthOtherChannelsUsd", async () => {
      await recordCost(db, {
        provider: 'anthropic',
        operation: 'a',
        projectId: FIXTURE_PROJECT_ID,
        actualUsd: 2,
        occurredAt: NOW,
      })
      await recordCost(db, {
        provider: 'google',
        operation: 'b',
        projectId: otherProjectId,
        actualUsd: 3,
        occurredAt: NOW,
      })
      await recordCost(db, { provider: 'openai', operation: 'c', actualUsd: 0.5, occurredAt: NOW })

      expect(await monthOtherChannelsUsd(db, NOW, FIRST_CHANNEL_ID)).toBeCloseTo(3.5)
      expect(await monthOtherChannelsUsd(db, NOW, otherChannelId)).toBeCloseTo(2.5)
      // The guard's own total stays the workspace's.
      expect(await monthTotalUsd(db, NOW)).toBeCloseTo(5.5)
    })

    it('parks a reservation on B once A has spent to the one ceiling', async () => {
      await recordCost(db, {
        provider: 'anthropic',
        operation: 'a',
        projectId: FIXTURE_PROJECT_ID,
        actualUsd: 9.5,
        occurredAt: NOW,
      })

      await expect(
        reserve(
          db,
          { provider: 'anthropic', operation: 'b', projectId: otherProjectId, estimateUsd: 1 },
          settings,
          NOW,
        ),
      ).rejects.toBeInstanceOf(BudgetExceededError)
      // The refused reservation left nothing behind.
      expect(await listLedger(db, { channelId: otherChannelId })).toEqual([])
    })
  })
})
