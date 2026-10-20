import { describe, expect, it } from 'vitest'
import { FLOOR_MEDIAN_MONTHLY, RANKED_PER_LANE } from '../config'
import type {
  DailyViews,
  DatedTag,
  EntryEvidence,
  Lane,
  MonthlyViews,
  PrimaryDocument,
  YoutubeVideo,
} from '../types'
import { KILL_LEGAL, KILL_NO_RECORD } from './gates'
import { classify, populationAt, rank } from './rank'

const T = '2020-03-15'

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 24 months before T's month (2018-03 to 2020-02), all with the same views. */
function monthly(views: number): MonthlyViews[] {
  return Array.from({ length: 24 }, (_, i) => ({
    month: new Date(Date.UTC(2018, 2 + i, 1)).toISOString().slice(0, 7),
    views,
  }))
}

/** A flat 1 view a day for the baseline year, then `mult` a day for the 14 days before T: spike = mult. */
function daily(mult: number): DailyViews[] {
  const start = addDays(T, -379)
  return Array.from({ length: 379 }, (_, i) => ({
    date: addDays(start, i),
    views: i < 365 ? 1 : mult,
  }))
}

/** `count` long-form videos in the coverage window whose titles match the query 'Apple'. */
function videos(count: number): YoutubeVideo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `v${i}`,
    channelId: 'c1',
    title: 'The Fall of Apple',
    publishedAt: '2019-06-01',
    durationSec: 900,
    views: 1000,
  }))
}

function docs(count: number): PrimaryDocument[] {
  return Array.from({ length: count }, (_, i) => ({
    url: `https://example.gov/doc-${i}`,
    title: `Document ${i}`,
    source: 'courtlistener' as const,
    datedAt: '2019-01-01',
  }))
}

interface Spec {
  demand?: number
  world?: number
  spike?: number
  coverage?: number | null
  lane?: Lane | null
  documents?: PrimaryDocument[]
  living?: boolean
}

function entry(qid: string, spec: Spec = {}): EntryEvidence {
  const lane = spec.lane === undefined ? 'downfall' : spec.lane
  const tagsAtT: DatedTag[] = lane === null ? [] : [{ tag: 'seed', lane, since: null }]
  const coverage = spec.coverage === undefined ? 1 : spec.coverage
  return {
    entry: {
      qid,
      enTitle: 'Apple',
      query: 'Apple',
      sitelinks: {},
      tags: tagsAtT,
      country: null,
      cik: null,
    },
    asOf: T,
    enMonthly: monthly(spec.demand ?? 1000),
    worldMonthly: monthly(spec.world ?? 1000),
    enDaily: daily(spec.spike ?? 1),
    search: coverage === null ? null : { fetchedAt: T, videos: videos(coverage) },
    channels: {},
    documents: spec.documents ?? docs(3),
    people: spec.living ? [{ qid: 'P1', name: 'A Person', living: true, convicted: false }] : [],
    tagsAtT,
  }
}

describe('rank', () => {
  it('the score is the weighted sum of within-lane percentiles', () => {
    // Percentiles within the lane of three, written out by hand:
    //        D    cov-pct -> G    S    W
    //   A    0    100     -> 0    100  0
    //   B    50   0       -> 100  0    100
    //   C    100  50      -> 50   50   50
    const result = rank([
      entry('Q1', { demand: 1000, coverage: 3, spike: 3, world: 100 }),
      entry('Q2', { demand: 2000, coverage: 1, spike: 1, world: 400 }),
      entry('Q3', { demand: 4000, coverage: 2, spike: 2, world: 200 }),
    ]).downfall
    const by = new Map(result.shortlist.map((s) => [s.qid, s]))
    expect(by.get('Q1')!.pct).toEqual({ D: 0, G: 0, S: 100, W: 0 })
    expect(by.get('Q2')!.pct).toEqual({ D: 50, G: 100, S: 0, W: 100 })
    expect(by.get('Q3')!.pct).toEqual({ D: 100, G: 50, S: 50, W: 50 })
    // A: .4*0   + .3*0   + .15*100 + .15*0   = 15
    // B: .4*50  + .3*100 + .15*0   + .15*100 = 65
    // C: .4*100 + .3*50  + .15*50  + .15*50  = 70
    expect(by.get('Q1')!.score).toBeCloseTo(15, 10)
    expect(by.get('Q2')!.score).toBeCloseTo(65, 10)
    expect(by.get('Q3')!.score).toBeCloseTo(70, 10)
    expect(result.shortlist.map((s) => s.qid)).toEqual(['Q3', 'Q2', 'Q1'])
  })

  it('a tie on score is broken by demand', () => {
    // Five entries so percentiles fall on multiples of 25. X (D 100, G 0) and
    // Y (D 25, G 100) tie: .4*100 + .3*0 = .4*25 + .3*100 = 40, and X and Y
    // share the same S and W values so those terms are equal too.
    const filler = (qid: string, demand: number, coverage: number, spike: number) =>
      entry(qid, { demand, coverage, spike, world: spike })
    const result = rank([
      entry('Q10', { demand: 8000, coverage: 5, spike: 3, world: 3 }),
      entry('Q20', { demand: 2000, coverage: 0, spike: 3, world: 3 }),
      filler('Q30', 1000, 1, 1),
      filler('Q40', 3000, 2, 2),
      filler('Q50', 4000, 3, 5),
    ]).downfall
    const x = result.shortlist.find((s) => s.qid === 'Q10')!
    const y = result.shortlist.find((s) => s.qid === 'Q20')!
    expect(x.pct.D).toBe(100)
    expect(y.pct.D).toBe(25)
    expect(x.score).toBe(y.score)
    const order = result.shortlist.map((s) => s.qid)
    expect(order.indexOf('Q10')).toBeLessThan(order.indexOf('Q20'))
  })

  it('a tie on score and demand is broken by QID in numeric order', () => {
    const result = rank([entry('Q10'), entry('Q9'), entry('Q100')]).downfall
    expect(result.shortlist.map((s) => s.qid)).toEqual(['Q9', 'Q10', 'Q100'])
  })

  it('downfalls and successes are ranked separately', () => {
    const result = rank([
      entry('Q1', { lane: 'downfall', demand: 500 }),
      entry('Q2', { lane: 'success', demand: 90_000 }),
    ])
    // Each is alone in its lane, so each is the top of its own percentile list.
    expect(result.downfall.shortlist.map((s) => [s.qid, s.pct.D])).toEqual([['Q1', 100]])
    expect(result.success.shortlist.map((s) => [s.qid, s.pct.D])).toEqual([['Q2', 100]])
    expect(result.downfall.shortlist[0]!.lane).toBe('downfall')
    expect(result.success.shortlist[0]!.lane).toBe('success')
  })

  it('below the floor is unranked with its reason', () => {
    const result = rank([
      entry('Q1', { demand: FLOOR_MEDIAN_MONTHLY }),
      entry('Q2', { demand: FLOOR_MEDIAN_MONTHLY - 1 }),
    ]).downfall
    expect(result.shortlist.map((s) => s.qid)).toEqual(['Q1'])
    expect(result.unranked).toEqual([{ qid: 'Q2', reason: 'below floor' }])
  })

  it('only the top 250 by demand are ranked', () => {
    const evidence = Array.from({ length: RANKED_PER_LANE + 1 }, (_, i) =>
      entry(`Q${i + 1}`, { demand: 1000 + i }),
    )
    const result = rank(evidence).downfall
    expect(result.shortlist).toHaveLength(RANKED_PER_LANE)
    // Q1 has the least demand, so it is the one cut.
    expect(result.unranked).toEqual([{ qid: 'Q1', reason: 'outside top 250' }])
    expect(populationAt(evidence).get('downfall')).toHaveLength(RANKED_PER_LANE)
  })

  it('an entry with no lane appears once, in downfall unranked', () => {
    const result = rank([entry('Q1', { lane: null }), entry('Q2')])
    expect(result.downfall.unranked).toEqual([{ qid: 'Q1', reason: 'no lane' }])
    expect(result.success.unranked).toEqual([])
    expect(result.success.shortlist).toEqual([])
  })

  it('an empty lane gives empty lists', () => {
    const result = rank([])
    for (const lane of ['downfall', 'success'] as const) {
      expect(result[lane]).toEqual({ shortlist: [], killed: [], unranked: [] })
    }
    expect([...populationAt([]).keys()].sort()).toEqual(['downfall', 'success'])
  })

  it('applyLegalKill false keeps a legal kill in the shortlist; paper trail none is killed either way', () => {
    // Q1: alleged downfall, a living person, one document: the legal kill.
    // Q2: no documents at all: the paper-trail kill.
    // Q3: clean.
    const evidence = [
      entry('Q1', { documents: docs(1), living: true }),
      entry('Q2', { documents: [] }),
      entry('Q3'),
    ]
    const strict = rank(evidence).downfall
    expect(strict.shortlist.map((s) => s.qid)).toEqual(['Q3'])
    expect(strict.killed.map((s) => [s.qid, s.gates.kill]).sort()).toEqual([
      ['Q1', KILL_LEGAL],
      ['Q2', KILL_NO_RECORD],
    ])

    const backtest = rank(evidence, { applyLegalKill: false }).downfall
    expect(backtest.shortlist.map((s) => s.qid).sort()).toEqual(['Q1', 'Q3'])
    expect(backtest.shortlist.find((s) => s.qid === 'Q1')!.gates.kill).toBe(KILL_LEGAL)
    expect(backtest.killed.map((s) => [s.qid, s.gates.kill])).toEqual([['Q2', KILL_NO_RECORD]])
  })

  it('killed entries are still percentiled with the population', () => {
    const base = [
      entry('Q1', { demand: 1000 }),
      entry('Q2', { demand: 2000 }),
      entry('Q3', { demand: 4000, documents: [] }), // killed, but still ranks in the lane
    ]
    const withKilled = rank(base).downfall
    expect(withKilled.shortlist.find((s) => s.qid === 'Q2')!.pct.D).toBe(50)
    const without = rank(base.slice(0, 2)).downfall
    expect(without.shortlist.find((s) => s.qid === 'Q2')!.pct.D).toBe(100)
  })

  it('throws, naming the QID, when a population entry has no measured search', () => {
    expect(() => rank([entry('Q77', { coverage: null })])).toThrow(/Q77/)
  })
})

describe('classify', () => {
  it('reports each entry once, with its lane and reason', () => {
    const { population, unranked } = classify([
      entry('Q1'),
      entry('Q2', { demand: 10 }),
      entry('Q3', { lane: null }),
    ])
    expect(population.get('downfall')!.map((e) => e.entry.qid)).toEqual(['Q1'])
    expect(unranked).toEqual([
      { qid: 'Q2', lane: 'downfall', reason: 'below floor' },
      { qid: 'Q3', lane: null, reason: 'no lane' },
    ])
  })

  it('below the floor wins over no lane: the floor is checked first', () => {
    const { population, unranked } = classify([
      entry('Q1', { lane: null, demand: FLOOR_MEDIAN_MONTHLY - 1 }),
      entry('Q2', { lane: null, demand: FLOOR_MEDIAN_MONTHLY }),
    ])
    expect(population.get('downfall')).toEqual([])
    expect(unranked).toEqual([
      { qid: 'Q1', lane: null, reason: 'below floor' },
      { qid: 'Q2', lane: null, reason: 'no lane' },
    ])
    const result = rank([entry('Q1', { lane: null, demand: FLOOR_MEDIAN_MONTHLY - 1 })])
    expect(result.downfall.unranked).toEqual([{ qid: 'Q1', reason: 'below floor' }])
    expect(result.success.unranked).toEqual([])
  })
})
