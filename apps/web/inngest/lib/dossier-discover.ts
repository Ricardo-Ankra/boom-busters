import { isPrimaryReference, stooqSymbol, videoIdFromUrl } from '@boom-busters/case-finder'
import { normaliseDocumentUrl } from '@boom-busters/db'
import { registrableDomain } from '@boom-busters/providers'
import { DOCUMENT_TIERS, type DocumentKind, type ResearchEntity } from '@boom-busters/schemas'
import type { ResearchSources } from '@/lib/research-sources'

/**
 * Discovery for the dossier gather (spec 4.1): who the case is about, then
 * which documents each source offers. Nothing is fetched here beyond the
 * listings; the gather's fetch steps read the documents themselves.
 */

export interface Candidate {
  url: string
  kind: DocumentKind
  tier: 1 | 2 | 3 | 4 | 5
  title: string | null
  publishedAt: string | null
  meta: Record<string, unknown> | null
}

/**
 * The entity as the gather needs it. Beyond what the dossier stores, discovery
 * reads the exchange (for the Stooq symbol) and the company's dates (for the
 * Wayback window and the ranking anchor).
 */
export type ResolvedEntity = ResearchEntity & {
  businessTitle: string | null
  relatedTitles: string[]
  exchange: string | null
  inception: string | null
  dissolved: string | null
}

/** business, company, public company, enterprise, organization, bank. */
export const BUSINESS_CLASSES = ['Q4830453', 'Q783794', 'Q891723', 'Q6881511', 'Q43229', 'Q22687']

const SEARCH_HITS = 5
const MAX_RELATED = 2
const RELATED_WORDS = /\b(scandal|collapse|bankruptcy|fraud|affair)\b/i

/** No entity: what a search with no hits resolves to, and what mock mode researches. */
export const EMPTY_ENTITY: ResolvedEntity = {
  qid: null,
  titles: [],
  cik: null,
  ticker: null,
  website: null,
  people: [],
  unresolved: false,
  subject: null,
  businessTitle: null,
  relatedTitles: [],
  exchange: null,
  inception: null,
  dissolved: null,
}

/**
 * Reference candidates kept per kind, in page order. A scandal article can cite
 * two hundred sources; these caps hold a gather to about 35 fetch steps of five,
 * which keeps the run to minutes and still offers the ranker more of each tier
 * than its share of the corpus budget can read.
 */
export const REFERENCE_CAPS = { pressRelease: 20, reporting: 60, primary: 30 } as const

/**
 * Case titles are editorial, so the top search hit is often the scandal
 * article, whose Wikidata item holds none of the company's facts. The facts
 * come from the first hit that is a business; the scandal articles still give
 * their references.
 */
export async function resolveEntity(
  sources: ResearchSources,
  caseTitle: string,
): Promise<ResolvedEntity> {
  const hits = (await sources.wikipedia.search(caseTitle, SEARCH_HITS)).map((hit) => hit.title)
  const first = hits[0]
  if (first === undefined) return EMPTY_ENTITY

  const qids = await sources.wikipedia.qidsFor(hits)
  const facts = await sources.wikidata.facts([...new Set(qids.values())])
  const factsOf = (title: string) => {
    const qid = qids.get(title)
    return qid === undefined ? undefined : facts.get(qid)
  }

  const business =
    hits.find((title) =>
      factsOf(title)?.instanceOf.some((cls) => BUSINESS_CLASSES.includes(cls)),
    ) ?? first
  const relatedTitles = hits
    .filter((title) => title !== business && RELATED_WORDS.test(title))
    .slice(0, MAX_RELATED)
  const known = factsOf(business)

  return {
    qid: qids.get(business) ?? null,
    titles: [business, ...relatedTitles],
    cik: known?.cik ?? null,
    ticker: known?.ticker?.symbol ?? null,
    website: known?.website ?? null,
    people: [],
    unresolved: false,
    subject: null,
    businessTitle: business,
    relatedTitles,
    exchange: known?.ticker?.exchange ?? null,
    inception: known?.inception ?? null,
    dissolved: known?.dissolved ?? null,
  }
}

/**
 * Links that are not sources in their own right: an archive copy of a page the
 * list already names (the fetcher falls back to the archive itself), and
 * Wikimedia's own pages.
 */
const SKIPPED_REFERENCE_HOSTS = [
  'archive.org',
  'archive.ph',
  'archive.today',
  'archive.is',
  'wikipedia.org',
  'wikimedia.org',
  'wikidata.org',
]

const COURT_HOSTS = ['courtlistener.com', 'uscourts.gov', 'bailii.org']

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)

function isCourtHost(host: string): boolean {
  return COURT_HOSTS.some((domain) => onDomain(host, domain)) || host.split('.').includes('pacer')
}

const watchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

/** A CDX timestamp (`YYYYMMDDhhmmss`) as the day it names. */
const timestampDay = (ts: string) => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`

/**
 * One source's listing, or its fallback when it throws. A failing source costs
 * only its own documents: the EDGAR folder walk and Wayback both throw on a
 * non-2xx, and one bad answer must not lose the rest of the corpus.
 */
async function listing<T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    console.warn(
      `dossier gather: ${what} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return fallback
  }
}

/** The Wayback window: the company's life as Wikidata dates it, or the last ten years of it. */
function waybackWindow(entity: ResolvedEntity, today: Date): { from: string; to: string } {
  const endYear = Number((entity.dissolved ?? isoDay(today)).slice(0, 4))
  const from = entity.inception?.slice(0, 4) ?? String(endYear - 10)
  const to = (entity.dissolved ?? isoDay(today)).replaceAll('-', '')
  return { from, to }
}

export async function discoverCandidates(
  sources: ResearchSources,
  entity: ResolvedEntity,
  input: { competitorLinks: readonly { url: string }[]; caseTitle: string },
): Promise<Candidate[]> {
  const today = new Date()
  const { youtube } = sources
  const { cik, website, businessTitle } = entity
  const pages = [businessTitle, ...entity.relatedTitles].filter((t): t is string => t !== null)

  // The listings are independent, so they are asked at once; the PoliteClient
  // still spaces requests to any one host.
  const [exhibits, tenK, captures, references, searched, dockets] = await Promise.all([
    cik === null
      ? []
      : listing('EDGAR exhibits', [], () =>
          sources.edgar.exhibits(cik, { items: ['2.02', '8.01'], newest: 6 }),
        ),
    cik === null
      ? null
      : listing('EDGAR 10-K', null, () => sources.edgar.latestFiling(cik, '10-K')),
    website === null
      ? []
      : listing('Wayback captures', [], () =>
          // CDX lists oldest first; a negative limit takes the last six, the newest years.
          sources.wayback.captures(website, { ...waybackWindow(entity, today), limit: -6 }),
        ),
    Promise.all(
      pages.map((title) =>
        listing(`Wikipedia references of ${title}`, [] as string[], async () => {
          const items = await sources.wikipedia.currentItems(title)
          return items.externalLinks
        }),
      ),
    ),
    youtube === null
      ? null
      : listing('YouTube search', null, () => youtube.search(input.caseTitle)),
    businessTitle === null
      ? []
      : listing('CourtListener dockets', [], () =>
          // "Wirecard (company)" is the article's name, not the company's.
          sources.courtlistener.dockets(businessTitle.replace(/\s*\([^)]*\)$/, ''), isoDay(today)),
        ),
  ])

  const out: Candidate[] = []
  const seen = new Set<string>()
  const add = (
    raw: string,
    kind: DocumentKind,
    extra: {
      title?: string | null
      publishedAt?: string | null
      meta?: Record<string, unknown>
    } = {},
  ): boolean => {
    const url = normaliseDocumentUrl(raw)
    if (seen.has(url)) return false
    seen.add(url)
    out.push({
      url,
      kind,
      tier: DOCUMENT_TIERS[kind],
      title: extra.title ?? null,
      publishedAt: extra.publishedAt ?? null,
      meta: extra.meta ?? null,
    })
    return true
  }
  /** Links up to a cap, in page order; a duplicate dropped by `add` does not count. */
  const addCapped = (
    entries: readonly { link: string; host: string }[],
    cap: number,
    kindOf: (host: string) => DocumentKind,
  ) => {
    let added = 0
    for (const { link, host } of entries) {
      if (added >= cap) return
      if (add(link, kindOf(host))) added++
    }
  }

  const ownDomain = website === null ? null : registrableDomain(website)
  const links = [...new Set(references.flat())].flatMap((link) => {
    const host = hostOf(link)
    if (host === null || SKIPPED_REFERENCE_HOSTS.some((domain) => onDomain(host, domain))) return []
    return [{ link, host }]
  })
  const own = links.filter(
    ({ link }) => ownDomain !== null && registrableDomain(link) === ownDomain,
  )
  const rest = links.filter((entry) => !own.includes(entry))
  const primary = rest.filter(({ link }) => isPrimaryReference(link))
  const reporting = rest.filter((entry) => !primary.includes(entry))

  // Tier 1, the company's own voice.
  for (const doc of exhibits) add(doc.url, 'filing', { title: doc.title, publishedAt: doc.datedAt })
  if (tenK !== null) add(tenK.url, 'filing', { title: tenK.title, publishedAt: tenK.datedAt })
  for (const capture of captures) {
    const day = timestampDay(capture.timestamp)
    add(capture.url, 'web-archive', { title: `${website} as archived on ${day}`, publishedAt: day })
  }
  addCapped(own, REFERENCE_CAPS.pressRelease, () => 'press-release')

  // Tier 2, reporting.
  addCapped(reporting, REFERENCE_CAPS.reporting, () => 'reporting')

  // Tier 3, video. A competitor link that is not a YouTube video is not a video candidate.
  for (const { url } of input.competitorLinks) {
    const videoId = videoIdFromUrl(url)
    if (videoId !== null) add(watchUrl(videoId), 'video', { meta: { videoId } })
  }
  for (const video of searched?.videos ?? []) {
    add(watchUrl(video.id), 'video', {
      title: video.title,
      publishedAt: video.publishedAt,
      meta: { videoId: video.id },
    })
  }

  // Tier 4, numbers. Listed without a request: the fetch step reads them.
  if (cik !== null) {
    add(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, '0')}.json`, 'figures', {
      title: `XBRL company facts, CIK ${cik}`,
      meta: { cik },
    })
  }
  const symbol = entity.ticker === null ? null : stooqSymbol(entity.ticker, entity.exchange)
  if (symbol !== null) {
    add(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`, 'figures', {
      title: `Daily prices, ${symbol}`,
      meta: { symbol },
    })
  }

  // Tier 5, the record.
  addCapped(primary, REFERENCE_CAPS.primary, (host) => (isCourtHost(host) ? 'court' : 'regulator'))
  for (const docket of dockets) {
    add(docket.url, 'court', { title: docket.title, publishedAt: docket.datedAt })
  }

  return out
}
