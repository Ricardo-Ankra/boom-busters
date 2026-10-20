import type { DatedTag, HitlistEntry, IsoDate, Lane } from '../types'
import type { PageviewsSource } from '../sources/pageviews'
import type { WikidataSource } from '../sources/wikidata'
import type { WikipediaSource } from '../sources/wikipedia'
import { median } from '../stats'
import { fortuneClimbers, type FortuneRow } from './fortune'
import {
  CHAPTER_11_FIRST_YEAR,
  CHAPTER_11_LAST_YEAR,
  DISSOLVED_CONVICTED_QUERY,
  DOWNFALL_LISTS,
  FOUNDER_QUERY,
  SCANDAL_CATEGORIES,
  chapter11Category,
  dissolvedSchema,
  founderSchema,
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
  /** Anchors the founder seed's 24-month window; injected so tests are deterministic. */
  now?: () => Date
  /** The counts the summary log line states, for a caller that records them (the back-test report). */
  onSummary?: (summary: HitlistSummary) => void
}

export interface HitlistSummary {
  perSeed: Record<string, number>
  /** Seed names that resolved to no Wikidata item, by seed. */
  unresolvedBySeed: Record<string, number>
  /** Resolved QIDs dropped because Wikidata returned no facts for them. */
  dropped: number
}

const FORTUNE_FIRST_YEAR = 1955
const FORTUNE_LAST_YEAR = 2019
const FOUNDER_MIN_MEDIAN_VIEWS = 1000
const FOUNDER_WINDOW_MONTHS = 24

const fortuneUrl = (year: number) =>
  `https://raw.githubusercontent.com/cmusam/fortune500/master/csv/fortune500-${year}.csv`

/** Any downfall tag wins (spec section 4). */
export function laneOf(tags: DatedTag[]): Lane | null {
  if (tags.some((t) => t.lane === 'downfall')) return 'downfall'
  if (tags.some((t) => t.lane === 'success')) return 'success'
  return null
}

/** `Enron (company)` gives `Enron`; null stays null. */
function queryOf(enTitle: string | null): string | null {
  return enTitle === null ? null : enTitle.replace(/\s*\([^()]*\)\s*$/, '').trim()
}

/** The 24 calendar months before the month of `now`, as 'YYYY-MM' bounds. */
function founderWindow(now: Date): { from: string; to: string } {
  const index = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const month = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
  return { from: month(index - FOUNDER_WINDOW_MONTHS), to: month(index - 1) }
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

  // Founder links last: they are filtered against every downfall tag above.
  const founders = await wikidata.sparql(FOUNDER_QUERY, founderSchema)
  const window = founderWindow(now())
  perSeed.set('founder-link', 0)
  for (const b of founders.results.bindings) {
    const qid = qidOf(b.item.value)
    if (qid === null) continue
    if (tagsByQid.get(qid)?.some((t) => t.lane === 'downfall')) continue
    const monthly = await deps.pageviews.monthly(
      'en.wikipedia',
      [b.title.value],
      window.from,
      window.to,
    )
    if (median(monthly.map((m) => m.views)) < FOUNDER_MIN_MEDIAN_VIEWS) continue
    add('founder-link', qid, { tag: 'founder-link', lane: 'success', since: null })
  }

  const facts = await wikidata.facts([...tagsByQid.keys()])
  const entries: HitlistEntry[] = []
  let dropped = 0
  for (const [qid, tags] of tagsByQid) {
    const f = facts.get(qid)
    if (f === undefined) {
      dropped++
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

  const per = [...perSeed].map(([s, n]) => `${s}=${n}`).join(', ')
  const missed = [...unresolved].map(([s, n]) => `${s}=${n}`).join(', ') || 'none'
  log(
    `hitlist: ${entries.length} entries; per seed ${per}; unresolved ${missed}; dropped ${dropped}`,
  )
  deps.onSummary?.({
    perSeed: Object.fromEntries(perSeed),
    unresolvedBySeed: Object.fromEntries(unresolved),
    dropped,
  })
  return entries
}
