import { FLOOR_MEDIAN_MONTHLY } from './config'
import { laneOf } from './hitlist/build'
import { populationAt } from './score/rank'
import { measure } from './score/measure'
import type { CourtListenerSource } from './sources/courtlistener'
import type { EdgarSource } from './sources/edgar'
import type { PageviewsSource } from './sources/pageviews'
import { referencesAsDocuments } from './sources/references'
import { releasesNaming, type SecRelease, type SecReleasesSource } from './sources/sec-releases'
import type { WikidataSource } from './sources/wikidata'
import { normalTitle, type WikipediaSource } from './sources/wikipedia'
import { uploadsPlaylistId, type YoutubeSource } from './sources/youtube'
import type {
  ChannelUploads,
  DailyViews,
  DatedTag,
  EntryEvidence,
  HitlistEntry,
  IsoDate,
  Lane,
  MonthlyViews,
  Person,
  PrimaryDocument,
} from './types'

/**
 * Each hitlist entry's evidence as it stood on a back-test day T. The
 * back-test is only valid if nothing here is dated on or after T, so every
 * series is cut to the months or days before T, tags are dated against the
 * article (and list page) revision before T's month, and every document
 * source is asked for, or filtered to, what predates T. The sanctioned
 * exceptions are YouTube (today's view counts and uploads) and the Wikidata
 * people facts (undated).
 *
 * Two passes, so the YouTube quota is spent only where it counts: pass 1
 * reads pageviews and tags for everyone, which is enough to pick the ranked
 * population; pass 2 gathers the rest for that population alone.
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

/**
 * Every series starts here and runs to the present whatever T is, so its
 * request is the same for every back-test date and the disk cache serves them
 * all; each T then takes the slice before it.
 */
const SERIES_FROM_MONTH = '2015-07'
const SERIES_FROM_DAY = '2015-07-01'
const PROGRESS_EVERY = 100

/** A page as it stood before T's month: the revision and what it parsed to. */
interface PageAtT {
  revision: { revid: number; timestamp: string }
  categories: string[]
  externalLinks: string[]
  links: string[]
}

/** What pass 1 learned about one entry, carried into pass 2. */
interface PassOne {
  evidence: EntryEvidence
  enTitles: string[]
  page: PageAtT | null
}

interface Run {
  asOf: IsoDate
  sources: Sources
  today: IsoDate
  /** The month before today's: the last one whose monthly total is final. */
  lastMonth: string
  yesterday: IsoDate
  pageAt: (title: string) => Promise<PageAtT | null>
  listLinks: (page: string) => Promise<Set<string>>
  /** Memoised per run; `size` is how many channels were fetched. */
  uploads: ((channelId: string) => Promise<ChannelUploads>) & { size: () => number }
}

function addDays(day: IsoDate, n: number): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

function previousMonth(day: IsoDate): string {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7)
}

/** `dewiki` is `de.wikipedia`; `zh_yuewiki` is `zh-yue.wikipedia`. */
function projectOf(site: string): string {
  return `${site.replace(/wiki$/, '').replaceAll('_', '-')}.wikipedia`
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

const monthsBefore = (series: MonthlyViews[], asOf: IsoDate) =>
  series.filter((m) => m.month < asOf.slice(0, 7))

const daysBefore = (series: DailyViews[], asOf: IsoDate) => series.filter((d) => d.date < asOf)

const nonBlank = (text: string | null): text is string => text !== null && text.trim() !== ''

/**
 * The tags that applied at T. Any tag with a `since` on or after T is out.
 * A category tag needs the article's revision before T's month to carry the
 * category, and a list tag needs the list page's revision then to link to the
 * article under its title or any of its redirects (the list may use an older
 * name): categories and list entries are added after the fact, often long
 * after. With `pages` null (an entry below the floor, never fetched) both
 * kinds are dropped.
 */
async function tagsAt(
  entry: HitlistEntry,
  asOf: IsoDate,
  pages: { page: PageAtT | null; enTitles: string[]; listLinks: Run['listLinks'] } | null,
): Promise<DatedTag[]> {
  const out: DatedTag[] = []
  for (const tag of entry.tags) {
    if (tag.since !== null && tag.since >= asOf) continue
    if (tag.tag.startsWith('category:')) {
      const name = normalTitle(tag.tag.slice('category:'.length))
      if (pages?.page?.categories.some((c) => normalTitle(c) === name)) out.push(tag)
    } else if (tag.tag.startsWith('list:')) {
      if (pages === null) continue
      const links = await pages.listLinks(tag.tag.slice('list:'.length))
      if (pages.enTitles.some((t) => links.has(normalTitle(t)))) out.push(tag)
    } else {
      out.push(tag)
    }
  }
  return out
}

/** The English title and every redirect to it; empty with no English article. */
async function enTitlesOf(entry: HitlistEntry, sources: Sources): Promise<string[]> {
  if (entry.enTitle === null) return []
  return [entry.enTitle, ...(await sources.wikipedia.redirectsTo(entry.enTitle))]
}

/** Pageviews and tags for one entry; the revision is read only above the floor. */
async function passOne(entry: HitlistEntry, run: Run): Promise<PassOne> {
  const { asOf, sources } = run
  const enTitles = await enTitlesOf(entry, sources)
  let enMonthly: MonthlyViews[] = []
  if (entry.enTitle !== null) {
    const series = await sources.pageviews.monthly(
      'en.wikipedia',
      enTitles,
      SERIES_FROM_MONTH,
      run.lastMonth,
    )
    enMonthly = monthsBefore(series, asOf)
  }
  const evidence: EntryEvidence = {
    entry,
    asOf,
    enMonthly,
    worldMonthly: [],
    enDaily: [],
    search: null,
    channels: {},
    documents: [],
    people: [],
    tagsAtT: [],
  }
  // The floor needs only the English series, so an entry below it costs no revision fetch.
  if (entry.enTitle === null || measure(evidence).enMedianMonthly < FLOOR_MEDIAN_MONTHLY) {
    evidence.tagsAtT = await tagsAt(entry, asOf, null)
    return { evidence, enTitles, page: null }
  }
  const page = await run.pageAt(entry.enTitle)
  evidence.tagsAtT = await tagsAt(entry, asOf, { page, enTitles, listLinks: run.listLinks })
  return { evidence, enTitles, page }
}

/** Every Wikipedia edition but English, titles only, summed into one row per month. */
async function worldMonthly(entry: HitlistEntry, run: Run): Promise<MonthlyViews[]> {
  const total = new Map<string, number>()
  for (const [site, title] of Object.entries(entry.sitelinks)) {
    if (site === 'enwiki') continue
    const series = await run.sources.pageviews.monthly(
      projectOf(site),
      [title],
      SERIES_FROM_MONTH,
      run.lastMonth,
    )
    for (const m of series) total.set(m.month, (total.get(m.month) ?? 0) + m.views)
  }
  const rows = [...total]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, views]) => ({ month, views }))
  return monthsBefore(rows, run.asOf)
}

/** Primary documents from every source, each limited to what predates T. */
async function documentsOf(
  one: PassOne,
  lane: Lane,
  index: SecRelease[],
  run: Run,
): Promise<PrimaryDocument[]> {
  const { entry } = one.evidence
  const { asOf, sources } = run
  const documents: PrimaryDocument[] = []
  if (nonBlank(entry.query)) {
    // Asked as of today so one cached answer serves every T, then cut to T here.
    const dockets = await sources.courtlistener.dockets(entry.query, run.today)
    documents.push(...dockets.filter((d) => d.datedAt === null || d.datedAt < asOf))
  }
  if (entry.cik !== null) documents.push(...(await sources.edgar.filings(entry.cik, lane, asOf)))
  const names = [entry.query, entry.enTitle].filter(nonBlank)
  documents.push(...releasesNaming(index, names, asOf))
  if (one.page !== null) {
    documents.push(...referencesAsDocuments(one.page.externalLinks, one.page.revision.timestamp))
  }
  return documents
}

/** Everything else for one ranked entry. Errors propagate: a silent skip would bias the ranking. */
async function passTwo(
  one: PassOne,
  lane: Lane,
  shared: { index: SecRelease[]; people: Map<string, Person[]> },
  run: Run,
): Promise<{ evidence: EntryEvidence; searched: boolean }> {
  const { entry } = one.evidence
  const { asOf, sources } = run
  const enDaily =
    one.enTitles.length === 0
      ? []
      : daysBefore(
          await sources.pageviews.daily(
            'en.wikipedia',
            one.enTitles,
            SERIES_FROM_DAY,
            run.yesterday,
          ),
          asOf,
        )
  // Never null for a ranked entry: rank treats null as unmeasured and throws.
  const { query } = entry
  const searched = nonBlank(query)
  const search = nonBlank(query)
    ? await sources.youtube.search(query)
    : { fetchedAt: run.today, videos: [] }
  const channels: Record<string, ChannelUploads> = {}
  for (const channelId of new Set(search.videos.map((v) => v.channelId))) {
    channels[channelId] = await run.uploads(channelId)
  }
  return {
    searched,
    evidence: {
      ...one.evidence,
      enDaily,
      worldMonthly: await worldMonthly(entry, run),
      search,
      channels,
      documents: await documentsOf(one, lane, shared.index, run),
      people: shared.people.get(entry.qid) ?? [],
    },
  }
}

/** One back-test day's shared state: dates, and the per-run memos over pages, lists and channels. */
function createRun(asOf: IsoDate, sources: Sources, now: () => Date = () => new Date()): Run {
  const today = now().toISOString().slice(0, 10)
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
    sources.youtube.uploads(channelId, uploadsPlaylistId(channelId), { maxPages: 1 }),
  )
  return {
    asOf,
    sources,
    today,
    lastMonth: previousMonth(today),
    yesterday: addDays(today, -1),
    pageAt: (title) => pageAt(`${month}|${title}`),
    listLinks,
    uploads,
  }
}

/**
 * The lane one entry had at T, by the same tag dating as pass 1 of `gatherAt`
 * but with no floor check: the back-test needs each subject's lane to pick its
 * test set before any evidence is gathered, whatever the subject's pageviews.
 */
export async function laneAt(
  entry: HitlistEntry,
  asOf: IsoDate,
  sources: Sources,
  options: { now?: () => Date } = {},
): Promise<Lane | null> {
  const run = createRun(asOf, sources, options.now)
  const enTitles = await enTitlesOf(entry, sources)
  const page = entry.enTitle === null ? null : await run.pageAt(entry.enTitle)
  return laneOf(await tagsAt(entry, asOf, { page, enTitles, listLinks: run.listLinks }))
}

export async function gatherAt(
  hitlist: HitlistEntry[],
  asOf: IsoDate,
  sources: Sources,
  log: (line: string) => void,
  options: { now?: () => Date } = {},
): Promise<EntryEvidence[]> {
  const run = createRun(asOf, sources, options.now)

  const first: PassOne[] = []
  for (const entry of hitlist) {
    first.push(await passOne(entry, run))
    if (first.length % PROGRESS_EVERY === 0) {
      log(`evidence ${asOf}: pass 1 ${first.length}/${hitlist.length}`)
    }
  }

  const population = populationAt(first.map((p) => p.evidence))
  const laneByQid = new Map<string, Lane>()
  for (const [lane, ranked] of population) {
    for (const e of ranked) laneByQid.set(e.entry.qid, lane)
  }
  const ranked = first.filter((p) => laneByQid.has(p.evidence.entry.qid))

  let searches = 0
  const out = new Map(first.map((p) => [p.evidence.entry.qid, p.evidence]))
  if (ranked.length > 0) {
    const facts = await sources.wikidata.facts(ranked.map((p) => p.evidence.entry.qid))
    const shared = {
      index: await sources.secReleases.index(),
      people: new Map([...facts].map(([qid, f]) => [qid, f.people])),
    }
    let done = 0
    for (const one of ranked) {
      const lane = laneByQid.get(one.evidence.entry.qid)!
      const { evidence, searched } = await passTwo(one, lane, shared, run)
      out.set(evidence.entry.qid, evidence)
      if (searched) searches++
      if (++done % PROGRESS_EVERY === 0) {
        log(`evidence ${asOf}: pass 2 ${done}/${ranked.length}`)
      }
    }
  }

  const lanes = [...population].map(([lane, e]) => `${lane}=${e.length}`).join(', ')
  log(
    `evidence ${asOf}: ${hitlist.length} entries; population ${lanes}; ` +
      `${searches} YouTube searches; ${run.uploads.size()} channels fetched`,
  )
  return first.map((p) => out.get(p.evidence.entry.qid)!)
}
