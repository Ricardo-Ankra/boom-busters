import { BACKTEST, LONG_FORM_MIN_SEC } from '../config'
import { minusDays, monthsBefore } from '../dates'
import { median } from '../stats'
import type { ChannelUploads, IsoDate, YoutubeVideo } from '../types'

/**
 * The video's views against the median of the same channel's long-form uploads
 * published within six months either side. Peers must also be settled (at least
 * 90 days old on `measuredOn`) so a fresh upload's unfinished run does not drag
 * the baseline down. Throws when there is nothing to compare against: the case
 * is unusable and the caller reports it rather than scoring a made-up ratio.
 */
export function outcomeRatio(
  video: YoutubeVideo,
  channel: ChannelUploads,
  measuredOn: IsoDate,
): number {
  const from = monthsBefore(video.publishedAt, BACKTEST.outcomeWindowMonths)
  const to = monthsBefore(video.publishedAt, -BACKTEST.outcomeWindowMonths)
  const settledBy = minusDays(measuredOn, BACKTEST.settledDays)
  const peers = channel.uploads.filter(
    (u) =>
      u.id !== video.id &&
      u.durationSec >= LONG_FORM_MIN_SEC &&
      u.publishedAt >= from &&
      u.publishedAt <= to &&
      u.publishedAt <= settledBy,
  )
  if (peers.length === 0) throw new Error(`No settled peer uploads for video ${video.id}`)
  const base = median(peers.map((u) => u.views))
  if (base === 0) throw new Error(`Peer median views is 0 for video ${video.id}`)
  return video.views / base
}
