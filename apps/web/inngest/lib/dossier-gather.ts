import { createHash } from 'node:crypto'
import type { TranscriptSegment, VideoDetails } from '@boom-busters/case-finder'
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
import {
  discoverCandidates,
  resolveEntity,
  type Candidate,
  type ResolvedEntity,
} from './dossier-discover'
import type { Steps } from './steps'

/**
 * The corpus a dossier is researched from (spec 4): resolve the case to an
 * entity, list candidate documents, fetch them in batches, rank what came
 * back, and link the result to the project.
 *
 * Inngest stores every step's return value, so the fetch steps write each
 * document to the database inside the step and hand back only its id. A batch
 * is five candidates: each fetch is capped at 8 s with at most two short
 * retries, which keeps a step well inside the 300 s function limit.
 */

const BATCH_SIZE = 5
const FRESH_FOR_MS = 90 * 86_400_000

export interface GatherInput {
  projectId: string
  caseTitle: string
  competitorLinks: readonly { url: string }[]
  round: number
}

export interface GatherDeps {
  db: Database
  sources: ResearchSources
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

const MOCK_ENTITY: ResolvedEntity = {
  qid: null,
  titles: [],
  cik: null,
  ticker: null,
  website: null,
  businessTitle: null,
  relatedTitles: [],
  exchange: null,
  inception: null,
  dissolved: null,
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
    mocked ? MOCK_ENTITY : resolveEntity(sources, input.caseTitle),
  )
  const entity: ResearchEntity = {
    qid: resolved.qid,
    titles: resolved.titles,
    cik: resolved.cik,
    ticker: resolved.ticker,
    website: resolved.website,
  }

  if (mocked) {
    const ids = await steps.run(`gather-fetch-${round}-0`, () =>
      storeMockCorpus(db, input.projectId, now()),
    )
    return { entity, read: ids, unread: [], failed: 0 }
  }

  const candidates = await steps.run(`gather-discover-${round}`, () =>
    discoverCandidates(sources, resolved, {
      competitorLinks: input.competitorLinks,
      caseTitle: input.caseTitle,
    }),
  )

  const ids: string[] = []
  for (let batch = 0; batch * BATCH_SIZE < candidates.length; batch++) {
    const slice = candidates.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE)
    ids.push(
      ...(await steps.run(`gather-fetch-${round}-${batch}`, () =>
        fetchBatch(db, sources, slice, now()),
      )),
    )
  }

  const ranked = await steps.run(`gather-rank-${round}`, () =>
    rankAndLink(db, input.projectId, ids, resolved.dissolved),
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
  /** The reason, without the "could not fetch" prefix the row gets. */
  failure: string | null
  meta?: Record<string, unknown>
}

const failedReading = (reason: string, over: Partial<Reading> = {}): Reading => ({
  finalUrl: null,
  httpStatus: null,
  contentType: null,
  title: null,
  publishedAt: null,
  text: '',
  archivedUrl: null,
  failure: reason,
  ...over,
})

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function fetchBatch(
  db: Database,
  sources: ResearchSources,
  batch: readonly Candidate[],
  fetchedAt: Date,
): Promise<string[]> {
  const stored = new Map(
    (
      await findResearchDocumentsByUrl(
        db,
        batch.map((c) => c.url),
      )
    ).map((row) => [row.url, row]),
  )
  // A failed fetch is tried again whatever its age: a dead link today may be a
  // timeout that clears, and holding the failure for 90 days would hide the page.
  const reusable = (row: ResearchDocumentRow | undefined): row is ResearchDocumentRow =>
    row !== undefined &&
    row.failure === null &&
    fetchedAt.getTime() - row.fetchedAt.getTime() < FRESH_FOR_MS

  const toRead = batch.filter((c) => !reusable(stored.get(c.url)))
  const details = await videoDetails(sources, toRead)

  return Promise.all(
    batch.map(async (candidate) => {
      const row = stored.get(candidate.url)
      if (reusable(row)) return row.id
      let reading: Reading
      try {
        reading = await read(sources, candidate, details)
      } catch (error) {
        reading = failedReading(messageOf(error))
      }
      const saved = await upsertResearchDocument(db, toRow(candidate, reading, fetchedAt))
      return saved.id
    }),
  )
}

function toRow(candidate: Candidate, reading: Reading, fetchedAt: Date): ResearchDocumentInput {
  const failed = reading.failure !== null
  const text = failed ? '' : reading.text
  return {
    url: candidate.url,
    finalUrl: reading.finalUrl,
    httpStatus: reading.httpStatus,
    fetchedAt,
    contentType: reading.contentType,
    kind: candidate.kind,
    tier: candidate.tier,
    title: reading.title ?? candidate.title,
    // The source's own date (a filing day, a capture day) beats one guessed from the page.
    publishedAt: candidate.publishedAt ?? reading.publishedAt,
    text,
    textHash: failed ? null : sha256(text),
    tokens: estimateTokens(text),
    archivedUrl: reading.archivedUrl,
    truncated: false,
    failure: failed ? `could not fetch: ${reading.failure}` : null,
    meta:
      candidate.meta === null && reading.meta === undefined
        ? null
        : { ...candidate.meta, ...reading.meta },
  }
}

const videoIdOf = (candidate: Candidate): string | null =>
  typeof candidate.meta?.['videoId'] === 'string' ? candidate.meta['videoId'] : null

/** One `videos.list` for the batch's videos, rather than one each. */
async function videoDetails(
  sources: ResearchSources,
  batch: readonly Candidate[],
): Promise<Map<string, VideoDetails>> {
  const ids = batch.filter((c) => c.kind === 'video').flatMap((c) => videoIdOf(c) ?? [])
  if (ids.length === 0 || sources.youtube === null) return new Map()
  try {
    return new Map((await sources.youtube.details(ids)).map((d) => [d.id, d]))
  } catch (error) {
    console.warn(`dossier gather: YouTube details failed: ${messageOf(error)}`)
    return new Map()
  }
}

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
  details: Map<string, VideoDetails>,
): Promise<Reading> {
  if (candidate.kind === 'video') return readVideo(sources, candidate, details)
  if (candidate.kind === 'figures') return readFigures(sources, candidate)

  const doc = await sources.fetchDocument(candidate.url, {
    // A capture is already the archive; asking the archive for it again finds nothing new.
    archiveFallback: candidate.kind !== 'web-archive',
  })
  const fetched = {
    finalUrl: doc.finalUrl,
    httpStatus: doc.httpStatus,
    contentType: doc.contentType,
    archivedUrl: doc.archivedUrl,
  }
  if (doc.failure !== null) return failedReading(doc.failure, fetched)
  const extracted = await extractText(doc, candidate.kind)
  if (extracted.text.trim() === '') return failedReading('no text in the page', fetched)
  return { ...fetched, ...extracted, failure: null }
}

/**
 * A video is read through the Data API (title, description, date) and, when
 * the flag allows, its caption track. Without either there is nothing to cite.
 */
async function readVideo(
  sources: ResearchSources,
  candidate: Candidate,
  details: Map<string, VideoDetails>,
): Promise<Reading> {
  const videoId = videoIdOf(candidate)
  if (videoId === null) return failedReading('no video id')
  const about = details.get(videoId)
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
    return failedReading(
      sources.youtube === null ? 'no YouTube Data API key to read the video' : 'video not found',
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
    failure: text === '' ? 'no description and no transcript' : null,
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
    if (facts === null) return failedReading('no XBRL company facts')
    text = xbrlFactsText(facts)
    if (text === '') return failedReading('no annual figures in the XBRL company facts')
  } else if (typeof symbol === 'string') {
    const csv = await sources.stooq.daily(symbol)
    if (csv === null) return failedReading('no prices for the symbol')
    text = pricesText(csv)
    if (text === '') return failedReading('no prices for the symbol')
  } else {
    return failedReading('no figures source')
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

/**
 * Rank the fetched documents and write the project's corpus links. Rows keep
 * their whole text: the cut to the per-document cap is the ranker's view, and
 * the corpus is cut the same way again when it is loaded for the passes.
 */
async function rankAndLink(
  db: Database,
  projectId: string,
  ids: readonly string[],
  anchorDate: string | null,
): Promise<{ read: string[]; unread: string[]; failed: number }> {
  const byId = new Map((await getResearchDocuments(db, ids)).map((row) => [row.id, row]))
  // Candidate order, so documents the ranker cannot tell apart keep the order discovery gave them.
  const rows = [...new Set(ids)].flatMap((id) => byId.get(id) ?? [])
  const usable = rows.filter((row) => row.failure === null)
  const failed = rows.filter((row) => row.failure !== null)

  const { read, unread } = rankCorpus(
    usable.map((row) => ({
      id: row.id,
      kind: row.kind,
      tier: DOCUMENT_TIERS[row.kind],
      tokens: row.tokens,
      publishedAt: row.publishedAt,
      text: row.text,
    })),
    { anchorDate },
  )

  await linkDossierDocuments(db, projectId, [
    ...read.map((doc) => ({ documentId: doc.id, rank: doc.rank, tier: doc.tier })),
    ...unread.map((doc) => ({ documentId: doc.id, rank: null, tier: doc.tier })),
    ...failed.map((row) => ({ documentId: row.id, rank: null, tier: DOCUMENT_TIERS[row.kind] })),
  ])

  return {
    read: read.map((doc) => doc.id),
    unread: unread.map((doc) => doc.id),
    failed: failed.length,
  }
}
