import {
  COVERAGE_WINDOW_MONTHS,
  DEMAND_WINDOW_MONTHS,
  LONG_FORM_MIN_SEC,
  OUTLIER_CAP,
  SPIKE_BASELINE_DAYS,
  SPIKE_WINDOW_DAYS,
} from '../config'
import { monthsBefore } from '../dates'
import { reachesBack } from '../sources/youtube'
import { median } from '../stats'
import { wholeWordPattern } from '../text'
import { latestMedian, peerMedian, windowStart } from './channel-median'
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
  /** Search results that count towards coverage (see `countedVideos`); 0 when not measured. */
  countedVideos: number
  /** Of those, the ones whose channel fetch was capped short of their window. */
  cappedVideos: number
  /** The distinct channels behind `cappedVideos`, in search order. */
  cappedChannels: string[]
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
 * The search results that count towards coverage at T: long-form, published
 * before T and within the 24 months before it, with the query in the title.
 * Evidence gathering fetches uploads only for these videos' channels, since no
 * other video's ratio is ever read.
 */
export function countedVideos(
  search: { videos: YoutubeVideo[] },
  query: string,
  asOf: IsoDate,
): YoutubeVideo[] {
  const from = monthsBefore(asOf, COVERAGE_WINDOW_MONTHS)
  return search.videos.filter(
    (v) =>
      v.publishedAt < asOf &&
      v.publishedAt >= from &&
      v.durationSec >= LONG_FORM_MIN_SEC &&
      titleMatches(query, v.title),
  )
}

/**
 * Views against the channel median (spec 5, "Channel medians within the
 * quota"). When the fetch covers the video's window (the history is complete,
 * or holds an upload strictly older than the window start) the median is the outcome's peer rule,
 * settled on the fetch day; when the page cap stopped it short, the channel's
 * latest 50 long-form uploads stand in and the video is `capped`. Today's view
 * counts are the sanctioned hindsight here, so T does not filter the uploads.
 */
export function outlierDetail(
  video: YoutubeVideo,
  channel: ChannelUploads | undefined,
): { ratio: number | null; capped: boolean } {
  if (!channel) return { ratio: null, capped: false }
  const covered = channel.complete || reachesBack(channel.uploads, windowStart(video))
  const base = covered
    ? peerMedian(video, channel, channel.fetchedOn)
    : latestMedian(video, channel)
  return { ratio: base === null ? null : video.views / base, capped: !covered }
}

export function outlierRatio(
  video: YoutubeVideo,
  channel: ChannelUploads | undefined,
): number | null {
  return outlierDetail(video, channel).ratio
}

type Coverage = Pick<RawMeasures, 'coverage' | 'countedVideos' | 'cappedVideos' | 'cappedChannels'>

function coverageOf(evidence: EntryEvidence): Coverage {
  const { search, entry, asOf } = evidence
  if (!search) return { coverage: null, countedVideos: 0, cappedVideos: 0, cappedChannels: [] }
  if (entry.query === null) {
    return { coverage: 0, countedVideos: 0, cappedVideos: 0, cappedChannels: [] }
  }
  const counted = countedVideos(search, entry.query, asOf)
  let coverage = 0
  const capped: YoutubeVideo[] = []
  for (const v of counted) {
    const detail = outlierDetail(v, evidence.channels[v.channelId])
    coverage += Math.min(detail.ratio ?? 1, OUTLIER_CAP)
    if (detail.capped) capped.push(v)
  }
  return {
    coverage,
    countedVideos: counted.length,
    cappedVideos: capped.length,
    cappedChannels: [...new Set(capped.map((v) => v.channelId))],
  }
}

export function measure(e: EntryEvidence): RawMeasures {
  const enMedianMonthly = medianMonthly(e.enMonthly, e.asOf)
  return {
    demand: Math.log10(1 + enMedianMonthly),
    world: Math.log10(1 + medianMonthly(e.worldMonthly, e.asOf)),
    spike: spikeRatio(e),
    ...coverageOf(e),
    enMedianMonthly,
  }
}
