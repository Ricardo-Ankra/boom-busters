import { z } from 'zod'
import { ResearchThresholdsSchema, type ResearchThresholds } from './research-thresholds'
import type { TermBucket } from './search-terms-match'

export type Checkpoint = 7 | 28 | 90
export const CHECKPOINTS = [7, 28, 90] as const
/** A report is fetched on the first daily run at or after checkpoint + this many days. */
export const REPORT_LAG_DAYS = 3
/** A failed model call defers the freeze for up to this many daily runs. */
export const MODEL_DEFER_MAX = 3
/** A rank check refused by the credit cap waits up to this many daily runs. */
export const RANK_DEFER_MAX = 7

export type SearchOutcome =
  | 'too-early'
  | 'no-research'
  | 'search-barely-played'
  | 'no-terms'
  | 'too-little-search'
  | 'hit-and-held'
  | 'hit-then-left'
  | 'found-another-way'
  | 'missed-target'

export const OUTCOME_COPY: Record<SearchOutcome, { label: string; advice: string }> = {
  'too-early': { label: 'Too early', advice: 'Wait. The live terms are shown meanwhile.' },
  'no-research': {
    label: 'No research to judge',
    advice: 'There is no brief or target keyword, so only the terms and delivery are shown.',
  },
  'search-barely-played': {
    label: 'Search barely played',
    advice: "The research had little to say about this video's views.",
  },
  'no-terms': {
    label: 'YouTube shows no search terms yet',
    advice: 'Search brought some views, but YouTube lists no search terms for them yet.',
  },
  'too-little-search': {
    label: 'Too little search to judge',
    advice: 'There are not enough search terms yet to say.',
  },
  'hit-and-held': { label: 'Hit and held', advice: 'The research and the video both worked.' },
  'hit-then-left': {
    label: 'Hit, then left',
    advice:
      'The keyword was right. Check the title and the first 30 seconds against what these searchers wanted.',
  },
  'found-another-way': {
    label: 'Found another way',
    advice: 'The video found a different audience. Look at the unresearched terms.',
  },
  'missed-target': {
    label: 'Missed the target',
    advice: 'Search played, but not for what we aimed at, and what came did not stay.',
  },
}

export type LengthBand = 'short' | 'mid' | 'long'

export function lengthBand(durationSec: number | null): LengthBand | null {
  if (durationSec === null) return null
  if (durationSec < 600) return 'short'
  if (durationSec <= 1200) return 'mid'
  return 'long'
}

/** Share of all viewers lost by the 30 second mark; null when the curve cannot say. */
export function earlyDrop(
  curve: { pct: number; ratio: number }[] | null,
  durationSec: number | null,
): number | null {
  if (!curve || curve.length === 0 || !durationSec || durationSec <= 0) return null
  const pts = [...curve].sort((a, b) => a.pct - b.pct)
  const mark = (30 / durationSec) * 100
  const first = pts[0]
  if (!first) return null
  if (first.pct >= mark || first.ratio <= 0) return null
  const hi = pts.findIndex((p) => p.pct >= mark)
  if (hi < 0) return null
  const a = pts[hi - 1]
  const c = pts[hi]
  if (!a || !c) return null
  const r =
    c.pct === a.pct ? c.ratio : a.ratio + ((c.ratio - a.ratio) * (mark - a.pct)) / (c.pct - a.pct)
  return Math.min(1, Math.max(0, 1 - r / first.ratio))
}

export function holdSec(views: number, minutes: number): number | null {
  return views > 0 ? (minutes * 60) / views : null
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  const hi = s[m] as number
  return s.length % 2 ? hi : ((s[m - 1] as number) + hi) / 2
}

export type BaselineBasis = 'band' | 'channel' | 'own'

export function baseline(
  own: number | null,
  band: number[],
  channel: number[],
): { value: number | null; basis: BaselineBasis } {
  if (band.length >= 3) return { value: median(band), basis: 'band' }
  if (channel.length >= 3) return { value: median(channel), basis: 'channel' }
  return { value: own, basis: 'own' }
}

const BucketSchema = z.enum(['target', 'researched', 'unresearched', 'unmatched'])
const BucketStatSchema = z.object({ views: z.number(), holdSec: z.number().nullable() })
const BaselineSchema = z.object({
  value: z.number().nullable(),
  basis: z.enum(['band', 'channel', 'own']),
})

export const SearchReportSchema = z.object({
  checkpoint: z.union([z.literal(7), z.literal(28), z.literal(90)]),
  range: z.object({ start: z.string(), end: z.string() }),
  computedAt: z.string(),
  publishedAt: z.string(),
  durationSec: z.number().nullable(),
  views: z.number(),
  searchViews: z.number(),
  searchShare: z.number().nullable(),
  targetKeyword: z.string().nullable(),
  terms: z
    .array(
      z.object({
        term: z.string(),
        views: z.number(),
        minutes: z.number(),
        bucket: BucketSchema,
        keyword: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .max(25),
  buckets: z.object({
    target: BucketStatSchema,
    researched: BucketStatSchema,
    unresearched: BucketStatSchema,
    unmatched: BucketStatSchema,
  }),
  listedViews: z.number(),
  foundForTarget: z.boolean().nullable(),
  earlyDrop: z.number().nullable(),
  avgViewDurationSec: z.number().nullable(),
  engagement: z.object({
    subscribersPer1k: z.number().nullable(),
    likesPer1k: z.number().nullable(),
    commentsPer1k: z.number().nullable(),
  }),
  baselines: z.object({
    searchHoldSec: BaselineSchema,
    earlyDrop: BaselineSchema,
    subscribersPer1k: BaselineSchema,
  }),
  rank: z
    .object({
      keyword: z.string(),
      position: z.number().nullable(),
      checkedAt: z.string(),
    })
    .nullable(),
  rankSkipped: z.string().optional(),
  matching: z.enum(['full', 'deterministic-only', 'none']),
  outcome: z.enum([
    'too-early',
    'no-research',
    'search-barely-played',
    'no-terms',
    'too-little-search',
    'hit-and-held',
    'hit-then-left',
    'found-another-way',
    'missed-target',
  ]),
  thresholds: ResearchThresholdsSchema,
})

export type SearchReport = z.infer<typeof SearchReportSchema>

type Buckets = SearchReport['buckets']

/** Null while the floors are unmet; otherwise the share rule or the top-term rule. */
export function foundForTarget(
  buckets: Buckets,
  terms: { views: number; bucket: TermBucket }[],
  t: ResearchThresholds,
): boolean | null {
  const listed =
    buckets.target.views +
    buckets.researched.views +
    buckets.unresearched.views +
    buckets.unmatched.views
  if (listed < t.listedViewsMin || buckets.target.views < t.targetViewsMin) return null
  if (buckets.target.views / listed >= t.targetShareMin) return true
  let top: { views: number; bucket: TermBucket } | null = null
  for (const x of terms) if (top === null || x.views > top.views) top = x
  return top !== null && top.bucket === 'target'
}

export function searchOutcome(
  input: {
    hasTarget: boolean
    days: number
    views: number
    searchShare: number | null
    terms: number
    listedViews: number
    found: boolean | null
    targetHoldSec: number | null
    otherViews: number
    otherHoldSec: number | null
    holdBaseline: number | null
  },
  t: ResearchThresholds,
): SearchOutcome {
  const good = (hold: number | null) =>
    input.holdBaseline !== null && hold !== null && hold >= t.holdRatio * input.holdBaseline
  if (input.days < 7 || input.views < t.tooEarlyViews) return 'too-early'
  if (!input.hasTarget) return 'no-research'
  if (input.searchShare !== null && input.searchShare < t.searchShareMin) {
    return 'search-barely-played'
  }
  if (input.terms === 0) return 'no-terms'
  if (input.found === null) return 'too-little-search'
  if (input.found) return good(input.targetHoldSec) ? 'hit-and-held' : 'hit-then-left'
  if (
    input.listedViews > 0 &&
    input.otherViews / input.listedViews >= t.targetShareMin &&
    good(input.otherHoldSec)
  ) {
    return 'found-another-way'
  }
  return 'missed-target'
}

const per1k = (n: number | null, views: number): number | null =>
  n === null || views <= 0 ? null : (n / views) * 1000

const DAY_MS = 86_400_000

/** The one pure assembly the runner and the live view both call. */
export function buildSearchReport(input: {
  checkpoint: Checkpoint
  range: { start: string; end: string }
  publishedAt: string
  durationSec: number | null
  views: number
  searchViews: number
  avgViewDurationSec: number | null
  subscribersGained: number | null
  likes: number | null
  comments: number | null
  retentionCurve: { pct: number; ratio: number }[] | null
  terms: {
    term: string
    views: number
    minutes: number
    bucket: TermBucket
    keyword?: string
    reason?: string
  }[]
  targetKeyword: string | null
  matching: 'full' | 'deterministic-only' | 'none'
  rank: { keyword: string; position: number | null; checkedAt: string } | null
  rankSkipped?: string
  baselineInputs: {
    holdBand: number[]
    holdChannel: number[]
    dropBand: number[]
    dropChannel: number[]
    subsBand: number[]
    subsChannel: number[]
  }
  thresholds: ResearchThresholds
  now: Date
}): SearchReport {
  const t = input.thresholds
  const sums: Record<TermBucket, { views: number; minutes: number }> = {
    target: { views: 0, minutes: 0 },
    researched: { views: 0, minutes: 0 },
    unresearched: { views: 0, minutes: 0 },
    unmatched: { views: 0, minutes: 0 },
  }
  for (const x of input.terms) {
    sums[x.bucket].views += x.views
    sums[x.bucket].minutes += x.minutes
  }
  const stat = (b: TermBucket) => ({
    views: sums[b].views,
    holdSec: holdSec(sums[b].views, sums[b].minutes),
  })
  const buckets: Buckets = {
    target: stat('target'),
    researched: stat('researched'),
    unresearched: stat('unresearched'),
    unmatched: stat('unmatched'),
  }
  const listedViews = input.terms.reduce((n, x) => n + x.views, 0)
  const found = foundForTarget(buckets, input.terms, t)
  const drop = earlyDrop(input.retentionCurve, input.durationSec)
  const searchShare = input.views > 0 ? input.searchViews / input.views : null
  const subsPer1k = per1k(input.subscribersGained, input.views)
  const bi = input.baselineInputs
  const baselines = {
    searchHoldSec: baseline(input.avgViewDurationSec, bi.holdBand, bi.holdChannel),
    earlyDrop: baseline(drop, bi.dropBand, bi.dropChannel),
    subscribersPer1k: baseline(subsPer1k, bi.subsBand, bi.subsChannel),
  }
  const otherViews = buckets.researched.views + buckets.unresearched.views
  const otherMinutes = sums.researched.minutes + sums.unresearched.minutes
  const days = (input.now.getTime() - new Date(input.publishedAt).getTime()) / DAY_MS
  const outcome = searchOutcome(
    {
      hasTarget: input.targetKeyword !== null,
      days,
      views: input.views,
      searchShare,
      terms: input.terms.length,
      listedViews,
      found,
      targetHoldSec: buckets.target.holdSec,
      otherViews,
      otherHoldSec: holdSec(otherViews, otherMinutes),
      holdBaseline: baselines.searchHoldSec.value,
    },
    t,
  )
  const terms = [...input.terms].sort((a, b) => b.views - a.views).slice(0, 25)
  return {
    checkpoint: input.checkpoint,
    range: input.range,
    computedAt: input.now.toISOString(),
    publishedAt: input.publishedAt,
    durationSec: input.durationSec,
    views: input.views,
    searchViews: input.searchViews,
    searchShare,
    targetKeyword: input.targetKeyword,
    terms,
    buckets,
    listedViews,
    foundForTarget: found,
    earlyDrop: drop,
    avgViewDurationSec: input.avgViewDurationSec,
    engagement: {
      subscribersPer1k: subsPer1k,
      likesPer1k: per1k(input.likes, input.views),
      commentsPer1k: per1k(input.comments, input.views),
    },
    baselines,
    rank: input.rank,
    ...(input.rankSkipped !== undefined ? { rankSkipped: input.rankSkipped } : {}),
    matching: input.matching,
    outcome,
    thresholds: { ...t },
  }
}
