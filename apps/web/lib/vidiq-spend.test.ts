// @vitest-environment node

import {
  FIXTURE_PROJECT_ID,
  requireTestDatabase,
  seed,
  updateWorkspace,
  vidiqCredits,
} from '@boom-busters/db'
import { DEFAULT_WORKSPACE_SETTINGS, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { checkVidiqBudget, spendVidiq, VidiqCapReached } from './vidiq-spend'

/**
 * The shared VidIQ budget check and spend path, in mock-provider mode against
 * the real database: the cap is checked before any call, and the ledger holds
 * the purpose and the wire arguments of every call that returned.
 */

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('vidiq-spend (mock mode)', () => {
  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    await seed(db)
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    await db.delete(vidiqCredits)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const input = {
    channelId: FIRST_CHANNEL_ID,
    purpose: 'case-research' as const,
    tool: 'vidiq_keyword_research',
    cost: 5,
  }

  describe('checkVidiqBudget', () => {
    it('answers with the balance and what is left of the cap', async () => {
      expect(await checkVidiqBudget(20)).toEqual({ ok: true, balance: 1443, capLeft: 1000 })
    })

    it('refuses on the cap first, with the numbers', async () => {
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 10 } })
      expect(await checkVidiqBudget(20)).toEqual({
        ok: false,
        error: "This run needs about 20 credits; 10 are left of this month's cap of 10.",
        capped: true,
      })
    })

    it('refuses on the balance, with the numbers', async () => {
      await updateWorkspace(db, {
        ...DEFAULT_WORKSPACE_SETTINGS,
        vidiq: { monthlyCreditCap: 100_000 },
      })
      expect(await checkVidiqBudget(2000)).toEqual({
        ok: false,
        error: 'This run needs about 2000 credits; the VidIQ balance is 1443.',
      })
    })
  })

  describe('spendVidiq', () => {
    it('refuses at the cap before any call is made', async () => {
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 3 } })
      const call = vi.fn()
      await expect(spendVidiq(input, call)).rejects.toThrow(
        'The VidIQ cap is reached: 0 of 3 credits used this month',
      )
      expect(call).not.toHaveBeenCalled()
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)
    })

    it('throws VidiqCapReached at the cap', async () => {
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 3 } })
      await expect(spendVidiq(input, vi.fn())).rejects.toBeInstanceOf(VidiqCapReached)
    })

    it('keeps the NonRetriableError name so Inngest still stops retrying', async () => {
      await updateWorkspace(db, { ...DEFAULT_WORKSPACE_SETTINGS, vidiq: { monthlyCreditCap: 3 } })
      const error = await spendVidiq(input, vi.fn()).catch((e: unknown) => e)
      expect((error as Error).name).toBe('NonRetriableError')
    })

    it('writes a row with the purpose, the tool and the wire arguments', async () => {
      const result = await spendVidiq(input, (client) =>
        client.keywordResearch('wework', { mode: 'matching_terms', limit: 20 }),
      )
      expect(result.data.length).toBeGreaterThan(0)
      const rows = await db.select().from(vidiqCredits)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        channelId: FIRST_CHANNEL_ID,
        projectId: null,
        purpose: 'case-research',
        tool: 'vidiq_keyword_research',
        args: result.args,
        credits: result.credits,
      })
      expect(rows[0]?.args).toMatchObject({ mode: 'matching_terms' })
    })

    it('attributes the row to a project when given one', async () => {
      await spendVidiq({ ...input, projectId: FIXTURE_PROJECT_ID, purpose: 'title-score' }, () =>
        Promise.resolve({ data: 1, credits: 5, args: { title: 'x' } }),
      )
      const [row] = await db.select().from(vidiqCredits)
      expect(row).toMatchObject({ projectId: FIXTURE_PROJECT_ID, purpose: 'title-score' })
    })

    it('writes no row for a call that threw', async () => {
      await expect(
        spendVidiq(input, () => Promise.reject(new Error('VidIQ is down'))),
      ).rejects.toThrow('VidIQ is down')
      expect(await db.select().from(vidiqCredits)).toHaveLength(0)
    })
  })
})
