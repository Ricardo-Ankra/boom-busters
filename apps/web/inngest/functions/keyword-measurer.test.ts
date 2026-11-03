// @vitest-environment node

import {
  latestKeywordMeasurements,
  recordKeywordMeasurement,
  requireTestDatabase,
  seed,
  truncateRunMirror,
  updateWorkspace,
  vidiqCredits,
  keywordMeasurements,
} from '@boom-busters/db'
import type * as VidiqModule from '@boom-busters/providers/vidiq'
import { DEFAULT_WORKSPACE_SETTINGS, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { keywordMeasurer } from './keyword-measurer'

/**
 * The keyword measurer in mock-provider mode against the real database: one
 * ledger row and one measurement per keyword, the reading taken from the row
 * VidIQ returns for that keyword (nulls when it has none), and no spend for a
 * keyword already measured inside the stale window.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const seams = vi.hoisted(() => ({
  clientOverride: null as null | ((real: unknown) => unknown),
}))

vi.mock('@boom-busters/providers/vidiq', async (importOriginal) => {
  const original = await importOriginal<typeof VidiqModule>()
  return {
    ...original,
    vidiqClientFor: (key: string | undefined) => {
      const real = original.vidiqClientFor(key)
      return seams.clientOverride ? seams.clientOverride(real) : real
    },
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('keyword-measurer (mock mode)', () => {
  let engine: InngestTestEngine

  const request = (
    keywords: string[],
  ): { events: [{ name: string; data: { channelId: string; keywords: string[] } }] } => ({
    events: [
      {
        name: 'channel/keywords.measure',
        data: { channelId: FIRST_CHANNEL_ID, keywords },
      },
    ],
  })

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    seams.clientOverride = null
    engine = new InngestTestEngine({ function: keywordMeasurer })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    await db.delete(vidiqCredits)
    await db.delete(keywordMeasurements)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await db.delete(keywordMeasurements)
  })

  it('records one measurement and one ledger row per keyword, 5 credits each', async () => {
    const { result } = await engine.execute(request(['wework documentary', 'no such term']))
    expect(result).toEqual({ measured: 2, credits: 10 })

    const rows = await db.select().from(keywordMeasurements)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.channelId === FIRST_CHANNEL_ID && r.credits === 5)).toBe(true)

    const latest = await latestKeywordMeasurements(db, FIRST_CHANNEL_ID)
    // The fixture row for this keyword carries the figures the card shows.
    expect(latest.get('wework documentary')).toMatchObject({
      volume: 64,
      competition: 38,
      overall: 63,
      estimatedMonthlySearch: 18355,
    })
    // VidIQ returned no row for this one: unknown, not zero.
    expect(latest.get('no such term')).toMatchObject({
      volume: null,
      competition: null,
      overall: null,
      estimatedMonthlySearch: null,
    })

    const ledger = await db.select().from(vidiqCredits)
    expect(ledger).toHaveLength(2)
    expect(
      ledger.every((r) => r.purpose === 'keyword-measure' && r.tool === 'vidiq_keyword_research'),
    ).toBe(true)
    expect(ledger.map((r) => (r.args as { limit?: number; mode?: string }).limit)).toEqual([1, 1])
    expect((ledger[0]?.args as { mode?: string }).mode).toBe('matching_terms')
  })

  it('reads the row whose keyword equals the one asked, ignoring case', async () => {
    const row = (keyword: string, volume: number) => ({
      keyword,
      volume,
      competition: 20,
      overall: 50,
      estimatedMonthlySearch: null,
      growthPct: null,
    })
    seams.clientOverride = (real) => ({
      ...(real as object),
      keywordResearch: async () => ({
        data: [row('something else', 99), row('WeWork Podcast', 41)],
        credits: 5,
        args: { mode: 'matching_terms', limit: 1 },
      }),
    })
    await engine.execute(request(['wework podcast']))
    const latest = await latestKeywordMeasurements(db, FIRST_CHANNEL_ID)
    expect(latest.get('wework podcast')?.volume).toBe(41)
  })

  it('measures a keyword listed twice once, and skips one measured inside the window', async () => {
    await recordKeywordMeasurement(db, {
      channelId: FIRST_CHANNEL_ID,
      keyword: 'fresh',
      volume: 10,
      competition: 10,
      overall: 10,
      estimatedMonthlySearch: 10,
      credits: 5,
      measuredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    })
    const { result } = await engine.execute(request(['Alpha', 'alpha', 'fresh']))
    expect(result).toEqual({ measured: 1, credits: 5 })
    expect(await db.select().from(vidiqCredits)).toHaveLength(1)
    expect(await db.select().from(keywordMeasurements)).toHaveLength(2)
  })

  it('stops at the monthly cap, keeping the readings already taken', async () => {
    await updateWorkspace(db, {
      ...DEFAULT_WORKSPACE_SETTINGS,
      vidiq: { ...DEFAULT_WORKSPACE_SETTINGS.vidiq, monthlyCreditCap: 5 },
    })
    const { error } = await engine.execute(request(['one', 'two']))
    expect(JSON.stringify(error)).toContain('The VidIQ cap is reached')
    expect(await db.select().from(keywordMeasurements)).toHaveLength(1)
  })
})
