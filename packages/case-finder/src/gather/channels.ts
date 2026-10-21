import { CHANNEL_HISTORY_MAX_PAGES } from '../config'
import { windowStart } from '../score/channel-median'
import {
  reachesBack,
  uploadsPlaylistId,
  YoutubeNotFoundError,
  type YoutubeSource,
} from '../sources/youtube'
import type { ChannelUploads, IsoDate, YoutubeVideo } from '../types'

/**
 * Channel histories within the quota (spec 5, "Channel medians within the
 * quota"). Only channels with a counted video are fetched, each back to the
 * window of its oldest counted video and at most CHANNEL_HISTORY_MAX_PAGES
 * pages. The memo holds one history per channel for as long as its owner
 * keeps it (the back-test keeps one across every test date) and deepens it
 * only when a request needs older uploads than it holds and more could come:
 * a complete history has nothing older, and a capped one would stop at the
 * same page again. The disk cache serves the earlier pages of a deeper fetch.
 */

export interface ChannelMemo {
  /** The channel's uploads back to `until` if the cap allows; null when its playlist is gone. */
  fetch(channelId: string, until: IsoDate): Promise<ChannelUploads | null>
}

interface Held {
  uploads: ChannelUploads
  /** The page cap stopped the fetch before it read an upload older than the date asked for. */
  capped: boolean
}

/** For each channel, the window start of its oldest counted video, in search order. */
export function historyNeeded(counted: YoutubeVideo[]): Map<string, IsoDate> {
  const until = new Map<string, IsoDate>()
  for (const v of counted) {
    const start = windowStart(v)
    const held = until.get(v.channelId)
    if (held === undefined || start < held) until.set(v.channelId, start)
  }
  return until
}

export function channelMemo(youtube: YoutubeSource): ChannelMemo {
  const held = new Map<string, Promise<Held | null>>()

  async function load(channelId: string, until: IsoDate): Promise<Held | null> {
    try {
      const uploads = await youtube.uploads(channelId, uploadsPlaylistId(channelId), {
        until,
        maxPages: CHANNEL_HISTORY_MAX_PAGES,
      })
      return { uploads, capped: !uploads.complete && !reachesBack(uploads.uploads, until) }
    } catch (error) {
      // The 404 is cached, so failing here would fail every rerun; the channel is left out.
      if (error instanceof YoutubeNotFoundError) return null
      throw error
    }
  }

  const covers = (h: Held, until: IsoDate) =>
    h.uploads.complete || h.capped || reachesBack(h.uploads.uploads, until)

  return {
    fetch(channelId, until) {
      // Chained on the last request for the channel, so concurrent callers never fetch twice.
      const prior = held.get(channelId) ?? Promise.resolve(undefined)
      const next = prior.then((h) =>
        h === null || (h !== undefined && covers(h, until)) ? h : load(channelId, until),
      )
      held.set(channelId, next)
      return next.then((h) => h?.uploads ?? null)
    },
  }
}
