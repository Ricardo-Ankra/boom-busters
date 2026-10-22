import {
  caseFinderUserAgent,
  createPoliteClient,
  createQuotaLedger,
  liveCourtListener,
  liveEdgar,
  liveStooq,
  liveTranscripts,
  liveWayback,
  liveWikidata,
  liveWikipedia,
  liveXbrl,
  liveYoutube,
  mockCourtListener,
  mockEdgar,
  mockStooq,
  mockTranscripts,
  mockWayback,
  mockWikidata,
  mockWikipedia,
  mockXbrl,
  mockYoutube,
  type CourtListenerSource,
  type EdgarSource,
  type StooqSource,
  type TranscriptSource,
  type WaybackSource,
  type WikidataSource,
  type WikipediaSource,
  type XbrlSource,
  type YoutubeSource,
} from '@boom-busters/case-finder'
import { fetchDocument } from '@boom-busters/providers'
import { ConfigError, readCaseFinderEnv } from '@boom-busters/schemas'

/**
 * Where the dossier gather finds its documents: the case-finder's sources plus
 * the document fetcher, in one object so a test or the back-test can hand in
 * its own.
 */
export interface ResearchSources {
  wikipedia: WikipediaSource
  wikidata: WikidataSource
  edgar: EdgarSource
  courtlistener: CourtListenerSource
  youtube: YoutubeSource | null
  transcripts: TranscriptSource | null
  stooq: StooqSource
  wayback: WaybackSource
  xbrl: XbrlSource
  fetchDocument: typeof fetchDocument
  /** The identity `fetchDocument` is called with, the case-finder's own, contact included. */
  userAgent: string
}

/**
 * Each request's ceiling; neither the PoliteClient nor the transcript reader has
 * one of its own. The client's is longer because one XBRL companyfacts answer
 * can run to tens of megabytes.
 */
const CLIENT_TIMEOUT_MS = 20_000
const TRANSCRIPT_TIMEOUT_MS = 8_000

/**
 * A gather spends at most about 101 units a case (one search, one
 * `videos.list`); the ceiling keeps a runaway loop from eating the day's
 * 10,000 (spec 4.5). Nothing persists spend between runs, and the gather builds
 * its sources once per step, so the ceiling holds per step: the search and the
 * details call each sit in a step of their own.
 */
const YOUTUBE_UNITS_PER_RUN = 1_000

/** `fetch` with a deadline, keeping any signal the caller passed as well. */
function timedFetch(ms: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(ms)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return fetch(input, { ...init, signal })
  }
}

const noDockets: CourtListenerSource = { dockets: async () => [] }

export function liveResearchSources(
  env: Record<string, string | undefined> = process.env,
): ResearchSources {
  const config = readCaseFinderEnv(env)
  const contact = config.DATA_CONTACT_EMAIL
  // Wikimedia and the SEC refuse anonymous clients, so there is no gather without it.
  if (contact === undefined) throw new ConfigError('caseFinder', ['DATA_CONTACT_EMAIL'])

  // No disk on Vercel: the research_documents table is the cache. The retry is tight
  // because a step has 300 s, and the client's patient default can wait two minutes.
  const client = createPoliteClient({
    contact,
    cacheDir: null,
    fetchImpl: timedFetch(CLIENT_TIMEOUT_MS),
    retry: { attempts: 2, maxBackoffMs: 10_000 },
  })

  return {
    wikipedia: liveWikipedia(client, { itemsCacheDir: null }),
    wikidata: liveWikidata(client),
    edgar: liveEdgar(client),
    // Without a token the docket search is skipped; court pages still arrive as references.
    courtlistener:
      config.COURTLISTENER_TOKEN === undefined
        ? noDockets
        : liveCourtListener(client, config.COURTLISTENER_TOKEN),
    youtube:
      config.YOUTUBE_DATA_API_KEY === undefined
        ? null
        : liveYoutube(
            client,
            config.YOUTUBE_DATA_API_KEY,
            createQuotaLedger(YOUTUBE_UNITS_PER_RUN, 0),
          ),
    transcripts:
      config.YOUTUBE_TRANSCRIPTS === '1'
        ? liveTranscripts({ fetchImpl: timedFetch(TRANSCRIPT_TIMEOUT_MS), contact })
        : null,
    stooq: liveStooq(client),
    wayback: liveWayback(client),
    xbrl: liveXbrl(client),
    fetchDocument,
    userAgent: caseFinderUserAgent(contact),
  }
}

/** A page that says it is a mock, whatever was asked for. */
const mockFetchDocument: typeof fetchDocument = async (url) => ({
  url,
  finalUrl: url,
  httpStatus: 200,
  contentType: 'text/plain',
  body: new TextEncoder().encode(
    `MOCK DOCUMENT. A fixture page standing in for ${url}; it describes nothing real.`,
  ),
  archivedUrl: null,
  failure: null,
})

export function mockResearchSources(): ResearchSources {
  return {
    wikipedia: mockWikipedia,
    wikidata: mockWikidata,
    edgar: mockEdgar,
    courtlistener: mockCourtListener,
    youtube: mockYoutube,
    transcripts: mockTranscripts,
    stooq: mockStooq,
    wayback: mockWayback,
    xbrl: mockXbrl,
    fetchDocument: mockFetchDocument,
    userAgent: caseFinderUserAgent('mock@example.invalid'),
  }
}
