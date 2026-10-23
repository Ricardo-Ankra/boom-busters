import { createHash } from 'node:crypto'
import type { TranscriptSegment } from '@boom-busters/case-finder'
import {
  findResearchDocumentsByUrl,
  getResearchDocuments,
  linkDossierDocuments,
  normaliseDocumentUrl,
  upsertResearchDocument,
  type Database,
  type ResearchDocumentInput,
  type ResearchDocumentRow,
} from '@boom-busters/db'
import {
  estimateTokens,
  extractText,
  mockCorpusDocuments,
  pricesText,
  rankCorpus,
  xbrlFactsText,
} from '@boom-busters/providers'
import { DOCUMENT_TIERS, type ResearchEntity } from '@boom-busters/schemas'
import type { ResearchSources } from '@/lib/research-sources'
import { discoverCandidates, resolveEntity, type Candidate, EMPTY_ENTITY } from './dossier-discover'
import type { Steps } from './steps'

/**
 * The corpus a dossier is researched from (spec 4): resolve the case to an
 * entity, list candidate documents, read every video's details in one call,
 * fetch the documents in batches, rank what came back, and link the result to
 * the project.
 *
 * Inngest stores every step's return value, so the fetch steps write each
 * document to the database inside the step and hand back only its id. A batch
 * is five candidates: a page fetch is capped at 8 s and an API call at 20 s
 * with at most two short retries, which keeps a step well inside the 300 s
 * function limit.
 */

const BATCH_SIZE = 5
const FRESH_FOR_MS = 90 * 86_400_000

export interface GatherInput {
  projectId: string
  /** The company's common name, which Wikipedia and YouTube are searched with. */
  subject: string
  /** The main people; each one's Wikipedia article adds its references. */
  people: readonly string[]
  /** The owner's own links, read first. */
  sourceLinks: readonly { url: string }[]
  competitorLinks: readonly { url: string }[]
  round: number
}

export interface GatherDeps {
  db: Database
  /**
   * Built only inside a step that reads a source, so mock mode never builds
   * live sources and a missing contact address fails a step Inngest can show.
   */
  sources: () => ResearchSources
  mocked: boolean
  /** The clock a document's age is read against; tests pin it. */
  now?: () => Date
}

export interface GatherResult {
  entity: ResearchEntity
  /** Document ids in rank order. */
  read: string[]
  /** Fetched but over the corpus budget. */
  unread: string[]
  /** Candidates that could not be fetched; linked to the project, never ranked. */
  failed: number
}

/** A video's Data API details, as small as a step result can carry them. */
export interface VideoAbout {
  title: string
  description: string
  publishedAt: string
  channelTitle: string
}

/** The one `videos.list` of a gather (spec 4.5), and why it failed when it did. */
interface VideoListing {
  details: Record<string, VideoAbout>
  error: string | null
}

export async function gatherCorpus(
  steps: Steps,
  input: GatherInput,
  deps: GatherDeps,
): Promise<GatherResult> {
  const { db, sources, mocked } = deps
  const now = deps.now ?? (() => new Date())
  const { round } = input

  const resolved = await steps.run(`gather-entity-${round}`, async () =>
    mocked
      ? EMPTY_ENTITY
      : resolveEntity(sources(), { subject: input.subject, people: input.people }),
  )
  const entity: ResearchEntity = {
    qid: resolved.qid,
    titles: resolved.titles,
    cik: resolved.cik,
    ticker: resolved.ticker,
    website: resolved.website,
    people: resolved.people,
    unresolved: resolved.unresolved,
    subject: resolved.subject,
  }

  if (mocked) {
    const ids = await steps.run(`gather-fetch-${round}-0`, () =>
      storeMockCorpus(db, input.projectId, now()),
    )
    return { entity, read: ids, unread: [], failed: 0 }
  }

  const candidates = await steps.run(`gather-discover-${round}`, () =>
    discoverCandidates(sources(), resolved, {
      competitorLinks: input.competitorLinks,
      sourceLinks: input.sourceLinks,
      subject: input.subject,
    }),
  )

  const videos = candidates.filter((c) => c.kind === 'video')
  const listing: VideoListing =
    videos.length === 0
      ? { details: {}, error: null }
      : await steps.run(`gather-videos-${round}`, () => listVideos(db, sources(), videos, now()))

  const ids: string[] = []
  for (let batch = 0; batch * BATCH_SIZE < candidates.length; batch++) {
    const slice = candidates.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE)
    ids.push(
      ...(await steps.run(`gather-fetch-${round}-${batch}`, () =>
        fetchBatch(db, sources(), slice, listing, now()),
      )),
    )
  }

  const ranked = await steps.run(`gather-rank-${round}`, () =>
    rankAndLink(db, input.projectId, placed(candidates, ids), resolved.dissolved),
  )
  return { entity, ...ranked }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The four fixture documents, linked in their own order: the mock passes cite
 * them by number, so rank must equal position.
 */
async function storeMockCorpus(
  db: Database,
  projectId: string,
  fetchedAt: Date,
): Promise<string[]> {
  const rows: ResearchDocumentRow[] = []
  for (const doc of mockCorpusDocuments()) {
    rows.push(
      await upsertResearchDocument(db, {
        url: normaliseDocumentUrl(doc.url),
        finalUrl: doc.url,
        httpStatus: 200,
        fetchedAt,
        contentType: 'text/plain',
        kind: doc.kind,
        tier: DOCUMENT_TIERS[doc.kind],
        title: doc.title,
        publishedAt: doc.publishedAt,
        text: doc.text,
        textHash: sha256(doc.text),
        tokens: estimateTokens(doc.text),
        archivedUrl: doc.archivedUrl,
        truncated: false,
        failure: null,
        meta: null,
      }),
    )
  }
  await linkDossierDocuments(
    db,
    projectId,
    rows.map((row, i) => ({ documentId: row.id, rank: i + 1, tier: DOCUMENT_TIERS[row.kind] })),
  )
  return rows.map((row) => row.id)
}

/** What reading one candidate produced, before it becomes a row. */
interface Reading {
  finalUrl: string | null
  httpStatus: number | null
  contentType: string | null
  title: string | null
  publishedAt: string | null
  text: string
  archivedUrl: string | null
  /** The row's failure note as stored, such as "could not fetch: returned 404". */
  failure: string | null
  meta?: Record<string, unknown>
}

const failedReading = (failure: string, over: Partial<Reading> = {}): Reading => ({
  finalUrl: null,
  httpStatus: null,
  contentType: null,
  title: null,
  publishedAt: null,
  text: '',
  archivedUrl: null,
  failure,
  ...over,
})

const couldNotFetch = (reason: string, over: Partial<Reading> = {}): Reading =>
  failedReading(`could not fetch: ${reason}`, over)

/** Postgres refuses a NUL in a text column, and some PDFs and pages carry one. */
const withoutNul = (value: string) => value.replaceAll('\u0000', '')

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function storedByUrl(
  db: Database,
  candidates: readonly Candidate[],
): Promise<Map<string, ResearchDocumentRow>> {
  const rows = await findResearchDocumentsByUrl(
    db,
    candidates.map((c) => c.url),
  )
  return new Map(rows.map((row) => [row.url, row]))
}

/**
 * A stored row is used as it is while it is younger than 90 days. A failed
 * fetch is tried again whatever its age: a dead link today may be a timeout
 * that clears, and holding the failure for 90 days would hide the page.
 */
function reusable(row: ResearchDocumentRow | undefined, at: Date): boolean {
  return (
    row !== undefined &&
    row.failure === null &&
    at.getTime() - row.fetchedAt.getTime() < FRESH_FOR_MS
  )
}

/** A good copy, however old: a failed refetch must not overwrite it. */
const goodCopy = (row: ResearchDocumentRow | undefined): row is ResearchDocumentRow =>
  row !== undefined && row.failure === null && row.text !== ''

/**
 * Details for every video the fetch steps will read, in one `videos.list`.
 * Videos with a fresh stored row are left out, so a re-gather spends nothing.
 */
async function listVideos(
  db: Database,
  sources: ResearchSources,
  videos: readonly Candidate[],
  at: Date,
): Promise<VideoListing> {
  const stored = await storedByUrl(db, videos)
  const ids = videos
    .filter((c) => !reusable(stored.get(c.url), at))
    .flatMap((c) => videoIdOf(c) ?? [])
  if (ids.length === 0 || sources.youtube === null) return { details: {}, error: null }
  try {
    const found = await sources.youtube.details(ids)
    return {
      details: Object.fromEntries(
        found.map((d) => [
          d.id,
          {
            title: d.title,
            description: d.description,
            publishedAt: d.publishedAt,
            channelTitle: d.channelTitle,
          },
        ]),
      ),
      error: null,
    }
  } catch (error) {
    console.warn(`dossier gather: YouTube details failed: ${messageOf(error)}`)
    return { details: {}, error: messageOf(error) }
  }
}

async function fetchBatch(
  db: Database,
  sources: ResearchSources,
  batch: readonly Candidate[],
  videos: VideoListing,
  fetchedAt: Date,
): Promise<string[]> {
  const stored = await storedByUrl(db, batch)

  return Promise.all(
    batch.map(async (candidate) => {
      const row = stored.get(candidate.url)
      if (row !== undefined && reusable(row, fetchedAt)) return row.id
      let reading: Reading
      try {
        reading = await read(sources, candidate, videos)
      } catch (error) {
        reading = couldNotFetch(messageOf(error))
      }
      // The row is shared by every project that cites the page. Its stale fetchedAt
      // stays, so the next gather tries again.
      if (reading.failure !== null && goodCopy(row)) return row.id
      try {
        return (await upsertResearchDocument(db, toRow(candidate, reading, fetchedAt))).id
      } catch (error) {
        // One row the database refuses must not reject the whole batch: the step
        // would fail, Inngest would retry it four times, and the run would fail.
        // The bare failure row leaves out every value read from the source.
        if (goodCopy(row)) return row.id
        // Drizzle's own message repeats the query and its values, the refused
        // byte among them, so the note is the driver's cause.
        const cause = error instanceof Error && error.cause !== undefined ? error.cause : error
        const refused = failedReading(`could not store: ${withoutNul(messageOf(cause))}`)
        const saved = await upsertResearchDocument(db, {
          ...toRow(candidate, refused, fetchedAt),
          meta: null,
        })
        return saved.id
      }
    }),
  )
}

function toRow(candidate: Candidate, reading: Reading, fetchedAt: Date): ResearchDocumentInput {
  const failed = reading.failure !== null
  const text = failed ? '' : withoutNul(reading.text)
  const title = reading.title ?? candidate.title
  return {
    url: candidate.url,
    finalUrl: reading.finalUrl,
    httpStatus: reading.httpStatus,
    fetchedAt,
    contentType: reading.contentType,
    kind: candidate.kind,
    tier: candidate.tier,
    title: title === null ? null : withoutNul(title),
    // The source's own date (a filing day, a capture day) beats one guessed from the page.
    publishedAt: candidate.publishedAt ?? reading.publishedAt,
    text,
    textHash: failed ? null : sha256(text),
    tokens: estimateTokens(text),
    archivedUrl: reading.archivedUrl,
    truncated: false,
    failure: reading.failure,
    meta:
      candidate.meta === null && reading.meta === undefined
        ? null
        : { ...candidate.meta, ...reading.meta },
  }
}

const videoIdOf = (candidate: Candidate): string | null =>
  typeof candidate.meta?.['videoId'] === 'string' ? candidate.meta['videoId'] : null

const two = (n: number) => String(n).padStart(2, '0')

/** `[mm:ss]`, or `[h:mm:ss]` past the hour: the marker grounding reads a locator from. */
function marker(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `[${h}:${two(m)}:${two(s % 60)}]` : `[${two(m)}:${two(s % 60)}]`
}

async function read(
  sources: ResearchSources,
  candidate: Candidate,
  videos: VideoListing,
): Promise<Reading> {
  if (candidate.kind === 'video') return readVideo(sources, candidate, videos)
  if (candidate.kind === 'figures') return readFigures(sources, candidate)

  const doc = await sources.fetchDocument(candidate.url, {
    // A capture is already the archive; asking the archive for it again finds nothing new.
    archiveFallback: candidate.kind !== 'web-archive',
    // The SEC's fair-access rules want a contact on EDGAR documents; one identity for all.
    userAgent: sources.userAgent,
  })
  const fetched = {
    finalUrl: doc.finalUrl,
    httpStatus: doc.httpStatus,
    contentType: doc.contentType,
    archivedUrl: doc.archivedUrl,
  }
  if (doc.failure !== null) return couldNotFetch(doc.failure, fetched)
  const extracted = await extractText(doc, candidate.kind)
  if (extracted.failure !== null) return failedReading(extracted.failure, fetched)
  if (extracted.text.trim() === '') return couldNotFetch('no text in the page', fetched)
  return { ...fetched, ...extracted, failure: null }
}

/**
 * A video is read through the Data API (title, description, date) and, when
 * the flag allows, its caption track. Without either there is nothing to cite.
 */
async function readVideo(
  sources: ResearchSources,
  candidate: Candidate,
  videos: VideoListing,
): Promise<Reading> {
  const videoId = videoIdOf(candidate)
  if (videoId === null) return couldNotFetch('no video id')
  const about: VideoAbout | undefined = videos.details[videoId]
  let segments: TranscriptSegment[] | null = null
  if (sources.transcripts !== null) {
    try {
      segments = await sources.transcripts.fetch(videoId)
    } catch {
      segments = null
    }
  }
  const transcript = segments !== null && segments.length > 0 ? segments : null

  if (about === undefined && transcript === null) {
    return couldNotFetch(
      sources.youtube === null
        ? 'no YouTube Data API key to read the video'
        : (videos.error ?? 'video not found'),
    )
  }
  const text = [
    about?.description.trim() ?? '',
    transcript?.map((s) => `${marker(s.start)} ${s.text}`).join('\n') ?? '',
  ]
    .filter((part) => part !== '')
    .join('\n\n')
  return {
    finalUrl: candidate.url,
    httpStatus: 200,
    contentType: 'text/plain',
    title: about?.title ?? null,
    publishedAt: about?.publishedAt ?? null,
    text,
    archivedUrl: null,
    failure: text === '' ? 'could not fetch: no description and no transcript' : null,
    meta: {
      transcript: transcript !== null,
      ...(about === undefined ? {} : { channelTitle: about.channelTitle }),
    },
  }
}

async function readFigures(sources: ResearchSources, candidate: Candidate): Promise<Reading> {
  const cik = candidate.meta?.['cik']
  const symbol = candidate.meta?.['symbol']
  let text: string
  if (typeof cik === 'string') {
    const facts = await sources.xbrl.companyFacts(cik)
    if (facts === null) return couldNotFetch('no XBRL company facts')
    text = xbrlFactsText(facts)
    if (text === '') return couldNotFetch('no annual figures in the XBRL company facts')
  } else if (typeof symbol === 'string') {
    const csv = await sources.stooq.daily(symbol)
    if (csv === null) return couldNotFetch('no prices for the symbol')
    text = pricesText(csv)
    if (text === '') return couldNotFetch('no prices for the symbol')
  } else {
    return couldNotFetch('no figures source')
  }
  return {
    finalUrl: candidate.url,
    httpStatus: 200,
    contentType: 'text/plain',
    title: null,
    publishedAt: null,
    text,
    archivedUrl: null,
    failure: null,
  }
}

/** A fetched document's id with the tier and pin its candidate gave it in this gather. */
interface Placed {
  id: string
  /** Null only if the ids outrun the candidates, when the row's own kind decides. */
  tier: Candidate['tier'] | null
  pinned: boolean
}

/**
 * The fetch steps hand back one id per candidate, in candidate order. The
 * tier and the pin are this case's, read from the candidate and not from the
 * stored row: the row is shared by every project that cites the page, so an
 * owner's link another project fetched as a reference keeps that project's
 * tier and no pin, and a page one owner pinned is not pinned for every case.
 */
function placed(candidates: readonly Candidate[], ids: readonly string[]): Placed[] {
  return ids.map((id, i) => {
    const candidate = candidates[i]
    return {
      id,
      tier: candidate?.tier ?? null,
      pinned: candidate?.meta?.['pinned'] === true,
    }
  })
}

/**
 * Rank the fetched documents and write the project's corpus links. Rows keep
 * their whole text: the cut to the per-document cap is the ranker's view, and
 * the corpus is cut the same way again when it is loaded for the passes.
 */
async function rankAndLink(
  db: Database,
  projectId: string,
  docs: readonly Placed[],
  anchorDate: string | null,
): Promise<{ read: string[]; unread: string[]; failed: number }> {
  const placement = new Map<string, Placed>()
  for (const doc of docs) if (!placement.has(doc.id)) placement.set(doc.id, doc)
  const byId = new Map(
    (await getResearchDocuments(db, [...placement.keys()])).map((row) => [row.id, row]),
  )
  // Candidate order, so documents the ranker cannot tell apart keep the order discovery gave them.
  const rows = [...placement.keys()].flatMap((id) => byId.get(id) ?? [])
  const tierOf = (row: ResearchDocumentRow) =>
    placement.get(row.id)?.tier ?? DOCUMENT_TIERS[row.kind]
  const usable = rows.filter((row) => row.failure === null)
  const failed = rows.filter((row) => row.failure !== null)

  const { read, unread } = rankCorpus(
    usable.map((row) => ({
      id: row.id,
      kind: row.kind,
      tier: tierOf(row),
      tokens: row.tokens,
      publishedAt: row.publishedAt,
      text: row.text,
      pinned: placement.get(row.id)?.pinned === true,
    })),
    { anchorDate },
  )

  await linkDossierDocuments(db, projectId, [
    ...read.map((doc) => ({ documentId: doc.id, rank: doc.rank, tier: doc.tier })),
    ...unread.map((doc) => ({ documentId: doc.id, rank: null, tier: doc.tier })),
    ...failed.map((row) => ({ documentId: row.id, rank: null, tier: tierOf(row) })),
  ])

  return {
    read: read.map((doc) => doc.id),
    unread: unread.map((doc) => doc.id),
    failed: failed.length,
  }
}
