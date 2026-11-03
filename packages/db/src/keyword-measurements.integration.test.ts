import { DEFAULT_SETTINGS, EMPTY_BIBLE, defaultFormat } from '@boom-busters/schemas'
import type { ChannelBible } from '@boom-busters/schemas'
import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createChannel } from './channels'
import { createDb } from './client'
import {
  keywordsToMeasure,
  latestKeywordMeasurements,
  recordKeywordMeasurement,
} from './keyword-measurements'
import { channelBibles, channels, keywordMeasurements } from './schema'
import { requireTestDatabase } from './test-database'

/** Keyword measurements against a real database. */
const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const NOW = new Date('2026-11-03T12:00:00Z')
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

suite('keyword measurements', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let channelId = ''

  const reading = (keyword: string, measuredAt: Date, volume: number | null = 50) => ({
    channelId,
    keyword,
    volume,
    competition: 30,
    overall: 60,
    estimatedMonthlySearch: 1000,
    credits: 5,
    measuredAt,
  })

  const bible = (formatKeywords: string[], pillarKeywords: string[]): ChannelBible => ({
    ...EMPTY_BIBLE,
    formats: [{ ...defaultFormat('Main'), primary: true, keywords: formatKeywords }],
    caseCategories: [{ key: 'con', label: 'Con', keywords: pillarKeywords }],
  })

  beforeEach(async () => {
    await db.execute(
      dsql`truncate table ${keywordMeasurements}, ${channels}, ${channelBibles} restart identity cascade`,
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

  it('keeps every measurement and returns the latest per keyword, keyed in lower case', async () => {
    await recordKeywordMeasurement(db, reading('WeWork Documentary', daysAgo(40), 10))
    await recordKeywordMeasurement(db, reading('wework documentary', daysAgo(2), 64))
    await recordKeywordMeasurement(db, reading('other', daysAgo(5), null))

    const latest = await latestKeywordMeasurements(db, channelId)
    expect([...latest.keys()].sort()).toEqual(['other', 'wework documentary'])
    expect(latest.get('wework documentary')?.volume).toBe(64)
    expect(latest.get('other')?.volume).toBeNull()
    expect(await db.select().from(keywordMeasurements)).toHaveLength(3)
  })

  it('reads only the channel asked for', async () => {
    const other = await createChannel(db, {
      name: 'B',
      handle: null,
      slug: 'b',
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    await recordKeywordMeasurement(db, { ...reading('mine', daysAgo(1)), channelId: other.id })
    expect((await latestKeywordMeasurements(db, channelId)).size).toBe(0)
  })

  it('keywordsToMeasure skips a keyword measured 10 days ago and includes one measured 31 days ago', async () => {
    await recordKeywordMeasurement(db, reading('recent', daysAgo(10)))
    await recordKeywordMeasurement(db, reading('old', daysAgo(31)))
    const latest = await latestKeywordMeasurements(db, channelId)
    expect(keywordsToMeasure(bible(['recent', 'old', 'new'], []), latest, NOW)).toEqual([
      'old',
      'new',
    ])
  })

  it('keywordsToMeasure covers format and pillar keywords once, ignoring case', async () => {
    const latest = await latestKeywordMeasurements(db, channelId)
    expect(
      keywordsToMeasure(bible(['Alpha', 'beta'], ['ALPHA', 'gamma', ' beta ', '']), latest, NOW),
    ).toEqual(['Alpha', 'beta', 'gamma'])
  })
})
