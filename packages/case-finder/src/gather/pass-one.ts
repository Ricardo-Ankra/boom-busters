import { FLOOR_MEDIAN_MONTHLY, FOUNDER_MIN_MEDIAN_VIEWS } from '../config'
import { FOUNDER_TAG } from '../hitlist/build'
import { measure } from '../score/measure'
import { normalTitle } from '../sources/wikipedia'
import type { DatedTag, EntryEvidence, HitlistEntry, IsoDate, MonthlyViews } from '../types'
import { SERIES_FROM_MONTH, monthsBefore, type PageAtT, type Run, type Sources } from './run'

/**
 * Pass 1 of evidence gathering: each entry's English pageviews and its tags
 * as dated at T, which is enough to pick the ranked population. Nothing else
 * is fetched, so the population command reads this pass alone.
 */

const PROGRESS_EVERY = 100

/** What pass 1 learned about one entry, carried into pass 2. */
export interface PassOne {
  evidence: EntryEvidence
  /** The title and every redirect: what list matching sees. */
  enTitles: string[]
  /** The title and its former titles: what pageviews are summed over. */
  viewTitles: string[]
  page: PageAtT | null
}

/**
 * The tags that applied at T. Any tag with a `since` on or after T is out.
 * A category tag needs the article's revision before T's month to carry the
 * category, and a list tag needs the list page's revision then to link to the
 * article under its title or any of its redirects (the list may use an older
 * name): categories and list entries are added after the fact, often long
 * after. With `pages` null (an entry below the floor, never fetched) both
 * kinds are dropped. The founder-link tag is undated and the hitlist gave it
 * for popularity at some time, so it counts at T only if the entry was
 * popular in the 24 months before T (`enMedian`, read only for that tag).
 */
export async function tagsAt(
  entry: HitlistEntry,
  asOf: IsoDate,
  pages: { page: PageAtT | null; enTitles: string[]; listLinks: Run['listLinks'] } | null,
  enMedian: () => Promise<number>,
): Promise<DatedTag[]> {
  const out: DatedTag[] = []
  for (const tag of entry.tags) {
    if (tag.since !== null && tag.since >= asOf) continue
    if (tag.tag === FOUNDER_TAG) {
      if ((await enMedian()) >= FOUNDER_MIN_MEDIAN_VIEWS) out.push(tag)
    } else if (tag.tag.startsWith('category:')) {
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

/**
 * The English title's two title lists. `enTitles` is the title and every
 * current redirect, for list matching (a list may link through any spelling,
 * and the redirects call is cheap and cached). `viewTitles` is the title and
 * its former titles only, for pageviews: a renamed article keeps its history,
 * but a famous company has 20 to 30 redirects (nicknames, tickers) and each
 * would cost a pageviews request. Both are empty with no English article.
 */
export async function titlesOf(
  entry: HitlistEntry,
  sources: Sources,
): Promise<{ enTitles: string[]; viewTitles: string[] }> {
  if (entry.enTitle === null) return { enTitles: [], viewTitles: [] }
  const redirects = await sources.wikipedia.redirectsTo(entry.enTitle)
  const former = await sources.wikipedia.formerTitles(entry.enTitle, redirects)
  return { enTitles: [entry.enTitle, ...redirects], viewTitles: [entry.enTitle, ...former] }
}

/** The English monthly series (title and former titles) before T; empty with no English article. */
export async function enMonthlyOf(
  entry: HitlistEntry,
  viewTitles: string[],
  run: Run,
): Promise<MonthlyViews[]> {
  if (entry.enTitle === null) return []
  const series = await run.sources.pageviews.monthly(
    'en.wikipedia',
    viewTitles,
    SERIES_FROM_MONTH,
    run.lastMonth,
  )
  return monthsBefore(series, run.asOf)
}

/** Pageviews and tags for one entry; the revision is read only above the floor. */
async function passOne(entry: HitlistEntry, run: Run): Promise<PassOne> {
  const { asOf, sources } = run
  const { enTitles, viewTitles } = await titlesOf(entry, sources)
  const enMonthly = await enMonthlyOf(entry, viewTitles, run)
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
  const enMedian = measure(evidence).enMedianMonthly
  const median = async () => enMedian
  // The floor needs only the English series, so an entry below it costs no revision fetch.
  if (entry.enTitle === null || enMedian < FLOOR_MEDIAN_MONTHLY) {
    evidence.tagsAtT = await tagsAt(entry, asOf, null, median)
    return { evidence, enTitles, viewTitles, page: null }
  }
  const page = await run.pageAt(entry.enTitle)
  const pages = { page, enTitles, listLinks: run.listLinks }
  evidence.tagsAtT = await tagsAt(entry, asOf, pages, median)
  return { evidence, enTitles, viewTitles, page }
}

/** Pass 1 over the whole hitlist, in order, with a progress line every 100 entries. */
export async function passOneAll(
  hitlist: HitlistEntry[],
  run: Run,
  log: (line: string) => void,
): Promise<PassOne[]> {
  const first: PassOne[] = []
  for (const entry of hitlist) {
    first.push(await passOne(entry, run))
    if (first.length % PROGRESS_EVERY === 0) {
      log(`evidence ${run.asOf}: pass 1 ${first.length}/${hitlist.length}`)
    }
  }
  return first
}
