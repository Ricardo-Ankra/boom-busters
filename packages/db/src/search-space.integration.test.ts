import { DEFAULT_SETTINGS, EMPTY_BIBLE } from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createChannel } from './channels'
import { createDb } from './client'
import type { SearchSpaceRow } from './schema'
import {
  durationSpread,
  latestSearchSpace,
  saveSearchSpace,
  searchSpaceKeywords,
} from './search-space'
import { channelBibles, channelSearchSpace, channels } from './schema'
import { requireTestDatabase } from './test-database'

describe('durationSpread', () => {
  it('gives the shortest, middle and longest', () => {
    expect(durationSpread([600, 7200, 5400])).toEqual({
      minSec: 600,
      medianSec: 5400,
      maxSec: 7200,
    })
  })
  it('takes the lower middle of an even list', () => {
    expect(durationSpread([100, 200, 300, 400])?.medianSec).toBe(200)
  })
  it('is null for an empty list', () => {
    expect(durationSpread([])).toBeNull()
  })
})

describe('searchSpaceKeywords', () => {
  const now = new Date('2026-11-03T12:00:00Z')
  const rowAt = (daysAgo: number) =>
    ({ measuredAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000) }) as SearchSpaceRow

  it('leaves out keywords analysed in 30 days and repeats, keeping order', () => {
    const latest = new Map([
      ['fresh', rowAt(29)],
      ['stale', rowAt(31)],
    ])
    expect(
      searchSpaceKeywords(['Alpha', 'alpha', 'Fresh', 'Stale', ' ', 'Beta'], latest, now),
    ).toEqual(['Alpha', 'Stale', 'Beta'])
  })
})

/** Search-space rows against a real database. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const NOW = new Date('2026-11-03T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

suite('search space', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''

  const row = (keyword: string, measuredAt: Date, patterns: string[] = ['A']) => ({
    channelId,
    keyword,
    measuredAt,
    outliers: [],
    titlePatterns: patterns,
    durations: null,
    credits: 10,
  })

  beforeEach(async () => {
    await db.execute(
      dsql`truncate table ${channelSearchSpace}, ${channels}, ${channelBibles} restart identity cascade`,
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
    await sql.end()
  })

  it('keeps the latest row per keyword, compared without case', async () => {
    await saveSearchSpace(db, row('Heist Stories', daysAgo(40), ['old']))
    await saveSearchSpace(db, row('heist stories', daysAgo(2), ['new']))
    const latest = await latestSearchSpace(db, channelId)
    expect(latest.size).toBe(1)
    expect(latest.get('heist stories')?.titlePatterns).toEqual(['new'])
  })

  it('round-trips outliers and durations', async () => {
    await saveSearchSpace(db, {
      ...row('k', daysAgo(1)),
      outliers: [
        {
          videoId: 'v1',
          title: 'T',
          channel: 'C',
          views: 10,
          breakoutScore: 3,
          durationSec: 600,
        },
      ],
      durations: { minSec: 600, medianSec: 600, maxSec: 600 },
    })
    const got = (await latestSearchSpace(db, channelId)).get('k')
    expect(got?.outliers[0]?.durationSec).toBe(600)
    expect(got?.durations?.medianSec).toBe(600)
  })

  it('keeps channels apart', async () => {
    await saveSearchSpace(db, row('k', daysAgo(1)))
    expect((await latestSearchSpace(db, '01HZZZZZZZZZZZZZZZZZZZZZZZ')).size).toBe(0)
  })
})
