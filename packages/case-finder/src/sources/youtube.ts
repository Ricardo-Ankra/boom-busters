import { z } from 'zod'
import type { ChannelUploads, IsoDate, YoutubeVideo } from '../types'
import { isJson, type PoliteClient } from './http'
import { QuotaExhaustedError, type QuotaLedger } from './quota'

/**
 * YouTube Data API v3: search, channel lookup by handle, channel uploads.
 *
 * Every call that is not served from the disk cache is paid for from the quota
 * ledger before it is sent, so a run can never overdraw the day's units. A
 * cached call costs nothing, and cached answers never expire: the back-test
 * wants one fetch per entry, with the fetch date recorded.
 */

export interface YoutubeSource {
  /** search.list (100 units) plus one videos.list (1 unit) for the hits. */
  search(query: string): Promise<{ fetchedAt: IsoDate; videos: YoutubeVideo[] }>
  /** channels.list, 1 unit. Throws if the handle matches no channel. */
  channelByHandle(handle: string): Promise<{ channelId: string; uploadsPlaylistId: string }>
  /**
   * playlistItems.list plus videos.list, 2 units per 50 uploads, newest first.
   * Pages back until the page whose oldest upload is strictly before `until`,
   * the end of the playlist, or `maxPages`, whichever comes first. Default: all
   * pages. An upload repeated across pages is kept once, as first read.
   */
  uploads(
    channelId: string,
    uploadsPlaylistId: string,
    options?: { maxPages?: number; until?: IsoDate },
  ): Promise<ChannelUploads>
}

const BASE = 'https://www.googleapis.com/youtube/v3'

const COST = { search: 100, videos: 1, channels: 1, playlistItems: 1 } as const

/** A channel's uploads playlist id is its channel id with the `UC` prefix swapped for `UU`. */
export function uploadsPlaylistId(channelId: string): string {
  return channelId.replace(/^UC/, 'UU')
}

/** 'PT1H2M3S' to 3723. Days are honoured ('P1DT1H'); anything unparseable is 0. */
export function parseIsoDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso)
  if (!m) return 0
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((n) => Number(n ?? 0)) as [
    number,
    number,
    number,
    number,
  ]
  return d * 86_400 + h * 3600 + min * 60 + s
}

const searchSchema = z.object({
  items: z.array(z.object({ id: z.object({ videoId: z.string() }) })).default([]),
})

const videosSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({
          channelId: z.string(),
          title: z.string(),
          publishedAt: z.string(),
        }),
        contentDetails: z.object({ duration: z.string().optional() }).optional(),
        statistics: z.object({ viewCount: z.string().optional() }).optional(),
      }),
    )
    .default([]),
})

const channelsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string() }) }),
      }),
    )
    .default([]),
})

const playlistSchema = z.object({
  nextPageToken: z.string().optional(),
  items: z.array(z.object({ contentDetails: z.object({ videoId: z.string() }) })).default([]),
})

const errorBodySchema = z.object({
  error: z.object({ errors: z.array(z.object({ reason: z.string().optional() })).default([]) }),
})

const QUOTA_REASONS = ['quotaExceeded', 'dailyLimitExceeded']
const NOT_FOUND_REASONS = ['playlistNotFound']

/**
 * A resource YouTube says is gone: a deleted or emptied channel's uploads
 * playlist answers 404 `playlistNotFound`. The 404 is cached like any settled
 * answer, so a caller that can do without the resource must catch this rather
 * than fail, or every rerun fails on the same cached answer.
 */
export class YoutubeNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'YoutubeNotFoundError'
  }
}

function hasReason(body: string, reasons: string[]): boolean {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(body))
    return parsed.success && parsed.data.error.errors.some((e) => reasons.includes(e.reason ?? ''))
  } catch {
    return false
  }
}

function toVideo(item: z.infer<typeof videosSchema>['items'][number]): YoutubeVideo {
  return {
    id: item.id,
    channelId: item.snippet.channelId,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt.slice(0, 10),
    durationSec: parseIsoDuration(item.contentDetails?.duration ?? ''),
    views: Number(item.statistics?.viewCount ?? 0) || 0,
  }
}

/**
 * Some upload in `videos` is published strictly before `until`: the spec's
 * "older than" the window start. Uploads on `until` itself are inside the
 * window, and a newer one dated before it may not have been read yet.
 */
export function reachesBack(videos: YoutubeVideo[], until: IsoDate): boolean {
  return videos.some((v) => v.publishedAt < until)
}

export function liveYoutube(
  client: PoliteClient,
  apiKey: string,
  ledger: QuotaLedger,
): YoutubeSource {
  /**
   * One API call: ask the cache first, pay the ledger only for a real request
   * and before sending it, and turn a quota 403 into QuotaExhaustedError.
   * `getText` is used because getJson cannot tell a quota 403 from any other.
   */
  async function call<T>(
    endpoint: string,
    params: string,
    units: number,
    schema: z.ZodType<T>,
  ): Promise<{ data: T; fetchedAt: IsoDate }> {
    const url = `${BASE}/${endpoint}?${params}&key=${encodeURIComponent(apiKey)}`
    if (!(await client.isCached(url, { accept: isJson }))) ledger.spend(units)
    const res = await client.getText(url, { accept: isJson })
    const safeUrl = `${BASE}/${endpoint}?${params}`
    if (res.status === 403 && hasReason(res.data, QUOTA_REASONS)) {
      throw new QuotaExhaustedError(`YouTube reported quota exhausted on ${safeUrl}`)
    }
    if (res.status === 404 || hasReason(res.data, NOT_FOUND_REASONS)) {
      throw new YoutubeNotFoundError(`GET ${safeUrl} found nothing (status ${res.status})`)
    }
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`GET ${safeUrl} failed with status ${res.status}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(res.data)
    } catch {
      throw new Error(`GET ${safeUrl} did not return JSON`)
    }
    const checked = schema.safeParse(parsed)
    if (!checked.success) {
      throw new Error(`GET ${safeUrl} returned an unexpected shape: ${checked.error.message}`)
    }
    return { data: checked.data, fetchedAt: res.fetchedAt }
  }

  /** videos.list for up to 50 ids, in the order asked; ids YouTube omits (deleted, private) drop out. */
  async function videosFor(ids: string[]): Promise<YoutubeVideo[]> {
    if (ids.length === 0) return []
    const { data } = await call(
      'videos',
      `part=snippet,contentDetails,statistics&id=${ids.join(',')}`,
      COST.videos,
      videosSchema,
    )
    const byId = new Map(data.items.map((item) => [item.id, toVideo(item)]))
    return ids.flatMap((id) => byId.get(id) ?? [])
  }

  return {
    async search(query) {
      const { data, fetchedAt } = await call(
        'search',
        `part=snippet&type=video&maxResults=25&q=${encodeURIComponent(query)}`,
        COST.search,
        searchSchema,
      )
      const videos = await videosFor(data.items.map((item) => item.id.videoId))
      return { fetchedAt, videos }
    },

    async channelByHandle(handle) {
      const { data } = await call(
        'channels',
        `part=contentDetails&forHandle=${encodeURIComponent(handle)}`,
        COST.channels,
        channelsSchema,
      )
      const channel = data.items[0]
      if (!channel) throw new Error(`No YouTube channel found for handle ${handle}`)
      return {
        channelId: channel.id,
        uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
      }
    },

    // Each page's URL is the same however deep the caller asks, so a deeper
    // request later re-reads the earlier pages from the cache for free. That
    // joins pages fetched on different days: if the channel posted in between,
    // the first live page repeats uploads the cached one ended with. Those are
    // dropped, keeping the earlier copy; uploads a deletion shifted past the
    // seam cannot be recovered (the report's channel-median caveat says so).
    async uploads(channelId, playlistId, options = {}) {
      const maxPages = options.maxPages ?? Infinity
      const uploads: YoutubeVideo[] = []
      const seen = new Set<string>()
      let pageToken: string | undefined
      let fetchedOn: IsoDate | undefined
      for (let page = 1; ; page++) {
        const { data, fetchedAt } = await call(
          'playlistItems',
          `part=contentDetails&maxResults=50&playlistId=${encodeURIComponent(playlistId)}` +
            (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''),
          COST.playlistItems,
          playlistSchema,
        )
        fetchedOn ??= fetchedAt
        const ids = data.items.map((item) => item.contentDetails.videoId)
        const fresh = ids.filter((id) => !seen.has(id))
        for (const id of fresh) seen.add(id)
        const videos = await videosFor(fresh)
        uploads.push(...videos)
        pageToken = data.nextPageToken
        if (!pageToken) return { channelId, uploads, fetchedOn, complete: true }
        const reached = options.until !== undefined && reachesBack(videos, options.until)
        if (reached || page >= maxPages) return { channelId, uploads, fetchedOn, complete: false }
      }
    },
  }
}
