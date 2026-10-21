import { DEMAND_WINDOW_MONTHS, FOUNDER_MIN_MEDIAN_VIEWS, HITLIST_EXCLUDED_CLASSES } from '../config'
import type { DatedTag, HitlistEntry, IsoDate, Lane, MonthlyViews } from '../types'
import { monthRange, type PageviewsSource } from '../sources/pageviews'
import type { EntityFacts, WikidataSource } from '../sources/wikidata'
import type { WikipediaSource } from '../sources/wikipedia'
import { median } from '../stats'
import { fortuneClimbers, type FortuneRow } from './fortune'
import {
  CHAPTER_11_FIRST_YEAR,
  CHAPTER_11_LAST_YEAR,
  DISSOLVED_CONVICTED_QUERY,
  DOWNFALL_LISTS,
  FOUNDER_CANDIDATES_QUERY,
  SCANDAL_CATEGORIES,
  foundedBusinessesAmong,
  chapter11Category,
  dissolvedSchema,
  founderCandidatesSchema,
  loadLoPucki,
  parseCsv,
  qidOf,
  sparqlDate,
} from './seeds'

export interface HitlistDeps {
  wikipedia: WikipediaSource
  wikidata: WikidataSource
  pageviews: PageviewsSource
  /** PoliteClient.getText, for the Fortune CSVs. */
  fetchText: (url: string) => Promise<string>
  /** Path to the LoPucki CSV; null or a missing file skips that seed. */
  loPuckiCsv: string | null
  log: (line: string) => void
  /** Ends the founder seed's pageviews series; injected so tests are deterministic. */
  now?: () => Date
  /** The counts the summary log line states, for a caller that records them (the back-test report). */
  onSummary?: (summary: HitlistSummary) => void
}

export interface HitlistSummary {
  perSeed: Record<string, number>
  /** Seed names that resolved to no Wikidata item, by seed. */
  unresolvedBySeed: Record<string, number>
  /**
   * Resolved QIDs left out, by reason: `no facts` (Wikidata returned none),
   * `class` (it has a P279 claim), or `<QID> <label>` for the first
   * HITLIST_EXCLUDED_CLASSES kind it is an instance of.
   */
  dropped: Record<string, number>
}

const FORTUNE_FIRST_YEAR = 1955
const FORTUNE_LAST_YEAR = 2019
/** The first month the pageviews API has; every founder series starts here. */
const FOUNDER_SERIES_FROM = '2015-07'

/** The tag the founder seed gives; evidence gathering dates it against pageviews before T. */
export const FOUNDER_TAG = 'founder-link'

const fortuneUrl = (year: number) =>
  `https://raw.githubusercontent.com/cmusam/fortune500/master/csv/fortune500-${year}.csv`

/** Any downfall tag wins (spec section 4). */
export function laneOf(tags: DatedTag[]): Lane | null {
  if (tags.some((t) => t.lane === 'downfall')) return 'downfall'
  if (tags.some((t) => t.lane === 'success')) return 'success'
  return null
}

/** Why an entity is not a company case, or null when it may be one. */
function exclusion(facts: EntityFacts | undefined): string | null {
  if (facts === undefined) return 'no facts'
  if (facts.isClass) return 'class'
  const excluded = Object.keys(
    HITLIST_EXCLUDED_CLASSES,
  ) as (keyof typeof HITLIST_EXCLUDED_CLASSES)[]
  const kind = excluded.find((qid) => facts.instanceOf.includes(qid))
  return kind === undefined ? null : `${kind} ${HITLIST_EXCLUDED_CLASSES[kind]}`
}

/** `Enron (company)` gives `Enron`; null stays null. */
function queryOf(enTitle: string | null): string | null {
  return enTitle === null ? null : enTitle.replace(/\s*\([^()]*\)\s*$/, '').trim()
}

/** The month before the month of `now`: the last whose monthly total is final. */
function lastCompleteMonth(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7)
}

/**
 * The highest median over any 24 consecutive months from `from` to `to`, a
 * missing month counting 0. Any window, not the last one: a company popular
 * years before the build and forgotten since is exactly a case the back-test
 * may meet, and judging it by today's interest would be hindsight.
 */
function bestWindowMedian(series: MonthlyViews[], from: string, to: string): number {
  const byMonth = new Map(series.map((m) => [m.month, m.views]))
  const views = monthRange(from, to).map((month) => byMonth.get(month) ?? 0)
  let best = 0
  for (let i = 0; i + DEMAND_WINDOW_MONTHS <= views.length; i++) {
    best = Math.max(best, median(views.slice(i, i + DEMAND_WINDOW_MONTHS)))
  }
  return best
}

async function fortuneRows(deps: HitlistDeps): Promise<FortuneRow[]> {
  const rows: FortuneRow[] = []
  for (let year = FORTUNE_FIRST_YEAR; year <= FORTUNE_LAST_YEAR; year++) {
    try {
      const [header, ...body] = parseCsv(await deps.fetchText(fortuneUrl(year)))
      const rankCol = header?.findIndex((h) => /rank/i.test(h)) ?? -1
      const nameCol = header?.findIndex((h) => /company|name/i.test(h)) ?? -1
      if (rankCol < 0 || nameCol < 0) {
        deps.log(`fortune: ${year} has no rank or company column, skipped`)
        continue
      }
      for (const row of body) {
        const rank = Number((row[rankCol] ?? '').replace(/[^\d]/g, ''))
        const company = (row[nameCol] ?? '').trim()
        if (company !== '' && rank > 0) rows.push({ year, rank, company })
      }
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      deps.log(`fortune: ${year} failed (${why}), skipped`)
    }
  }
  return rows
}

export async function buildHitlist(deps: HitlistDeps): Promise<HitlistEntry[]> {
  const { wikipedia, wikidata, log } = deps
  const now = deps.now ?? (() => new Date())
  const tagsByQid = new Map<string, DatedTag[]>()
  const perSeed = new Map<string, number>()
  const unresolved = new Map<string, number>()

  const add = (seed: string, qid: string, tag: DatedTag) => {
    const tags = tagsByQid.get(qid) ?? []
    // Deduped by tag name: the first dating of a tag stands.
    if (!tags.some((t) => t.tag === tag.tag)) tags.push(tag)
    tagsByQid.set(qid, tags)
    perSeed.set(seed, (perSeed.get(seed) ?? 0) + 1)
  }

  /** Resolve titles or names through the English title search and tag the ones that resolve. */
  async function seedByTitle(
    seed: string,
    items: { title: string; since: IsoDate | null }[],
    lane: Lane,
  ) {
    perSeed.set(seed, perSeed.get(seed) ?? 0)
    if (items.length === 0) return
    const qids = await wikipedia.qidsFor(items.map((i) => i.title))
    let missing = 0
    for (const item of items) {
      const qid = qids.get(item.title)
      if (qid === undefined) missing++
      else add(seed, qid, { tag: seed, lane, since: item.since })
    }
    if (missing > 0) unresolved.set(seed, (unresolved.get(seed) ?? 0) + missing)
  }

  for (const name of SCANDAL_CATEGORIES) {
    const titles = await wikipedia.categoryMembers(name, 1)
    await seedByTitle(
      `category:${name}`,
      titles.map((title) => ({ title, since: null })),
      'downfall',
    )
  }
  for (let year = CHAPTER_11_FIRST_YEAR; year <= CHAPTER_11_LAST_YEAR; year++) {
    const name = chapter11Category(year)
    const titles = await wikipedia.categoryMembers(name, 0)
    await seedByTitle(
      `category:${name}`,
      titles.map((title) => ({ title, since: `${year}-01-01` })),
      'downfall',
    )
  }
  for (const page of DOWNFALL_LISTS) {
    const titles = await wikipedia.listLinks(page)
    await seedByTitle(
      `list:${page}`,
      titles.map((title) => ({ title, since: null })),
      'downfall',
    )
  }

  // Earliest filing first, so a company with several filings keeps its earliest date.
  const lopucki = loadLoPucki(deps.loPuckiCsv, log).sort((a, b) => a.filed.localeCompare(b.filed))
  await seedByTitle(
    'lopucki',
    lopucki.map((r) => ({ title: r.name, since: r.filed })),
    'downfall',
  )

  const dissolved = await wikidata.sparql(DISSOLVED_CONVICTED_QUERY, dissolvedSchema)
  const dissolvedRows = dissolved.results.bindings
    .map((b) => ({ qid: qidOf(b.item.value), since: sparqlDate(b.dissolved.value) }))
    .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))
  perSeed.set('wikidata:dissolved-convicted', 0)
  for (const { qid, since } of dissolvedRows) {
    if (qid !== null && since !== null) {
      const tag = 'wikidata:dissolved-convicted'
      add(tag, qid, { tag, lane: 'downfall', since })
    }
  }

  const fortune = fortuneClimbers(await fortuneRows(deps))
  await seedByTitle(
    'fortune-climb',
    fortune.map((c) => ({ title: c.company, since: c.since })),
    'success',
  )

  // A founder link stands beside any downfall tag: the lane at T gives downfall precedence, and
  // filtering here on tags a company gained later would be hindsight.
  const candidates = await wikidata.sparql(FOUNDER_CANDIDATES_QUERY, founderCandidatesSchema)
  const candidateQids = candidates.results.bindings.flatMap((b) => qidOf(b.item.value) ?? [])
  const businesses = await foundedBusinessesAmong(candidateQids, wikidata, log)
  const to = lastCompleteMonth(now())
  perSeed.set(FOUNDER_TAG, 0)
  for (const [qid, title] of businesses) {
    const monthly = await deps.pageviews.monthly('en.wikipedia', [title], FOUNDER_SERIES_FROM, to)
    if (bestWindowMedian(monthly, FOUNDER_SERIES_FROM, to) < FOUNDER_MIN_MEDIAN_VIEWS) continue
    add(FOUNDER_TAG, qid, { tag: FOUNDER_TAG, lane: 'success', since: null })
  }

  const facts = await wikidata.facts([...tagsByQid.keys()])
  const entries: HitlistEntry[] = []
  const dropped = new Map<string, number>()
  for (const [qid, tags] of tagsByQid) {
    const f = facts.get(qid)
    const reason = exclusion(f)
    if (f === undefined || reason !== null) {
      const why = reason ?? 'no facts'
      dropped.set(why, (dropped.get(why) ?? 0) + 1)
      continue
    }
    entries.push({
      qid,
      enTitle: f.enTitle,
      query: queryOf(f.enTitle),
      sitelinks: f.sitelinks,
      tags,
      country: f.country,
      cik: f.cik,
    })
  }
  entries.sort((a, b) => Number(a.qid.slice(1)) - Number(b.qid.slice(1)))

  const counts = (m: Map<string, number>) =>
    [...m].map(([s, n]) => `${s}=${n}`).join(', ') || 'none'
  log(
    `hitlist: ${entries.length} entries; per seed ${counts(perSeed)}; ` +
      `unresolved ${counts(unresolved)}; dropped ${counts(dropped)}`,
  )
  deps.onSummary?.({
    perSeed: Object.fromEntries(perSeed),
    unresolvedBySeed: Object.fromEntries(unresolved),
    dropped: Object.fromEntries(dropped),
  })
  return entries
}
