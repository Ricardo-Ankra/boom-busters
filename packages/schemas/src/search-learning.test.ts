import { describe, expect, test } from 'vitest'
import type { FrozenVerdict, VerdictCheck, VerdictState } from './brief-verdict'
import { DEFAULT_RESEARCH_THRESHOLDS, type ResearchThresholds } from './research-thresholds'
import { buildSearchReport, type SearchOutcome, type SearchReport } from './search-report'
import {
  COUNTED_OUTCOMES,
  DISMISS_RETURN_AFTER,
  LEARNING_MIN_VIDEOS,
  SUGGESTION_MIN_SUPPORT,
  niceRound,
  suggestTuning,
  trackRecord,
  type CountedVideo,
} from './search-learning'

const T = DEFAULT_RESEARCH_THRESHOLDS

const base = buildSearchReport({
  checkpoint: 28,
  range: { start: '2026-09-01', end: '2026-09-29' },
  publishedAt: '2026-09-01T00:00:00.000Z',
  durationSec: 600,
  views: 1000,
  searchViews: 400,
  avgViewDurationSec: 120,
  subscribersGained: 10,
  likes: 10,
  comments: 1,
  retentionCurve: null,
  terms: [{ term: 't', views: 100, minutes: 100, bucket: 'target' }],
  targetKeyword: 't',
  matching: 'full',
  rank: null,
  baselineInputs: {
    holdBand: [],
    holdChannel: [],
    dropBand: [],
    dropChannel: [],
    subsBand: [],
    subsChannel: [],
  },
  thresholds: T,
  now: new Date('2026-10-05T00:00:00.000Z'),
})

function report(over: {
  checkpoint?: 7 | 28 | 90
  outcome?: SearchOutcome
  found?: boolean | null
  hold?: number | null
  holdBaseline?: number | null
  subs?: number | null
  subsBaseline?: number | null
  subsBasis?: 'band' | 'channel' | 'own'
  rank?: number | null | 'none'
  thresholds?: ResearchThresholds
}): SearchReport {
  const r: SearchReport = {
    ...base,
    checkpoint: over.checkpoint ?? 28,
    outcome: over.outcome ?? 'hit-and-held',
    foundForTarget: over.found === undefined ? true : over.found,
    buckets: {
      ...base.buckets,
      target: { views: 100, holdSec: over.hold === undefined ? 100 : over.hold },
    },
    baselines: {
      ...base.baselines,
      searchHoldSec: {
        ...base.baselines.searchHoldSec,
        value: over.holdBaseline === undefined ? 100 : over.holdBaseline,
      },
      subscribersPer1k: {
        ...base.baselines.subscribersPer1k,
        value: over.subsBaseline === undefined ? 5 : over.subsBaseline,
        basis: over.subsBasis ?? 'channel',
      },
    },
    engagement: {
      ...base.engagement,
      subscribersPer1k: over.subs === undefined ? 10 : over.subs,
    },
    rank:
      over.rank === undefined || over.rank === 'none'
        ? null
        : { keyword: 't', position: over.rank, checkedAt: '2026-09-29T00:00:00.000Z' },
    thresholds: over.thresholds ?? T,
  }
  return r
}

function verdict(
  states: Partial<Record<VerdictCheck, VerdictState>>,
  thresholds: ResearchThresholds = T,
): FrozenVerdict {
  const checks: VerdictCheck[] = ['intent', 'angle', 'fit', 'demand', 'competition']
  return {
    lines: checks.flatMap((check) => {
      const state = states[check]
      return state ? [{ check, state, reason: '' }] : []
    }),
    thresholds,
    frozenAt: '2026-09-01T00:00:00.000Z',
  }
}

function unmeasuredLines(v: FrozenVerdict, checks: VerdictCheck[]): FrozenVerdict {
  return {
    ...v,
    lines: v.lines.map((l) => (checks.includes(l.check) ? { ...l, measured: false as const } : l)),
  }
}

let n = 0
function video(
  over: {
    states?: Partial<Record<VerdictCheck, VerdictState>>
    searches?: number | null
    vThresholds?: ResearchThresholds
    unmeasured?: VerdictCheck[]
  } & Parameters<typeof report>[0],
): CountedVideo {
  n += 1
  return {
    projectId: `p${n}`,
    title: `Video ${n}`,
    verdict: unmeasuredLines(verdict(over.states ?? {}, over.vThresholds), over.unmeasured ?? []),
    report: report(over),
    demandSearches: over.searches === undefined ? 3000 : over.searches,
  }
}

const many = (count: number, make: () => CountedVideo) => Array.from({ length: count }, make)
/** Five neutral counted videos so the five-video floor is met. */
const filler = (count = 5) =>
  many(count, () => video({ states: { demand: 'ok' }, searches: 9000, found: true }))

describe('constants', () => {
  test('carry the spec numbers', () => {
    expect(COUNTED_OUTCOMES).toEqual([
      'hit-and-held',
      'hit-then-left',
      'found-another-way',
      'missed-target',
    ])
    expect(LEARNING_MIN_VIDEOS).toBe(5)
    expect(SUGGESTION_MIN_SUPPORT).toBe(3)
    expect(DISMISS_RETURN_AFTER).toBe(2)
  })
})

describe('niceRound', () => {
  test('rounds to 1, 2 or 5 steps in the given direction', () => {
    expect(niceRound(700, 'down')).toBe(500)
    expect(niceRound(700, 'up')).toBe(1000)
    expect(niceRound(500, 'down')).toBe(500)
    expect(niceRound(500, 'up')).toBe(500)
    expect(niceRound(1500, 'down')).toBe(1000)
    expect(niceRound(1500, 'up')).toBe(2000)
    expect(niceRound(30000, 'down')).toBe(20000)
    expect(niceRound(0.3, 'up')).toBe(0.5)
  })
})

describe('trackRecord', () => {
  test('track record counts only day-28 target outcomes', () => {
    const videos = [
      video({ states: { demand: 'ok' }, found: true }),
      video({ states: { demand: 'warn' }, found: false, outcome: 'missed-target' }),
      video({ states: { demand: 'ok' }, found: false, outcome: 'missed-target' }),
      video({ states: { demand: 'ok' }, found: true, checkpoint: 7 }),
      video({ states: { demand: 'ok' }, found: true, checkpoint: 90 }),
      video({ states: { demand: 'ok' }, found: null, outcome: 'too-little-search' }),
      video({ states: { demand: 'ok' }, found: true, outcome: 'search-barely-played' }),
    ]
    const demand = trackRecord(videos).find((r) => r.check === 'demand')
    expect(demand?.counted).toBe(3)
    expect(demand?.right).toBe(2)
    expect(demand?.videos.map((v) => v.right)).toEqual([true, true, false])
    expect(demand?.videos[0]).toEqual({
      projectId: videos[0]!.projectId,
      title: videos[0]!.title,
      right: true,
    })
  })

  test('returns all five checks, empty when nothing counts', () => {
    const rows = trackRecord([])
    expect(rows.map((r) => r.check)).toEqual(['demand', 'competition', 'intent', 'angle', 'fit'])
    expect(rows.every((r) => r.counted === 0 && r.right === 0)).toBe(true)
  })

  test('competition uses the rank when there is one', () => {
    const rows = trackRecord([
      // ok and ranked 4: right, even though not found
      video({ states: { competition: 'ok' }, found: false, rank: 4, outcome: 'missed-target' }),
      // ok and rank 15: wrong (outside the top 10), though found
      video({ states: { competition: 'ok' }, found: true, rank: 15 }),
      // warn and checked but not ranked: right
      video({ states: { competition: 'warn' }, found: true, rank: null }),
      // no rank: falls back to found
      video({ states: { competition: 'ok' }, found: true }),
      // no rank, found null: not counted
      video({ states: { competition: 'ok' }, found: null }),
    ])
    const c = rows.find((r) => r.check === 'competition')
    expect(c?.counted).toBe(4)
    expect(c?.videos.map((v) => v.right)).toEqual([true, false, true, true])
  })

  test('intent, angle and fit read hold and subscribers, skipping nulls', () => {
    const rows = trackRecord([
      // hold 80 vs baseline 100 at ratio 0.8 is good
      video({ states: { intent: 'ok', angle: 'ok', fit: 'ok' }, hold: 80, subs: 5 }),
      // hold 79 is not good, intent warned: right
      video({ states: { intent: 'warn', angle: 'ok', fit: 'warn' }, hold: 79, subs: 4 }),
      // null hold: skipped for intent and angle; fit still counts
      video({ states: { intent: 'ok', angle: 'ok', fit: 'ok' }, hold: null, subs: 9 }),
      // null baseline for subscribers: skipped for fit
      video({ states: { fit: 'ok' }, subsBaseline: null }),
    ])
    const by = (c: VerdictCheck) => rows.find((r) => r.check === c)!
    expect(by('intent').counted).toBe(2)
    expect(by('intent').right).toBe(2)
    expect(by('angle').counted).toBe(2)
    expect(by('angle').right).toBe(1)
    expect(by('fit').counted).toBe(3)
    expect(by('fit').videos.map((v) => v.right)).toEqual([true, true, true])
  })
})

describe('unmeasured lines and own baselines', () => {
  test('a line that never ran counts for no check', () => {
    const rows = trackRecord([
      video({
        states: { demand: 'bad', competition: 'warn', intent: 'warn', angle: 'warn', fit: 'warn' },
        unmeasured: ['demand', 'competition', 'intent', 'angle', 'fit'],
        found: false,
        hold: 10,
        subs: 1,
        subsBaseline: 5,
        rank: 3,
        outcome: 'missed-target',
      }),
    ])
    expect(rows.every((r) => r.counted === 0)).toBe(true)
  })

  test('only the unmeasured check is skipped', () => {
    const rows = trackRecord([
      video({
        states: { demand: 'ok', intent: 'warn' },
        unmeasured: ['intent'],
        hold: 10,
      }),
    ])
    expect(rows.find((r) => r.check === 'demand')?.counted).toBe(1)
    expect(rows.find((r) => r.check === 'intent')?.counted).toBe(0)
  })

  test('an unmeasured competition line is not evidence for the open door rule', () => {
    const unchecked = many(3, () =>
      video({
        states: { competition: 'warn' },
        unmeasured: ['competition'],
        rank: 3,
        found: true,
      }),
    )
    const out = suggestTuning([...unchecked, ...filler(2)], T, [])
    expect(out.find((s) => s.key === 'openDoorMaxSubscribers')).toBeUndefined()
  })

  test('a subscribers baseline that is the video itself says nothing about channel fit', () => {
    const rows = trackRecord([
      video({ states: { fit: 'ok' }, subs: 10, subsBaseline: 10, subsBasis: 'own' }),
      video({ states: { fit: 'ok' }, subs: 10, subsBaseline: 5, subsBasis: 'channel' }),
    ])
    const fit = rows.find((r) => r.check === 'fit')
    expect(fit?.counted).toBe(1)
  })
})

describe('suggestTuning', () => {
  test('no suggestions under five counted videos', () => {
    const four = many(4, () => video({ states: { demand: 'warn' }, searches: 600, found: true }))
    expect(suggestTuning(four, T, [])).toEqual([])
    const five = [...four, video({ states: { demand: 'ok' }, found: true })]
    expect(suggestTuning(five, T, [])).toHaveLength(1)
  })

  test('suggests lowering the demand warning from three found low-demand videos, at most halving', () => {
    const lows = many(3, () => video({ states: { demand: 'warn' }, searches: 700, found: true }))
    const out = suggestTuning([...lows, ...filler(2)], T, [])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      key: 'demandWarn',
      direction: 'lower',
      from: 1000,
      to: 500,
      support: lows.map((v) => v.projectId),
    })
    // very low searches: halving is the limit
    const tiny = many(3, () => video({ states: { demand: 'warn' }, searches: 120, found: true }))
    const out2 = suggestTuning([...tiny, ...filler(2)], T, [])
    expect(out2[0]).toMatchObject({ key: 'demandWarn', direction: 'lower', to: 500 })
  })

  test('raises the demand warning from three missed videos with demand and open competition', () => {
    const missed = many(3, () =>
      video({
        states: { demand: 'ok', competition: 'ok' },
        searches: 1200,
        found: false,
        outcome: 'missed-target',
      }),
    )
    const out = suggestTuning([...missed, ...filler(2)], T, [])
    expect(out.find((s) => s.key === 'demandWarn')).toMatchObject({
      direction: 'raise',
      from: 1000,
      to: 2000,
    })
  })

  test('judges demand on the topic figure the verdict used, not the target alone', () => {
    // Topic total 3,000 (a warn): not under 1,000, so no "lower the warning line".
    const topic = many(3, () => video({ states: { demand: 'warn' }, searches: 3000, found: true }))
    const out = suggestTuning([...topic, ...filler(2)], T, [])
    expect(out.find((s) => s.key === 'demandWarn')).toBeUndefined()
    // A topic total over the strong line, already ok, does not support lowering it.
    const ok = many(3, () => video({ states: { demand: 'ok' }, searches: 6000, found: true }))
    expect(
      suggestTuning([...ok, ...filler(2)], T, []).find((s) => s.key === 'demandOk'),
    ).toBeUndefined()
  })

  test('never offers a warning line at or above the strong demand line', () => {
    const near = { ...T, demandOk: 1500 }
    const missed = many(3, () =>
      video({
        states: { demand: 'ok', competition: 'ok' },
        searches: 1200,
        found: false,
        outcome: 'missed-target',
        vThresholds: near,
      }),
    )
    const five = [
      ...missed,
      ...filler(2).map((v) => ({ ...v, verdict: { ...v.verdict, thresholds: near } })),
    ]
    expect(suggestTuning(five, near, []).find((s) => s.key === 'demandWarn')).toBeUndefined()
  })

  test('lowers the strong demand line from three found videos between the lines', () => {
    const mid = many(3, () => video({ states: { demand: 'warn' }, searches: 3000, found: true }))
    const out = suggestTuning(
      [...mid, ...filler(2).map((v) => ({ ...v, demandSearches: 9000 }))],
      T,
      [],
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'demandOk', direction: 'lower', from: 5000, to: 2500 })
  })

  test('raises and lowers the open door size', () => {
    const rankedDespiteWarn = many(3, () =>
      video({ states: { competition: 'warn' }, searches: 9000, rank: 3, found: true }),
    )
    const up = suggestTuning([...rankedDespiteWarn, ...filler(2)], T, [])
    expect(up.find((s) => s.key === 'openDoorMaxSubscribers')).toMatchObject({
      direction: 'raise',
      from: 100000,
      to: 200000,
    })
    const unranked = many(3, () =>
      video({ states: { competition: 'ok' }, searches: 9000, rank: 'none', found: true }),
    )
    // rank 'none' means no check was made, so these do not count
    expect(
      suggestTuning([...unranked, ...filler(2)], T, []).find(
        (s) => s.key === 'openDoorMaxSubscribers',
      ),
    ).toBeUndefined()
    const absent = many(3, () =>
      video({ states: { competition: 'ok' }, searches: 9000, rank: null, found: true }),
    ).map((v) => ({
      ...v,
      report: { ...v.report, rank: { keyword: 't', position: null, checkedAt: 'x' } },
    }))
    const down = suggestTuning([...absent, ...filler(2)], T, [])
    expect(down.find((s) => s.key === 'openDoorMaxSubscribers')).toMatchObject({
      direction: 'lower',
      from: 100000,
      to: 50000,
    })
  })

  test('ignores videos frozen under another threshold value', () => {
    const other = { ...T, demandWarn: 2000 }
    const lows = many(3, () =>
      video({ states: { demand: 'warn' }, searches: 700, found: true, vThresholds: other }),
    )
    // all five count in total, but none were frozen under the current demandWarn
    expect(suggestTuning([...lows, ...filler(2)], T, [])).toEqual([])
    // under the current value they would count
    const same = many(3, () => video({ states: { demand: 'warn' }, searches: 700, found: true }))
    expect(suggestTuning([...same, ...filler(2)], T, [])).toHaveLength(1)
    // the track record still counts the other-threshold videos
    expect(trackRecord(lows).find((r) => r.check === 'demand')?.counted).toBe(3)
  })

  test('withholds a dismissed suggestion until two more videos support it', () => {
    const lows = (k: number) =>
      many(k, () => video({ states: { demand: 'warn' }, searches: 700, found: true }))
    const dismissal = { key: 'demandWarn' as const, direction: 'lower' as const, support: 3 }
    expect(suggestTuning([...lows(3), ...filler(2)], T, [dismissal])).toEqual([])
    expect(suggestTuning([...lows(4), ...filler(2)], T, [dismissal])).toEqual([])
    expect(suggestTuning([...lows(5), ...filler(2)], T, [dismissal])).toHaveLength(1)
    // a different direction is not withheld
    const other = { ...dismissal, direction: 'raise' as const }
    expect(suggestTuning([...lows(3), ...filler(2)], T, [other])).toHaveLength(1)
  })

  test('clamps to bounds and drops a no-op', () => {
    // demandWarn already at its lower bound 100: halving 100 clamps back to 100, dropped
    const atFloor = { ...T, demandWarn: 100 }
    const lows = many(3, () =>
      video({ states: { demand: 'warn' }, searches: 60, found: true, vThresholds: atFloor }),
    )
    expect(suggestTuning([...lows, ...filler(2)], atFloor, [])).toEqual([])
    // openDoorMaxSubscribers at 800000 doubles to 1.6m, clamps to 1m
    const high = { ...T, openDoorMaxSubscribers: 800_000 }
    const ranked = many(3, () =>
      video({
        states: { competition: 'warn' },
        searches: 9000,
        rank: 2,
        found: true,
        vThresholds: high,
      }),
    )
    const out = suggestTuning(
      [...ranked, ...filler(2).map((v) => ({ ...v, verdict: { ...v.verdict, thresholds: high } }))],
      high,
      [],
    )
    expect(out.find((s) => s.key === 'openDoorMaxSubscribers')?.to).toBe(1_000_000)
    // already at the upper bound: no-op
    const top = { ...T, openDoorMaxSubscribers: 1_000_000 }
    const ranked2 = many(3, () =>
      video({
        states: { competition: 'warn' },
        searches: 9000,
        rank: 2,
        found: true,
        vThresholds: top,
      }),
    )
    expect(
      suggestTuning(
        [...ranked2, ...filler(2)].map((v) => ({
          ...v,
          verdict: { ...v.verdict, thresholds: top },
        })),
        top,
        [],
      ),
    ).toEqual([])
  })

  test('never moves a value past a factor of two from a non-nice current value', () => {
    const warn700 = { ...T, demandWarn: 700 }
    const lows = many(3, () =>
      video({ states: { demand: 'warn' }, searches: 300, found: true, vThresholds: warn700 }),
    )
    const down = suggestTuning(
      [...lows, ...filler(2)].map((v) => ({ ...v })),
      warn700,
      [],
    )
    expect(down.find((s) => s.key === 'demandWarn')).toMatchObject({ from: 700, to: 350 })
    const door = { ...T, openDoorMaxSubscribers: 150_000 }
    const ranked = many(3, () =>
      video({
        states: { competition: 'warn' },
        searches: 9000,
        rank: 2,
        found: true,
        vThresholds: door,
      }),
    )
    const up = suggestTuning(
      [...ranked, ...filler(2).map((v) => ({ ...v, verdict: { ...v.verdict, thresholds: door } }))],
      door,
      [],
    )
    expect(up.find((s) => s.key === 'openDoorMaxSubscribers')).toMatchObject({
      direction: 'raise',
      from: 150_000,
      to: 300_000,
    })
  })

  test('the sentence names the count, the change and the new value', () => {
    const lows = many(3, () => video({ states: { demand: 'warn' }, searches: 700, found: true }))
    const [s] = suggestTuning([...lows, ...filler(2)], T, [])
    expect(s?.sentence).toBe(
      'Demand warned on 3 videos under 1,000 searches that were each found for their target. Lower the warning line to 500?',
    )
    expect(s?.sentence).not.toMatch(/[–—]/)
  })
})
