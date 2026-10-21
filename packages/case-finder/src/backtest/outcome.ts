import { peerMedian, peersOf } from '../score/channel-median'
import type { ChannelUploads, IsoDate, YoutubeVideo } from '../types'

/**
 * The video's views against the median of the same channel's long-form uploads
 * published within six months either side, settled at least 90 days on
 * `measuredOn`: the peer rule in score/channel-median.ts, which the
 * competition measure shares. Throws when there is nothing to compare against:
 * the case is unusable and the caller reports it rather than scoring a
 * made-up ratio.
 */
export function outcomeRatio(
  video: YoutubeVideo,
  channel: Pick<ChannelUploads, 'uploads'>,
  measuredOn: IsoDate,
): number {
  const base = peerMedian(video, channel, measuredOn)
  if (base !== null) return video.views / base
  throw new Error(
    peersOf(video, channel, measuredOn).length === 0
      ? `No settled peer uploads for video ${video.id}`
      : `Peer median views is 0 for video ${video.id}`,
  )
}
