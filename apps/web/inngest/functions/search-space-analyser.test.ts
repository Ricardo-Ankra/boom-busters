// @vitest-environment node

import {
  channelSearchSpace,
  latestSearchSpace,
  requireTestDatabase,
  saveSearchSpace,
  seed,
  truncateRunMirror,
  updateWorkspace,
  vidiqCredits,
} from '@boom-busters/db'
import { DEFAULT_WORKSPACE_SETTINGS, FIRST_CHANNEL_ID } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { searchSpaceAnalyser } from './search-space-analyser'

/**
 * The search-space analyser in mock-provider mode against the real database:
 * one row per keyword with its title patterns and duration spread (durations
 * from the mock YouTube fixture, never the live API), the VidIQ ledger rows
 * for the two paid calls, and no spend for a keyword analysed inside the
 * stale window.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('search-space-analyser (mock mode)', () => {
  let engine: InngestTestEngine

  const request = (
    keywords: string[],
  ): { events: [{ name: string; data: { channelId: string; keywords: string[] } }] } => ({
    events: [
      {
        name: 'channel/search-space.analyse',
        data: { channelId: FIRST_CHANNEL_ID, keywords },
      },
    ],
  })

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    engine = new InngestTestEngine({ function: searchSpaceAnalyser })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    await db.delete(vidiqCredits)
    await db.delete(channelSearchSpace)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await db.delete(channelSearchSpace)
  })

  it('saves one row per keyword with its patterns, durations and 10 credits', async () => {
    const { result } = await engine.execute(request(['wework documentary', 'heist stories']))
    expect(result).toEqual({ analysed: 2, credits: 20 })

    const rows = await db.select().from(channelSearchSpace)
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.channelId === FIRST_CHANNEL_ID && r.credits === 10)).toBe(true)

    const latest = await latestSearchSpace(db, FIRST_CHANNEL_ID)
    const row = latest.get('wework documentary')
    expect(row?.titlePatterns).toEqual([
      'The Rise and Fall of {subject}',
      'From {figure} to Nothing: How {subject} Lost Everything',
    ])
    expect(row?.outliers.length).toBeGreaterThan(0)
    // The mock YouTube source gives every video 10 minutes.
    expect(row?.outliers.every((o) => o.durationSec === 600)).toBe(true)
    expect(row?.durations).toEqual({ minSec: 600, medianSec: 600, maxSec: 600 })
  })

  it('writes a ledger row for the outliers and the details, 5 credits each', async () => {
    await engine.execute(request(['wework documentary']))
    const ledger = await db.select().from(vidiqCredits)
    expect(ledger.map((r) => r.tool).sort()).toEqual(['vidiq_get_videos_by_ids', 'vidiq_outliers'])
    expect(ledger.every((r) => r.purpose === 'search-space' && r.credits === 5)).toBe(true)
  })

  it('analyses a keyword listed twice once, and skips one analysed inside the window', async () => {
    await saveSearchSpace(db, {
      channelId: FIRST_CHANNEL_ID,
      keyword: 'fresh',
      measuredAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      outliers: [],
      titlePatterns: [],
      durations: null,
      credits: 10,
    })
    const { result } = await engine.execute(request(['Alpha', 'alpha', 'fresh']))
    expect(result).toEqual({ analysed: 1, credits: 10 })
    expect(await db.select().from(vidiqCredits)).toHaveLength(2)
    expect(await db.select().from(channelSearchSpace)).toHaveLength(2)
  })

  it('stops at the monthly cap, keeping the rows already saved', async () => {
    await updateWorkspace(db, {
      ...DEFAULT_WORKSPACE_SETTINGS,
      vidiq: { ...DEFAULT_WORKSPACE_SETTINGS.vidiq, monthlyCreditCap: 10 },
    })
    const { error } = await engine.execute(request(['one', 'two']))
    expect(JSON.stringify(error)).toContain('The VidIQ cap is reached')
    expect(await db.select().from(channelSearchSpace)).toHaveLength(1)
  })
})
