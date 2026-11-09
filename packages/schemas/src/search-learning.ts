import type { FrozenVerdict, VerdictCheck } from './brief-verdict'
import { THRESHOLD_BOUNDS, type ResearchThresholds } from './research-thresholds'
import type { SearchOutcome, SearchReport } from './search-report'

/** One published video with a frozen day-28 report, as the learning reads it. */
export interface CountedVideo {
  projectId: string
  title: string
  verdict: FrozenVerdict
  report: SearchReport
  /** The monthly searches over the target's topic, the figure the demand line judged. */
  demandSearches: number | null
}

export const COUNTED_OUTCOMES: SearchOutcome[] = [
  'hit-and-held',
  'hit-then-left',
  'found-another-way',
  'missed-target',
]
export const LEARNING_MIN_VIDEOS = 5
export const SUGGESTION_MIN_SUPPORT = 3
export const DISMISS_RETURN_AFTER = 2

const TOP_RANK = 10

function isCounted(v: CountedVideo): boolean {
  return v.report.checkpoint === 28 && COUNTED_OUTCOMES.includes(v.report.outcome)
}

function stateOf(v: CountedVideo, check: VerdictCheck): 'ok' | 'not-ok' | null {
  const line = v.verdict.lines.find((l) => l.check === check)
  if (!line || line.measured === false) return null
  return line.state === 'ok' ? 'ok' : 'not-ok'
}

/** Target hold at or above holdRatio times the baseline; null when either side is missing. */
export function holdGood(report: SearchReport): boolean | null {
  const hold = report.buckets.target.holdSec
  const base = report.baselines.searchHoldSec.value
  if (hold === null || base === null) return null
  return hold >= report.thresholds.holdRatio * base
}

function subscribersGood(report: SearchReport): boolean | null {
  const subs = report.engagement.subscribersPer1k
  const base = report.baselines.subscribersPer1k.value
  // Against its own figure a video always passes: no evidence either way.
  if (subs === null || base === null || report.baselines.subscribersPer1k.basis === 'own') {
    return null
  }
  return subs >= base
}

function competitionOutcome(report: SearchReport): boolean | null {
  if (report.rank !== null) {
    return report.rank.position !== null && report.rank.position <= TOP_RANK
  }
  return report.foundForTarget
}

const OUTCOME_OF: Record<VerdictCheck, (r: SearchReport) => boolean | null> = {
  demand: (r) => r.foundForTarget,
  competition: competitionOutcome,
  intent: holdGood,
  angle: holdGood,
  fit: subscribersGood,
}

const CHECK_ORDER: VerdictCheck[] = ['demand', 'competition', 'intent', 'angle', 'fit']

export function trackRecord(videos: CountedVideo[]): {
  check: VerdictCheck
  right: number
  counted: number
  videos: { projectId: string; title: string; right: boolean; recomputed?: true }[]
}[] {
  const counted = videos.filter(isCounted)
  return CHECK_ORDER.map((check) => {
    const rows: { projectId: string; title: string; right: boolean; recomputed?: true }[] = []
    for (const v of counted) {
      const state = stateOf(v, check)
      const outcome = OUTCOME_OF[check](v.report)
      if (state === null || outcome === null) continue
      rows.push({
        projectId: v.projectId,
        title: v.title,
        right: (state === 'ok') === outcome,
        ...(v.verdict.recomputed ? { recomputed: true as const } : {}),
      })
    }
    return {
      check,
      right: rows.filter((r) => r.right).length,
      counted: rows.length,
      videos: rows,
    }
  })
}

const STEPS = [1, 2, 5]

/** The nearest number in 1, 2, 5, 10, 20, 50, 100, ... in the given direction. */
export function niceRound(value: number, direction: 'up' | 'down'): number {
  if (!(value > 0)) return value
  const exp = Math.floor(Math.log10(value))
  const candidates: number[] = []
  for (let e = exp - 1; e <= exp + 1; e++) {
    for (const s of STEPS) candidates.push(Number((s * 10 ** e).toPrecision(12)))
  }
  const eps = value * 1e-9
  if (direction === 'down') {
    return Math.max(...candidates.filter((c) => c <= value + eps))
  }
  return Math.min(...candidates.filter((c) => c >= value - eps))
}

export interface Suggestion {
  key: keyof ResearchThresholds
  direction: 'raise' | 'lower'
  from: number
  to: number
  support: string[]
  sentence: string
}

type Dismissal = { key: keyof ResearchThresholds; direction: 'raise' | 'lower'; support: number }

const fmt = (n: number) => n.toLocaleString('en-US')
const videosWord = (n: number) => `${fmt(n)} ${n === 1 ? 'video' : 'videos'}`

function clamp(key: keyof ResearchThresholds, value: number): number {
  const [lo, hi] = THRESHOLD_BOUNDS[key]
  return Math.min(hi, Math.max(lo, value))
}

export function suggestTuning(
  videos: CountedVideo[],
  current: ResearchThresholds,
  dismissals: Dismissal[],
): Suggestion[] {
  const counted = videos.filter(isCounted)
  if (counted.length < LEARNING_MIN_VIDEOS) return []

  const under = (key: keyof ResearchThresholds) =>
    counted.filter((v) => v.verdict.thresholds[key] === current[key])
  const searchesOf = (v: CountedVideo) => v.demandSearches as number

  const out: Suggestion[] = []
  const add = (
    key: keyof ResearchThresholds,
    direction: 'raise' | 'lower',
    support: CountedVideo[],
    rawTo: number,
    sentence: (count: number, to: number) => string,
    aboveExclusive?: number,
    belowExclusive?: number,
  ) => {
    if (support.length < SUGGESTION_MIN_SUPPORT) return
    const from = current[key]
    const nice = niceRound(rawTo, direction === 'lower' ? 'down' : 'up')
    // The factor-of-two limit wins over nice rounding, then the hard bounds.
    const to = clamp(key, Math.min(from * 2, Math.max(from / 2, nice)))
    if (aboveExclusive !== undefined && to <= aboveExclusive) return
    if (belowExclusive !== undefined && to >= belowExclusive) return
    if (to === from) return
    const dismissed = dismissals
      .filter((d) => d.key === key && d.direction === direction)
      .reduce((m, d) => Math.max(m, d.support), -1)
    if (dismissed >= 0 && support.length < dismissed + DISMISS_RETURN_AFTER) return
    out.push({
      key,
      direction,
      from,
      to,
      support: support.map((v) => v.projectId),
      sentence: sentence(support.length, to),
    })
  }

  // demandWarn, lower: demand warned, searches under the line, yet found for the target.
  {
    const s = under('demandWarn').filter(
      (v) =>
        stateOf(v, 'demand') === 'not-ok' &&
        v.demandSearches !== null &&
        v.demandSearches < current.demandWarn &&
        v.report.foundForTarget === true,
    )
    if (s.length > 0) {
      const raw = Math.max(Math.min(...s.map(searchesOf)), current.demandWarn / 2)
      add(
        'demandWarn',
        'lower',
        s,
        raw,
        (n, to) =>
          `Demand warned on ${videosWord(n)} under ${fmt(current.demandWarn)} searches that were each found for their target. Lower the warning line to ${fmt(to)}?`,
      )
    }
  }

  // demandWarn, raise: searches at or over the line, competition fine, yet not found.
  {
    const s = under('demandWarn').filter(
      (v) =>
        v.demandSearches !== null &&
        v.demandSearches >= current.demandWarn &&
        stateOf(v, 'competition') === 'ok' &&
        v.report.foundForTarget === false,
    )
    if (s.length > 0) {
      const top = niceRound(Math.max(...s.map(searchesOf)), 'up')
      const raw = Math.min(top, current.demandWarn * 2)
      add(
        'demandWarn',
        'raise',
        s,
        raw,
        (n, to) =>
          `${videosWord(n)} at ${fmt(current.demandWarn)} searches or more with clear competition were each not found for their target. Raise the warning line to ${fmt(to)}?`,
        undefined,
        current.demandOk,
      )
    }
  }

  // demandOk, lower: between the two lines, yet found for the target.
  {
    const s = under('demandOk').filter(
      (v) =>
        v.demandSearches !== null &&
        v.demandSearches >= current.demandWarn &&
        v.demandSearches < current.demandOk &&
        v.report.foundForTarget === true,
    )
    if (s.length > 0) {
      const raw = Math.max(Math.min(...s.map(searchesOf)), current.demandOk / 2, current.demandWarn)
      add(
        'demandOk',
        'lower',
        s,
        raw,
        (n, to) =>
          `${videosWord(n)} between ${fmt(current.demandWarn)} and ${fmt(current.demandOk)} searches were each found for their target. Lower the strong demand line to ${fmt(to)}?`,
        current.demandWarn,
      )
    }
  }

  // openDoorMaxSubscribers, raise: competition warned, yet ranked in the top 10.
  {
    const s = under('openDoorMaxSubscribers').filter(
      (v) =>
        stateOf(v, 'competition') === 'not-ok' &&
        v.report.rank !== null &&
        v.report.rank.position !== null &&
        v.report.rank.position <= TOP_RANK,
    )
    add(
      'openDoorMaxSubscribers',
      'raise',
      s,
      current.openDoorMaxSubscribers * 2,
      (n, to) =>
        `Competition warned on ${videosWord(n)} that still ranked in the top 10 at day 28. Raise the open door size to ${fmt(to)} subscribers?`,
    )
  }

  // openDoorMaxSubscribers, lower: competition passed, yet the video did not rank.
  {
    const s = under('openDoorMaxSubscribers').filter(
      (v) =>
        stateOf(v, 'competition') === 'ok' &&
        v.report.rank !== null &&
        v.report.rank.position === null,
    )
    add(
      'openDoorMaxSubscribers',
      'lower',
      s,
      current.openDoorMaxSubscribers / 2,
      (n, to) =>
        `Competition passed on ${videosWord(n)} that did not rank at day 28. Lower the open door size to ${fmt(to)} subscribers?`,
    )
  }

  return out
}
