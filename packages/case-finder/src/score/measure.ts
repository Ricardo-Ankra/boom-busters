import {
  COVERAGE_WINDOW_MONTHS,
  DEMAND_WINDOW_MONTHS,
  LONG_FORM_MIN_SEC,
  OUTLIER_CAP,
  SPIKE_BASELINE_DAYS,
  SPIKE_WINDOW_DAYS,
} from '../config'
import { monthsBefore } from '../dates'
import { median } from '../stats'
import { wholeWordPattern } from '../text'
import type { ChannelUploads, EntryEvidence, IsoDate, MonthlyViews, YoutubeVideo } from '../types'

/**
 * The four raw measurements for one entry. Every one is a pure function of the
 * evidence and its as-of date T and reads nothing dated on or after T: the
 * back-test's validity rests on that, so each window below ends before T.
 */
export interface RawMeasures {
  demand: number
  world: number
  spike: number
  /** null means the search was not measured, which is not the same as zero coverage. */
  coverage: number | null
  enMedianMonthly: number
}

const DAY_MS = 86_400_000

function dayNumber(date: IsoDate): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
}

/** The 24 'YYYY-MM' keys before T's own month, which is excluded however late in it T falls. */
function windowMonths(asOf: IsoDate): string[] {
  const year = Number(asOf.slice(0, 4))
  const month = Number(asOf.slice(5, 7))
  return Array.from({ length: DEMAND_WINDOW_MONTHS }, (_, i) =>
    new Date(Date.UTC(year, month - 1 - (i + 1), 1)).toISOString().slice(0, 7),
  )
}

/** A month missing from the series counts as 0: no recorded views is no interest. */
export function medianMonthly(series: MonthlyViews[], asOf: IsoDate): number {
  const byMonth = new Map(series.map((m) => [m.month, m.views]))
  return median(windowMonths(asOf).map((month) => byMonth.get(month) ?? 0))
}

/** The 14 days T-14 to T-1 against the median of every 14-day sum in the year before them. */
function spikeRatio(evidence: EntryEvidence): number {
  const t = dayNumber(evidence.asOf)
  const byDay = new Map(evidence.enDaily.map((d) => [dayNumber(d.date), d.views]))
  const sumFrom = (start: number) => {
    let total = 0
    for (let d = start; d < start + SPIKE_WINDOW_DAYS; d++) total += byDay.get(d) ?? 0
    return total
  }
  const recentStart = t - SPIKE_WINDOW_DAYS
  const recent = sumFrom(recentStart)
  // Baseline runs T-379 to T-15; a sum counts only if its 14 days lie wholly inside it.
  const baselineStart = recentStart - SPIKE_BASELINE_DAYS
  const sums: number[] = []
  for (let s = baselineStart; s + SPIKE_WINDOW_DAYS <= recentStart; s++) sums.push(sumFrom(s))
  const base = median(sums)
  return base === 0 ? 0 : recent / base
}

/** Whole-word, case-insensitive; an empty query matches nothing. */
export function titleMatches(query: string, title: string): boolean {
  if (query.trim() === '') return false
  return wholeWordPattern(query).test(title)
}

/**
 * Views against the median of the channel's other long-form uploads. This is
 * the measurement side, so it uses uploads of any date; the as-of date is part
 * of the signature but does not filter here.
 */
export function outlierRatio(
  video: YoutubeVideo,
  channel: ChannelUploads | undefined,
  _asOf: IsoDate,
): number | null {
  if (!channel) return null
  const peers = channel.uploads.filter(
    (u) => u.id !== video.id && u.durationSec >= LONG_FORM_MIN_SEC,
  )
  if (peers.length === 0) return null
  const base = median(peers.map((u) => u.views))
  return base === 0 ? null : video.views / base
}

function coverageOf(evidence: EntryEvidence): number | null {
  const { search, entry, asOf } = evidence
  if (!search) return null
  if (entry.query === null) return 0
  const from = monthsBefore(asOf, COVERAGE_WINDOW_MONTHS)
  let total = 0
  for (const v of search.videos) {
    if (v.publishedAt >= asOf || v.publishedAt < from) continue
    if (v.durationSec < LONG_FORM_MIN_SEC) continue
    if (!titleMatches(entry.query, v.title)) continue
    total += Math.min(outlierRatio(v, evidence.channels[v.channelId], asOf) ?? 1, OUTLIER_CAP)
  }
  return total
}

export function measure(e: EntryEvidence): RawMeasures {
  const enMedianMonthly = medianMonthly(e.enMonthly, e.asOf)
  return {
    demand: Math.log10(1 + enMedianMonthly),
    world: Math.log10(1 + medianMonthly(e.worldMonthly, e.asOf)),
    spike: spikeRatio(e),
    coverage: coverageOf(e),
    enMedianMonthly,
  }
}
