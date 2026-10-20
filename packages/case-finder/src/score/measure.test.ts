import { describe, expect, it } from 'vitest'
import type {
  ChannelUploads,
  DailyViews,
  EntryEvidence,
  MonthlyViews,
  YoutubeVideo,
} from '../types'
import { measure, outlierRatio, titleMatches } from './measure'

const T = '2020-03-15'

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** `count` consecutive months starting at `from` ('YYYY-MM'), all with the same views. */
function months(from: string, count: number, views: number): MonthlyViews[] {
  const [y, m] = from.split('-').map(Number) as [number, number]
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    return { month: d.toISOString().slice(0, 7), views }
  })
}

function days(from: string, count: number, views: number): DailyViews[] {
  return Array.from({ length: count }, (_, i) => ({ date: addDays(from, i), views }))
}

function video(over: Partial<YoutubeVideo> & { id: string }): YoutubeVideo {
  return {
    channelId: 'c1',
    title: 'The Fall of Apple',
    publishedAt: '2019-06-01',
    durationSec: 900,
    views: 1000,
    ...over,
  }
}

function evidence(over: Partial<EntryEvidence> = {}): EntryEvidence {
  return {
    entry: {
      qid: 'Q1',
      enTitle: 'Apple',
      query: 'Apple',
      sitelinks: {},
      tags: [],
      country: null,
      cik: null,
    },
    asOf: T,
    enMonthly: [],
    worldMonthly: [],
    enDaily: [],
    search: null,
    channels: {},
    documents: [],
    people: [],
    tagsAtT: [],
    ...over,
  }
}

function withSearch(videos: YoutubeVideo[], channels: Record<string, ChannelUploads> = {}) {
  return evidence({ search: { fetchedAt: '2020-03-10', videos }, channels })
}

describe('demand and world', () => {
  it('demand uses the median, so one spike month does not move it', () => {
    const series = months('2018-03', 24, 100)
    series[10] = { month: series[10]!.month, views: 5_000_000 }
    const m = measure(evidence({ enMonthly: series }))
    expect(m.enMedianMonthly).toBe(100)
    expect(m.demand).toBeCloseTo(Math.log10(101), 10)
  })

  it('missing months count as zero', () => {
    // 11 present months of 1000 and 13 missing: the median of 24 values is 0.
    const few = measure(evidence({ enMonthly: months('2019-04', 11, 1000) }))
    expect(few.enMedianMonthly).toBe(0)
    // 13 present months of 1000 and 11 missing: the median is 1000.
    const many = measure(evidence({ enMonthly: months('2019-02', 13, 1000) }))
    expect(many.enMedianMonthly).toBe(1000)
  })

  it('no English article gives demand 0 and still computes world', () => {
    const m = measure(evidence({ enMonthly: [], worldMonthly: months('2018-03', 24, 999) }))
    expect(m.demand).toBe(0)
    expect(m.enMedianMonthly).toBe(0)
    expect(m.world).toBeCloseTo(3, 10)
  })

  it('a month exactly 24 months back counts, the 25th and the as-of month do not', () => {
    // 2018-03 plus 2019-03..2020-02 is 13 values of 10 among 24: the median is 10.
    const counted = [...months('2018-03', 1, 10), ...months('2019-03', 12, 10)]
    expect(measure(evidence({ enMonthly: counted })).enMedianMonthly).toBe(10)
    // Without 2018-03 there are 12 of 24, so the median is the mean of 0 and 10. So 2018-03 was read.
    expect(measure(evidence({ enMonthly: months('2019-03', 12, 10) })).enMedianMonthly).toBe(5)
    // 2018-02 (the 25th) and 2020-03 onward (T's month and later) never count, however large.
    const outside = [
      { month: '2018-02', views: 1_000_000 },
      { month: '2020-03', views: 1_000_000 },
      { month: '2020-04', views: 1_000_000 },
    ]
    const withOutside = measure(evidence({ enMonthly: [...months('2019-03', 12, 10), ...outside] }))
    expect(withOutside.enMedianMonthly).toBe(5)
  })

  it('world uses the same window on its own series', () => {
    const m = measure(
      evidence({
        enMonthly: months('2018-03', 24, 10),
        worldMonthly: [...months('2018-03', 24, 99), { month: '2020-03', views: 1e9 }],
      }),
    )
    expect(m.world).toBeCloseTo(2, 10)
  })
})

describe('spike', () => {
  const baseline = () => days(addDays(T, -379), 365, 10)

  it('is the recent 14-day sum over the median baseline 14-day sum', () => {
    const m = measure(evidence({ enDaily: [...baseline(), ...days(addDays(T, -14), 14, 20)] }))
    expect(m.spike).toBeCloseTo(2, 10)
  })

  it('T-14 counts in recent, T-15 does not, and T itself is never read', () => {
    const recent = days(addDays(T, -14), 14, 0)
    const withDay = (date: string, views: number) => [
      ...baseline().filter((d) => d.date !== date),
      ...recent.filter((d) => d.date !== date),
      { date, views },
    ]
    expect(measure(evidence({ enDaily: withDay(addDays(T, -14), 500) })).spike).toBeCloseTo(
      500 / 140,
      10,
    )
    expect(measure(evidence({ enDaily: withDay(addDays(T, -15), 500) })).spike).toBe(0)
    expect(measure(evidence({ enDaily: withDay(T, 500) })).spike).toBe(0)
  })

  it('the baseline reaches back to T-379 and no further', () => {
    const recent = days(addDays(T, -14), 14, 10)
    // 176 days of 1 from T-379 make 176 of the 352 sliding sums non-zero, so the median is non-zero.
    const inside = measure(evidence({ enDaily: [...days(addDays(T, -379), 176, 1), ...recent] }))
    expect(inside.spike).toBeGreaterThan(0)
    // The same 176 days from T-380 lose the first day: 175 non-zero sums, median 0, spike 0.
    const shifted = measure(evidence({ enDaily: [...days(addDays(T, -380), 176, 1), ...recent] }))
    expect(shifted.spike).toBe(0)
  })

  it('the baseline is exactly 352 sums: it ends at T-15 and starts at T-379', () => {
    // Day T-380+k holds k views for k = 1..365, so the baseline days T-379..T-15 hold 1..365.
    // The sum starting at k is 14k + 91 for k = 1..352; the median of those is 2562.
    // A baseline that stopped a day early (351 sums) would give 2555, one that ran a day
    // into the recent window (353 sums) 2569. Recent is 14 x 366 = 5124, so spike is exactly 2.
    const ramp = Array.from({ length: 365 }, (_, i) => ({
      date: addDays(T, -379 + i),
      views: i + 1,
    }))
    const m = measure(evidence({ enDaily: [...ramp, ...days(addDays(T, -14), 14, 366)] }))
    expect(m.spike).toBe(5124 / 2562)
    expect(m.spike).toBe(2)
  })

  it('spike is 0 when the baseline is 0', () => {
    const m = measure(evidence({ enDaily: days(addDays(T, -14), 14, 500) }))
    expect(m.spike).toBe(0)
  })
})

describe('titleMatches', () => {
  it('titleMatches is whole-word and case-insensitive', () => {
    expect(titleMatches('Apple', 'The Fall of APPLE')).toBe(true)
    expect(titleMatches('Apple', "Applebee's Collapse")).toBe(false)
    expect(titleMatches('Apple', 'pineapple empire')).toBe(false)
    expect(titleMatches('Apple', "Apple's empire")).toBe(true)
  })

  it('an empty or whitespace query matches nothing', () => {
    expect(titleMatches('', 'anything')).toBe(false)
    expect(titleMatches('   ', 'anything at all')).toBe(false)
  })
})

describe('outlierRatio', () => {
  it('divides by the median of the channel long-form uploads, excluding the video itself', () => {
    const v = video({ id: 'x', views: 3000 })
    const channel: ChannelUploads = {
      channelId: 'c1',
      uploads: [
        v,
        video({ id: 'a', views: 1000 }),
        video({ id: 'b', views: 500 }),
        video({ id: 'short', views: 9_999_999, durationSec: 59 }),
      ],
    }
    expect(outlierRatio(v, channel, T)).toBe(3000 / 750)
  })

  it('is null without the channel, without peers, or with a zero median', () => {
    const v = video({ id: 'x' })
    expect(outlierRatio(v, undefined, T)).toBeNull()
    expect(outlierRatio(v, { channelId: 'c1', uploads: [v] }, T)).toBeNull()
    const zeros = { channelId: 'c1', uploads: [video({ id: 'a', views: 0 })] }
    expect(outlierRatio(v, zeros, T)).toBeNull()
  })
})

describe('coverage', () => {
  it('is null when search is null and 0 when the query is null', () => {
    expect(measure(evidence()).coverage).toBeNull()
    const e = withSearch([video({ id: 'a' })])
    e.entry.query = null
    expect(measure(e).coverage).toBe(0)
  })

  it('a null ratio counts as 1', () => {
    expect(measure(withSearch([video({ id: 'a' }), video({ id: 'b' })])).coverage).toBe(2)
  })

  it('coverage ignores Shorts, later videos and videos older than 24 months', () => {
    const videos = [
      video({ id: 'ok' }),
      video({ id: 'short', durationSec: 479 }),
      video({ id: 'long-enough', durationSec: 480 }),
      video({ id: 'on-T', publishedAt: T }),
      video({ id: 'after', publishedAt: '2020-04-01' }),
      video({ id: 'day-before', publishedAt: '2020-03-14' }),
      video({ id: 'boundary', publishedAt: '2018-03-15' }),
      video({ id: 'too-old', publishedAt: '2018-03-14' }),
      video({ id: 'other-topic', title: 'Pineapple prices' }),
    ]
    // ok, long-enough, day-before and boundary count 1 each.
    expect(measure(withSearch(videos)).coverage).toBe(4)
  })

  it('the 24-month boundary clamps a missing day to the end of the month', () => {
    const e = withSearch([
      video({ id: 'in', publishedAt: '2018-02-28' }),
      video({ id: 'out', publishedAt: '2018-02-27' }),
    ])
    e.asOf = '2020-02-29'
    expect(measure(e).coverage).toBe(1)
  })

  it('outlier ratio is capped at 5 in coverage', () => {
    const big = video({ id: 'big', views: 1_000_000 })
    const channels = {
      c1: {
        channelId: 'c1',
        uploads: [big, video({ id: 'p1', views: 100 }), video({ id: 'p2', views: 100 })],
      },
    }
    expect(measure(withSearch([big], channels)).coverage).toBe(5)
    const modest = video({ id: 'modest', views: 200 })
    const channels2 = {
      c1: { channelId: 'c1', uploads: [modest, video({ id: 'p1', views: 100 })] },
    }
    expect(measure(withSearch([modest], channels2)).coverage).toBe(2)
  })
})
