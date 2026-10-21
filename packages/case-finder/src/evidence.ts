import { laneOf } from './hitlist/build'
import { populationAt } from './score/rank'
import { countedVideos, medianMonthly } from './score/measure'
import { historyNeeded } from './gather/channels'
import { enMonthlyOf, enTitlesOf, passOneAll, tagsAt, type PassOne } from './gather/pass-one'
import {
  SERIES_FROM_DAY,
  SERIES_FROM_MONTH,
  createRun,
  daysBefore,
  monthsBefore,
  type GatherOptions,
  type Run,
  type Sources,
} from './gather/run'
import { referencesAsDocuments } from './sources/references'
import { releasesNaming, type SecRelease } from './sources/sec-releases'
import type {
  ChannelUploads,
  EntryEvidence,
  HitlistEntry,
  IsoDate,
  Lane,
  MonthlyViews,
  Person,
  PrimaryDocument,
} from './types'

export type { GatherOptions, Sources } from './gather/run'

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
 * (gather/pass-one.ts) reads pageviews and tags for everyone, which is enough
 * to pick the ranked population; pass 2 gathers the rest for that population
 * alone.
 */

const PROGRESS_EVERY = 100

/** `dewiki` is `de.wikipedia`; `zh_yuewiki` is `zh-yue.wikipedia`. */
function projectOf(site: string): string {
  return `${site.replace(/wiki$/, '').replaceAll('_', '-')}.wikipedia`
}

const nonBlank = (text: string | null): text is string => text !== null && text.trim() !== ''

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
    // Asked as of the anchor so one cached answer serves every T, then cut to T here.
    const dockets = await sources.courtlistener.dockets(entry.query, run.anchorDay)
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
    : { fetchedAt: run.anchorDay, videos: [] }
  // Only the channels behind counted videos: no other video's ratio is ever read.
  const counted = nonBlank(query) ? countedVideos(search, query, asOf) : []
  const channels: Record<string, ChannelUploads> = {}
  for (const [channelId, until] of historyNeeded(counted)) {
    // A channel with no uploads to read is left out; its videos' outlier ratio falls back to 1.
    const uploads = await run.uploads(channelId, until)
    if (uploads !== null) channels[channelId] = uploads
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

/**
 * The lane one entry had at T, by the same tag dating as pass 1 of `gatherAt`
 * but with no floor check: the back-test needs each subject's lane to pick its
 * test set before any evidence is gathered, whatever the subject's pageviews.
 */
export async function laneAt(
  entry: HitlistEntry,
  asOf: IsoDate,
  sources: Sources,
  options: GatherOptions = {},
): Promise<Lane | null> {
  const run = createRun(asOf, sources, options)
  const enTitles = await enTitlesOf(entry, sources)
  const page = entry.enTitle === null ? null : await run.pageAt(entry.enTitle)
  const pages = { page, enTitles, listLinks: run.listLinks }
  const median = async () => medianMonthly(await enMonthlyOf(entry, enTitles, run), asOf)
  return laneOf(await tagsAt(entry, asOf, pages, median))
}

/**
 * Pass 1 alone over the whole hitlist: each entry's English series and tags
 * at T, with nothing from YouTube, Wikidata facts or the document sources.
 * Enough for `classify` to give the ranked population (the population check).
 */
export async function gatherPassOneAt(
  hitlist: HitlistEntry[],
  asOf: IsoDate,
  sources: Sources,
  log: (line: string) => void,
  options: GatherOptions = {},
): Promise<EntryEvidence[]> {
  const first = await passOneAll(hitlist, createRun(asOf, sources, options), log)
  return first.map((p) => p.evidence)
}

export async function gatherAt(
  hitlist: HitlistEntry[],
  asOf: IsoDate,
  sources: Sources,
  log: (line: string) => void,
  options: GatherOptions = {},
): Promise<EntryEvidence[]> {
  const run = createRun(asOf, sources, options)
  const first = await passOneAll(hitlist, run, log)

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
