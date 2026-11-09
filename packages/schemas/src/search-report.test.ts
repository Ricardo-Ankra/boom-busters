import { describe, expect, test } from 'vitest'
import {
  DEMAND_OK,
  DEMAND_WARN,
  OPEN_DOOR_MAX_SUBSCRIBERS,
  OPEN_DOOR_MIN_VIEWS,
} from './brief-verdict'
import { PICK_FLOOR } from './search-brief'
import { DEFAULT_RESEARCH_THRESHOLDS, ResearchThresholdsSchema } from './research-thresholds'
import {
  OUTCOME_COPY,
  SearchReportSchema,
  baseline,
  buildSearchReport,
  earlyDrop,
  foundForTarget,
  holdSec,
  lengthBand,
  median,
  searchOutcome,
  type SearchOutcome,
} from './search-report'
import type { TermBucket } from './search-terms-match'

const T = DEFAULT_RESEARCH_THRESHOLDS

describe('research thresholds', () => {
  test('the literal defaults equal the existing constants', () => {
    expect(T.demandWarn).toBe(DEMAND_WARN)
    expect(T.demandOk).toBe(DEMAND_OK)
    expect(T.openDoorMaxSubscribers).toBe(OPEN_DOOR_MAX_SUBSCRIBERS)
    expect(T.openDoorMinViews).toBe(OPEN_DOOR_MIN_VIEWS)
    expect(T.pickFloor).toBe(PICK_FLOOR)
    expect(ResearchThresholdsSchema.parse(T)).toEqual(T)
  })
})

describe('lengthBand', () => {
  test('puts 599 s short, 600 s mid, 1200 s mid, 1201 s long', () => {
    expect(lengthBand(599)).toBe('short')
    expect(lengthBand(600)).toBe('mid')
    expect(lengthBand(1200)).toBe('mid')
    expect(lengthBand(1201)).toBe('long')
    expect(lengthBand(null)).toBeNull()
  })
})

describe('earlyDrop', () => {
  test('interpolates the 30 second mark', () => {
    expect(
      earlyDrop(
        [
          { pct: 0, ratio: 1 },
          { pct: 10, ratio: 0.6 },
        ],
        150,
      ),
    ).toBeNull()
    // mark is 20%; r(20) = 0.6, so the drop is 1 - 0.6 / 1 = 0.4
    const d = earlyDrop(
      [
        { pct: 0, ratio: 1 },
        { pct: 25, ratio: 0.5 },
      ],
      150,
    )
    expect(d).toBeCloseTo(0.4, 10)
  })
  test('is null for a 60 minute video whose first point is at 1%', () => {
    expect(
      earlyDrop(
        [
          { pct: 1, ratio: 1 },
          { pct: 5, ratio: 0.5 },
        ],
        3600,
      ),
    ).toBeNull()
  })
  test('is null without a curve or duration', () => {
    expect(earlyDrop(null, 150)).toBeNull()
    expect(earlyDrop([], 150)).toBeNull()
    expect(earlyDrop([{ pct: 0, ratio: 1 }], null)).toBeNull()
  })
})

describe('holdSec, median, baseline', () => {
  test('holdSec and median', () => {
    expect(holdSec(0, 10)).toBeNull()
    expect(holdSec(10, 5)).toBe(30)
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  test('baseline uses the band at three, widens to the channel, then falls back to own', () => {
    expect(baseline(9, [1, 2, 3], [100, 200, 300])).toEqual({ value: 2, basis: 'band', count: 3 })
    expect(baseline(9, [1, 2], [100, 200, 300])).toEqual({ value: 200, basis: 'channel', count: 3 })
    expect(baseline(9, [1, 2], [100, 200])).toEqual({ value: 9, basis: 'own', count: 0 })
    expect(baseline(null, [], [])).toEqual({ value: null, basis: 'own', count: 0 })
  })
})

const b = (target: number, other = 0) => ({
  target: { views: target, holdSec: null },
  researched: { views: other, holdSec: null },
  unresearched: { views: 0, holdSec: null },
  unmatched: { views: 0, holdSec: null },
})
const term = (name: string, views: number, bucket: TermBucket) => ({
  term: name,
  views,
  minutes: views,
  bucket,
})

describe('foundForTarget', () => {
  test('needs the floors, then share or top term', () => {
    expect(foundForTarget(b(19, 81), [], T)).toBeNull()
    expect(foundForTarget(b(20, 29), [], T)).toBeNull() // 49 listed
    // 20 of 80 is 25%
    expect(
      foundForTarget(b(20, 60), [term('a', 60, 'researched'), term('t', 20, 'target')], T),
    ).toBe(true)
    // 20 of 100 is 20%, under the share rule, but the target is the top term
    expect(
      foundForTarget(b(20, 80), [term('t', 20, 'target'), term('a', 10, 'researched')], T),
    ).toBe(true)
    expect(
      foundForTarget(b(20, 80), [term('a', 50, 'researched'), term('t', 20, 'target')], T),
    ).toBe(false)
  })
})

const base = {
  hasTarget: true,
  days: 28,
  views: 1000,
  searchShare: 0.4 as number | null,
  terms: 10,
  listedViews: 200,
  found: true as boolean | null,
  targetHoldSec: 100 as number | null,
  otherViews: 0,
  otherHoldSec: null as number | null,
  holdBaseline: 100 as number | null,
}

describe('searchOutcome', () => {
  test('walks the table in order', () => {
    const cases: [SearchOutcome, Partial<typeof base>][] = [
      ['too-early', { days: 6 }],
      ['too-early', { views: 99 }],
      ['no-research', { hasTarget: false }],
      ['search-barely-played', { searchShare: 0.09, found: true }],
      ['no-terms', { terms: 0 }],
      ['too-little-search', { found: null }],
      ['hit-and-held', {}],
      ['hit-then-left', { targetHoldSec: 79 }],
      ['hit-then-left', { holdBaseline: null }],
      ['found-another-way', { found: false, otherViews: 60, otherHoldSec: 80 }],
      ['missed-target', { found: false, otherViews: 60, otherHoldSec: 79 }],
      ['missed-target', { found: false, otherViews: 10, otherHoldSec: 100 }],
    ]
    for (const [want, over] of cases) {
      expect(searchOutcome({ ...base, ...over }, T), JSON.stringify(over)).toBe(want)
    }
  })
  test('a null search share is not barely played', () => {
    expect(searchOutcome({ ...base, searchShare: null }, T)).toBe('hit-and-held')
  })
  test('every outcome has plain copy', () => {
    for (const c of Object.values(OUTCOME_COPY)) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.advice).not.toMatch(/[–—]/)
    }
    expect(OUTCOME_COPY['no-terms'].label).toBe('YouTube shows no search terms yet')
  })
})

const emptyBaselines = {
  holdBand: [] as number[],
  holdChannel: [] as number[],
  dropBand: [] as number[],
  dropChannel: [] as number[],
  subsBand: [] as number[],
  subsChannel: [] as number[],
}

const input = {
  checkpoint: 28 as const,
  range: { start: '2026-10-01', end: '2026-10-29' },
  publishedAt: '2026-10-01T10:00:00.000Z',
  durationSec: 150 as number | null,
  views: 1000,
  searchViews: 400,
  avgViewDurationSec: 60 as number | null,
  subscribersGained: 10,
  likes: 50,
  comments: 5,
  retentionCurve: [
    { pct: 0, ratio: 1 },
    { pct: 25, ratio: 0.5 },
  ] as { pct: number; ratio: number }[] | null,
  terms: [term('a', 60, 'researched'), term('t', 100, 'target')],
  targetKeyword: 't' as string | null,
  matching: 'full' as const,
  rank: null,
  baselineInputs: emptyBaselines,
  thresholds: T,
  now: new Date('2026-11-02T10:00:00.000Z'),
}

describe('buildSearchReport', () => {
  test('computes a report from empty terms, an empty curve and no duration', () => {
    const r = buildSearchReport({
      ...input,
      terms: [],
      retentionCurve: [],
      durationSec: null,
      avgViewDurationSec: null,
      views: 0,
      searchViews: 0,
      targetKeyword: null,
    })
    expect(SearchReportSchema.parse(r)).toEqual(r)
    expect(r.searchShare).toBeNull()
    expect(r.earlyDrop).toBeNull()
    expect(r.engagement.likesPer1k).toBeNull()
    expect(r.foundForTarget).toBeNull()
    expect(r.outcome).toBe('too-early')
  })
  test('freezes the thresholds it used and labels bases', () => {
    const custom = { ...T, holdRatio: 0.9 }
    const r = buildSearchReport({ ...input, thresholds: custom })
    expect(SearchReportSchema.parse(r)).toEqual(r)
    expect(r.thresholds.holdRatio).toBe(0.9)
    expect(r.baselines.searchHoldSec).toEqual({ value: 60, basis: 'own', count: 0 })
    expect(r.baselines.earlyDrop.basis).toBe('own')
    expect(r.earlyDrop).toBeCloseTo(0.4, 10)
    expect(r.engagement.subscribersPer1k).toBe(10)
    expect(r.listedViews).toBe(160)
    expect(r.buckets.target.views).toBe(100)
    expect(r.buckets.target.holdSec).toBe(60)
    expect(r.searchShare).toBe(0.4)
    const wide = buildSearchReport({
      ...input,
      baselineInputs: { ...emptyBaselines, holdBand: [30, 40, 50] },
    })
    expect(wide.baselines.searchHoldSec).toEqual({ value: 40, basis: 'band', count: 3 })
  })
  test('each baseline records its own count when the three inputs differ in length', () => {
    const r = buildSearchReport({
      ...input,
      baselineInputs: {
        ...emptyBaselines,
        holdBand: [30, 40, 50, 60],
        dropChannel: [0.1, 0.2, 0.3, 0.4, 0.5],
        subsBand: [1, 2],
      },
    })
    expect(r.baselines.searchHoldSec).toMatchObject({ basis: 'band', count: 4 })
    expect(r.baselines.earlyDrop).toMatchObject({ basis: 'channel', count: 5 })
    expect(r.baselines.subscribersPer1k).toMatchObject({ basis: 'own', count: 0 })
  })
  test('keeps at most 25 terms, biggest first', () => {
    const many = Array.from({ length: 30 }, (_, i) => term(`x${i}`, i + 1, 'unmatched'))
    const r = buildSearchReport({ ...input, terms: many })
    expect(r.terms).toHaveLength(25)
    expect(r.terms[0]?.views).toBe(30)
  })
})
