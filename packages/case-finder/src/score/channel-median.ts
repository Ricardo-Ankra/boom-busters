import { BACKTEST, CHANNEL_FALLBACK_UPLOADS, LONG_FORM_MIN_SEC } from '../config'
import { minusDays, monthsBefore } from '../dates'
import { median } from '../stats'
import type { ChannelUploads, IsoDate, YoutubeVideo } from '../types'

/**
 * What a video's views are measured against: the median views of the same
 * channel's other long-form uploads. The outcome (spec 9.3) and the
 * competition measure (spec 5) share the peer rule here, so the two can never
 * drift apart. Both return null when there is nothing to compare against.
 */

type Uploads = Pick<ChannelUploads, 'uploads'>

/** The first day of the video's peer window: six months before it was published. */
export function windowStart(video: YoutubeVideo): IsoDate {
  return monthsBefore(video.publishedAt, BACKTEST.outcomeWindowMonths)
}

function medianOrNull(peers: YoutubeVideo[]): number | null {
  if (peers.length === 0) return null
  const base = median(peers.map((u) => u.views))
  return base === 0 ? null : base
}

const otherLongForm = (video: YoutubeVideo, u: YoutubeVideo) =>
  u.id !== video.id && u.durationSec >= LONG_FORM_MIN_SEC

/**
 * The peer rule: long-form uploads published within six months either side
 * of the video, and settled (at least 90 days old on `settledOn`, the day the
 * views were read) so a fresh upload's unfinished run does not drag the
 * baseline down.
 */
export function peersOf(video: YoutubeVideo, channel: Uploads, settledOn: IsoDate): YoutubeVideo[] {
  const from = windowStart(video)
  const to = monthsBefore(video.publishedAt, -BACKTEST.outcomeWindowMonths)
  const settledBy = minusDays(settledOn, BACKTEST.settledDays)
  return channel.uploads.filter(
    (u) =>
      otherLongForm(video, u) &&
      u.publishedAt >= from &&
      u.publishedAt <= to &&
      u.publishedAt <= settledBy,
  )
}

/** The median views of the video's peers; see `peersOf`. */
export function peerMedian(
  video: YoutubeVideo,
  channel: Uploads,
  settledOn: IsoDate,
): number | null {
  return medianOrNull(peersOf(video, channel, settledOn))
}

/**
 * The fallback when the fetch was capped short of the video's window: the
 * channel's latest 50 long-form uploads, which every fetch holds. Uploads are
 * newest first, so these are the first 50 that qualify.
 */
export function latestMedian(video: YoutubeVideo, channel: Uploads): number | null {
  return medianOrNull(
    channel.uploads.filter((u) => otherLongForm(video, u)).slice(0, CHANNEL_FALLBACK_UPLOADS),
  )
}
