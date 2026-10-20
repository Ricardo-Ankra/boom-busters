import { FLOOR_MEDIAN_MONTHLY, RANKED_PER_LANE, WEIGHTS } from '../config'
import { laneOf } from '../hitlist/build'
import { percentileRanks } from '../stats'
import type { EntryEvidence, Lane } from '../types'
import { KILL_LEGAL, KILL_NO_RECORD, gates, type Gates } from './gates'
import { measure, type RawMeasures } from './measure'

export interface Scored {
  qid: string
  lane: Lane
  raw: RawMeasures
  /** Within-lane percentiles, 0 to 100. G is already inverted: 100 means the least covered. */
  pct: { D: number; G: number; S: number; W: number }
  score: number
  gates: Gates
}

export type UnrankedReason = 'no lane' | 'below floor' | 'outside top 250'

export interface LaneResult {
  shortlist: Scored[]
  killed: Scored[]
  unranked: { qid: string; reason: UnrankedReason }[]
}

const LANES: readonly Lane[] = ['downfall', 'success']

const qidNumber = (e: EntryEvidence) => Number(e.entry.qid.slice(1))

/**
 * One pass that decides, for every entry, whether it is ranked and if not why.
 * `rank` and the CLI both read this, so the population and the unranked
 * reasons cannot disagree. Floor first, then the top 250 by demand.
 */
export function classify(evidence: EntryEvidence[]): {
  population: Map<Lane, EntryEvidence[]>
  unranked: { qid: string; lane: Lane | null; reason: UnrankedReason }[]
} {
  const population = new Map<Lane, EntryEvidence[]>(LANES.map((l) => [l, []]))
  const unranked: { qid: string; lane: Lane | null; reason: UnrankedReason }[] = []
  const eligible = new Map<Lane, { e: EntryEvidence; demand: number }[]>(LANES.map((l) => [l, []]))

  for (const e of evidence) {
    const lane = laneOf(e.tagsAtT)
    if (lane === null) {
      unranked.push({ qid: e.entry.qid, lane, reason: 'no lane' })
      continue
    }
    const raw = measure(e)
    if (raw.enMedianMonthly < FLOOR_MEDIAN_MONTHLY) {
      unranked.push({ qid: e.entry.qid, lane, reason: 'below floor' })
    } else {
      eligible.get(lane)!.push({ e, demand: raw.demand })
    }
  }

  for (const lane of LANES) {
    const sorted = eligible
      .get(lane)!
      .sort((a, b) => b.demand - a.demand || qidNumber(a.e) - qidNumber(b.e))
    population.set(
      lane,
      sorted.slice(0, RANKED_PER_LANE).map((x) => x.e),
    )
    for (const x of sorted.slice(RANKED_PER_LANE)) {
      unranked.push({ qid: x.e.entry.qid, lane, reason: 'outside top 250' })
    }
  }
  return { population, unranked }
}

/** Each lane's ranked population: floor applied, top 250 by demand, lane from the tags at T. */
export function populationAt(evidence: EntryEvidence[]): Map<Lane, EntryEvidence[]> {
  return classify(evidence).population
}

function scoreLane(lane: Lane, population: EntryEvidence[]): Scored[] {
  const raws = population.map((e) => {
    const raw = measure(e)
    if (raw.coverage === null) {
      throw new Error(`${e.entry.qid} is in the ranked population but has no measured search`)
    }
    return raw
  })
  const D = percentileRanks(raws.map((r) => r.demand))
  const coverage = percentileRanks(raws.map((r) => r.coverage as number))
  const S = percentileRanks(raws.map((r) => r.spike))
  const W = percentileRanks(raws.map((r) => r.world))

  return population.map((e, i) => {
    const pct = { D: D[i]!, G: 100 - coverage[i]!, S: S[i]!, W: W[i]! }
    return {
      qid: e.entry.qid,
      lane,
      raw: raws[i]!,
      pct,
      score: WEIGHTS.D * pct.D + WEIGHTS.G * pct.G + WEIGHTS.S * pct.S + WEIGHTS.W * pct.W,
      gates: gates(e, lane),
    }
  })
}

function byScore(a: Scored, b: Scored): number {
  return (
    b.score - a.score ||
    b.raw.demand - a.raw.demand ||
    Number(a.qid.slice(1)) - Number(b.qid.slice(1))
  )
}

/**
 * Percentiles are taken over the whole ranked population, kills included, so
 * a killed entry still shapes everyone else's score. `applyLegalKill: false`
 * is the back-test's setting (spec 9.5): the legal kill stays in the shortlist
 * and keeps its `gates.kill` text. No paper trail always kills.
 */
export function rank(
  evidence: EntryEvidence[],
  options: { applyLegalKill: boolean } = { applyLegalKill: true },
): Record<Lane, LaneResult> {
  const { population, unranked } = classify(evidence)
  const result = {} as Record<Lane, LaneResult>
  for (const lane of LANES) {
    const scored = scoreLane(lane, population.get(lane)!).sort(byScore)
    const isKilled = (s: Scored) =>
      s.gates.kill === KILL_NO_RECORD || (options.applyLegalKill && s.gates.kill === KILL_LEGAL)
    result[lane] = {
      shortlist: scored.filter((s) => !isKilled(s)),
      killed: scored.filter(isKilled),
      // An entry with no lane has nowhere to belong; it is listed once, under downfall.
      unranked: unranked
        .filter((u) => u.lane === lane || (lane === 'downfall' && u.lane === null))
        .map(({ qid, reason }) => ({ qid, reason })),
    }
  }
  return result
}
