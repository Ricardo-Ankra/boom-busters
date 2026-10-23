import {
  isPrimaryReference,
  qidOf,
  stooqSymbol,
  videoIdFromUrl,
  type EntityFacts,
} from '@boom-busters/case-finder'
import { normaliseDocumentUrl } from '@boom-busters/db'
import { registrableDomain } from '@boom-busters/providers'
import {
  DOCUMENT_TIERS,
  PERSON_REFERENCE_CAP,
  type DocumentKind,
  type ResearchEntity,
} from '@boom-busters/schemas'
import { z } from 'zod'
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

/**
 * The roots the subclass walk climbs to: business and organization. FTX's item
 * is only a "cryptocurrency exchange" (Q25401607), a subclass of business that
 * no direct class check names.
 */
const BUSINESS_ROOTS = ['Q4830453', 'Q43229']

/** Wikidata's "human". */
const HUMAN = 'Q5'

const SEARCH_HITS = 5
const PERSON_SEARCH_HITS = 3
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

const itemBindings = z.object({
  results: z.object({ bindings: z.array(z.object({ item: z.object({ value: z.string() }) })) }),
})

/**
 * The QIDs among `qids` that are a business or an organization through any
 * chain of subclasses (P31/P279*), in one query, as `foundedBusinessesAmong`
 * asks it. A failing query answers none: the direct class check has already
 * run, and a subject it missed is reported unresolved rather than failing the
 * step.
 */
async function businessesBySubclass(
  sources: ResearchSources,
  qids: readonly string[],
): Promise<Set<string>> {
  if (qids.length === 0) return new Set()
  const items = qids.map((qid) => `wd:${qid}`).join(' ')
  const roots = BUSINESS_ROOTS.map((qid) => `wd:${qid}`).join(' ')
  try {
    const { results } = await sources.wikidata.sparql(
      `SELECT DISTINCT ?item WHERE { VALUES ?item { ${items} } VALUES ?root { ${roots} } ` +
        `?item wdt:P31/wdt:P279* ?root . }`,
      itemBindings,
    )
    return new Set(results.bindings.flatMap((b) => qidOf(b.item.value) ?? []))
  } catch (error) {
    console.warn(
      `dossier gather: the subclass check failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return new Set()
  }
}

/** A person's search, or no hits when it throws: one person's lookup must not lose the entity. */
async function personSearch(sources: ResearchSources, name: string) {
  try {
    return await sources.wikipedia.search(name, PERSON_SEARCH_HITS)
  } catch (error) {
    console.warn(
      `dossier gather: the search for ${name} failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return []
  }
}

/**
 * The subject is the company's common name, so its search finds the company
 * article among the top hits; the scandal articles beside it still give their
 * references. When none of the hits is a business the entity is unresolved:
 * the first hit of an editorial headline can be any page ("2022 in the United
 * States" once), and a corpus read from it is about something else. A hit
 * is a business when its item is directly one of `BUSINESS_CLASSES`, or else,
 * asked once over all the hits, when it is a business or organization through
 * a subclass chain. Each person is searched too, and the first human hit is
 * their article; a person whose search fails is kept unresolved.
 */
export async function resolveEntity(
  sources: ResearchSources,
  input: { subject: string; people: readonly string[] },
): Promise<ResolvedEntity> {
  const { subject } = input
  const [subjectHits, ...peopleHits] = await Promise.all([
    sources.wikipedia.search(subject, SEARCH_HITS),
    ...input.people.map((name) => personSearch(sources, name)),
  ])
  const hits = (subjectHits ?? []).map((hit) => hit.title)
  const personHits = peopleHits.map((found) => found.map((hit) => hit.title))
  const allTitles = [...new Set([...hits, ...personHits.flat()])]

  const qids =
    allTitles.length === 0 ? new Map<string, string>() : await sources.wikipedia.qidsFor(allTitles)
  const facts =
    qids.size === 0
      ? new Map<string, EntityFacts>()
      : await sources.wikidata.facts([...new Set(qids.values())])
  const isA = (title: string, classes: readonly string[]) => {
    const qid = qids.get(title)
    const known = qid === undefined ? undefined : facts.get(qid)
    return known?.instanceOf.some((cls) => classes.includes(cls)) ?? false
  }

  const people = input.people.map((name, i) => {
    const title = personHits[i]?.find((hit) => isA(hit, [HUMAN])) ?? null
    return { name, qid: title === null ? null : (qids.get(title) ?? null), title }
  })

  let business = hits.find((title) => isA(title, BUSINESS_CLASSES)) ?? null
  if (business === null) {
    const hitQids = [...new Set(hits.flatMap((title) => qids.get(title) ?? []))]
    const bySubclass = await businessesBySubclass(sources, hitQids)
    business = hits.find((title) => bySubclass.has(qids.get(title) ?? '')) ?? null
  }
  const relatedTitles = hits
    .filter((title) => title !== business && RELATED_WORDS.test(title))
    .slice(0, MAX_RELATED)
  if (business === null) {
    return { ...EMPTY_ENTITY, people, unresolved: true, subject, relatedTitles }
  }
  const qid = qids.get(business) ?? null
  const known = qid === null ? undefined : facts.get(qid)

  return {
    qid,
    titles: [business, ...relatedTitles],
    cik: known?.cik ?? null,
    ticker: known?.ticker?.symbol ?? null,
    website: known?.website ?? null,
    people,
    unresolved: false,
    subject,
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

/** A page's external links, less archive copies and Wikimedia's own pages, with their hosts. */
function referenceEntries(links: readonly string[]): { link: string; host: string }[] {
  return [...new Set(links)].flatMap((link) => {
    const host = hostOf(link)
    if (host === null || SKIPPED_REFERENCE_HOSTS.some((domain) => onDomain(host, domain))) return []
    return [{ link, host }]
  })
}

const referencesOf = (sources: ResearchSources, title: string) =>
  listing(`Wikipedia references of ${title}`, [] as string[], async () => {
    const items = await sources.wikipedia.currentItems(title)
    return items.externalLinks
  })

const recordKind = (host: string): DocumentKind => (isCourtHost(host) ? 'court' : 'regulator')

export async function discoverCandidates(
  sources: ResearchSources,
  entity: ResolvedEntity,
  input: {
    competitorLinks: readonly { url: string }[]
    sourceLinks: readonly { url: string }[]
    subject: string
  },
): Promise<Candidate[]> {
  const today = new Date()
  const { youtube } = sources
  const { cik, website, businessTitle } = entity
  // An unresolved subject has no company article, and its hits' pages are about something else.
  const pages = entity.unresolved
    ? []
    : [businessTitle, ...entity.relatedTitles].filter((t): t is string => t !== null)
  // A resolved entity replayed from a run parked before people existed has none.
  const personPages = (entity.people ?? []).flatMap((person) => person.title ?? [])

  // The listings are independent, so they are asked at once; the PoliteClient
  // still spaces requests to any one host.
  const [exhibits, tenK, captures, references, personReferences, searched, dockets] =
    await Promise.all([
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
      Promise.all(pages.map((title) => referencesOf(sources, title))),
      Promise.all(personPages.map((title) => referencesOf(sources, title))),
      youtube === null
        ? null
        : listing('YouTube search', null, () => youtube.search(input.subject)),
      businessTitle === null
        ? []
        : listing('CourtListener dockets', [], () =>
            // "Wirecard (company)" is the article's name, not the company's.
            sources.courtlistener.dockets(
              businessTitle.replace(/\s*\([^)]*\)$/, ''),
              isoDay(today),
            ),
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
      /** The kind's own tier unless the source earns another (the owner's links). */
      tier?: Candidate['tier']
    } = {},
  ): boolean => {
    const url = normaliseDocumentUrl(raw)
    if (seen.has(url)) return false
    seen.add(url)
    out.push({
      url,
      kind,
      tier: extra.tier ?? DOCUMENT_TIERS[kind],
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
  const links = referenceEntries(references.flat())
  const own = links.filter(
    ({ link }) => ownDomain !== null && registrableDomain(link) === ownDomain,
  )
  const rest = links.filter((entry) => !own.includes(entry))
  const primary = rest.filter(({ link }) => isPrimaryReference(link))
  const reporting = rest.filter((entry) => !primary.includes(entry))

  // Tier 1, the owner's own sources (outside every cap, read first), then the company's own voice.
  for (const { url } of input.sourceLinks) {
    add(url, 'reporting', { tier: 1, meta: { pinned: true } })
  }
  for (const doc of exhibits) add(doc.url, 'filing', { title: doc.title, publishedAt: doc.datedAt })
  if (tenK !== null) add(tenK.url, 'filing', { title: tenK.title, publishedAt: tenK.datedAt })
  for (const capture of captures) {
    const day = timestampDay(capture.timestamp)
    add(capture.url, 'web-archive', { title: `${website} as archived on ${day}`, publishedAt: day })
  }
  addCapped(own, REFERENCE_CAPS.pressRelease, () => 'press-release')

  // Tier 2, reporting: the company's articles, then each person's. A person's
  // court and regulator links count toward their cap and are filed at tier 5
  // below; one the company's article also cites is the company's.
  addCapped(reporting, REFERENCE_CAPS.reporting, () => 'reporting')
  const companyRecord = new Set(primary.map(({ link }) => normaliseDocumentUrl(link)))
  const personRecord: { link: string; host: string }[] = []
  const deferred = new Set<string>()
  for (const personLinks of personReferences) {
    let taken = 0
    for (const entry of referenceEntries(personLinks)) {
      if (taken >= PERSON_REFERENCE_CAP) break
      if (!isPrimaryReference(entry.link)) {
        if (add(entry.link, 'reporting')) taken++
        continue
      }
      const url = normaliseDocumentUrl(entry.link)
      if (seen.has(url) || companyRecord.has(url) || deferred.has(url)) continue
      deferred.add(url)
      personRecord.push(entry)
      taken++
    }
  }

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
  addCapped(primary, REFERENCE_CAPS.primary, recordKind)
  for (const { link, host } of personRecord) add(link, recordKind(host))
  for (const docket of dockets) {
    add(docket.url, 'court', { title: docket.title, publishedAt: docket.datedAt })
  }

  return out
}
