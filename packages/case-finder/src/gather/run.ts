import type { CourtListenerSource } from '../sources/courtlistener'
import type { EdgarSource } from '../sources/edgar'
import type { PageviewsSource } from '../sources/pageviews'
import type { SecReleasesSource } from '../sources/sec-releases'
import type { WikidataSource } from '../sources/wikidata'
import { normalTitle, type WikipediaSource } from '../sources/wikipedia'
import { uploadsPlaylistId, YoutubeNotFoundError, type YoutubeSource } from '../sources/youtube'
import type { ChannelUploads, DailyViews, IsoDate, MonthlyViews } from '../types'

/**
 * One back-test day's shared state for evidence gathering: the dates every
 * request is asked with, and the per-run memos over pages, lists and
 * channels, so each is fetched once however many entries need it.
 */

export interface Sources {
  pageviews: PageviewsSource
  wikidata: WikidataSource
  wikipedia: WikipediaSource
  youtube: YoutubeSource
  courtlistener: CourtListenerSource
  edgar: EdgarSource
  secReleases: SecReleasesSource
}

export interface GatherOptions {
  /**
   * The day every request treats as today: series end the month and the day
   * before it, and CourtListener is asked for dockets before it. The back-test
   * passes the hitlist snapshot's build day, so a rerun on any later day asks
   * the same questions and the cache answers them all. Default: the clock.
   */
  anchorDay?: IsoDate
}

/**
 * Every series starts here and runs to the anchor whatever T is, so its
 * request is the same for every back-test date and the disk cache serves them
 * all; each T then takes the slice before it.
 */
export const SERIES_FROM_MONTH = '2015-07'
export const SERIES_FROM_DAY = '2015-07-01'

/** A page as it stood before T's month: the revision and what it parsed to. */
export interface PageAtT {
  revision: { revid: number; timestamp: string }
  categories: string[]
  externalLinks: string[]
  links: string[]
}

export interface Run {
  asOf: IsoDate
  sources: Sources
  /** Stands in for today in every request; see GatherOptions. */
  anchorDay: IsoDate
  /** The month before the anchor's: the last one whose monthly total is final. */
  lastMonth: string
  /** The day before the anchor: the last complete day of views. */
  yesterday: IsoDate
  pageAt: (title: string) => Promise<PageAtT | null>
  listLinks: (page: string) => Promise<Set<string>>
  /** Memoised per run; null when the channel's uploads are gone. `size` is how many channels were fetched. */
  uploads: ((channelId: string) => Promise<ChannelUploads | null>) & { size: () => number }
}

function addDays(day: IsoDate, n: number): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

function previousMonth(day: IsoDate): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
}

/** One call per key for the whole run; concurrent callers share the promise. */
function memo<T>(fetch: (key: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>()
  const get = (key: string) => {
    if (!cache.has(key)) cache.set(key, fetch(key))
    return cache.get(key)!
  }
  return Object.assign(get, { size: () => cache.size })
}

export const monthsBefore = (series: MonthlyViews[], asOf: IsoDate) =>
  series.filter((m) => m.month < asOf.slice(0, 7))

export const daysBefore = (series: DailyViews[], asOf: IsoDate) =>
  series.filter((d) => d.date < asOf)

export function createRun(asOf: IsoDate, sources: Sources, options: GatherOptions): Run {
  const anchorDay = options.anchorDay ?? new Date().toISOString().slice(0, 10)
  const month = asOf.slice(0, 7)
  const firstDay = `${month}-01`
  const pageAt = memo(async (key: string): Promise<PageAtT | null> => {
    const title = key.slice(key.indexOf('|') + 1)
    const revision = await sources.wikipedia.revisionBefore(title, firstDay)
    if (revision === null) return null
    return { revision, ...(await sources.wikipedia.parsed(revision.revid)) }
  })
  const listLinks = memo(async (page: string) => {
    const list = await pageAt(`${month}|${page}`)
    return new Set((list?.links ?? []).map(normalTitle))
  })
  const uploads = memo((channelId: string) =>
    sources.youtube
      .uploads(channelId, uploadsPlaylistId(channelId), { maxPages: 1 })
      .catch((error: unknown) => {
        if (error instanceof YoutubeNotFoundError) return null
        throw error
      }),
  )
  return {
    asOf,
    sources,
    anchorDay,
    lastMonth: previousMonth(anchorDay),
    yesterday: addDays(anchorDay, -1),
    pageAt: (title) => pageAt(`${month}|${title}`),
    listLinks,
    uploads,
  }
}
