// @vitest-environment node

import {
  createCase,
  createDb,
  createProjectFromCase,
  listDossierDocuments,
  findResearchDocumentsByUrl,
  requireTestDatabase,
  upsertResearchDocument,
} from '@boom-busters/db'
import type { VideoDetails, YoutubeSource } from '@boom-busters/case-finder'
import type { FetchedDocument } from '@boom-busters/providers'
import { mockCorpusDocuments } from '@boom-busters/providers'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchSources } from '@/lib/research-sources'
import { FAKE_USER_AGENT, fakeSources, unexpected } from '@/test/fake-research-sources'
import { gatherCorpus } from './dossier-gather'
import type { Steps } from './steps'

/**
 * The gather against the test database, with fake sources and a fake
 * `fetchDocument`, so nothing leaves the machine. Each test owns a throwaway
 * case and project and only the documents under its own host, so a suite in
 * another session sharing the database is not disturbed.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const HOST = 'https://gather-test.example'
const DAY = 86_400_000

/** Test documents that cannot live under HOST: the figures and video urls discovery builds. */
const CIK = '9999001'
const SYMBOL = 'gathertest.us'
const XBRL_URL = `https://data.sec.gov/api/xbrl/companyfacts/CIK000${CIK}.json`
const STOOQ_URL = `https://stooq.com/q/d/l/?s=${SYMBOL}&i=d`
const VIDEO_IDS = ['gathertestA', 'gathertestB', 'gathertestC']
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`
const OTHER_URLS = [XBRL_URL, STOOQ_URL, ...VIDEO_IDS.map(watch)]

/**
 * A company found by search, with only the facts a test gives it: its
 * article's references, and a CIK and ticker when the test wants figures.
 */
function companySources(options: {
  links?: string[]
  cik?: string | null
  ticker?: { symbol: string; exchange: string | null } | null
  fetchDocument?: ResearchSources['fetchDocument']
  over?: Partial<ResearchSources>
}): ResearchSources {
  const base = fakeSources()
  return fakeSources({
    wikipedia: {
      ...base.wikipedia,
      search: async () => [{ title: 'Gathertest Co', pageid: 1 }],
      qidsFor: async () => new Map([['Gathertest Co', 'Q4242']]),
      currentItems: async () => ({
        categories: [],
        externalLinks: options.links ?? [],
        links: [],
      }),
    },
    wikidata: {
      sparql: unexpected('sparql'),
      facts: async () =>
        new Map([
          [
            'Q4242',
            {
              qid: 'Q4242',
              enTitle: 'Gathertest Co',
              sitelinks: {},
              country: null,
              cik: options.cik ?? null,
              dissolved: '2020-06-25',
              instanceOf: ['Q4830453'],
              isClass: false,
              ticker: options.ticker ?? null,
              website: null,
              inception: null,
              people: [],
            },
          ],
        ]),
    },
    courtlistener: { dockets: async () => [] },
    ...(options.fetchDocument === undefined ? {} : { fetchDocument: options.fetchDocument }),
    ...options.over,
  })
}

function details(id: string, description: string): VideoDetails {
  return {
    id,
    title: `Video ${id}`,
    description,
    publishedAt: '2021-03-04',
    durationSec: 4000,
    channelTitle: 'Gathertest channel',
  }
}

function youtubeWith(detailsFn: YoutubeSource['details']): YoutubeSource {
  return {
    search: async () => ({ fetchedAt: '2026-10-22', videos: [] }),
    channelByHandle: unexpected('channelByHandle'),
    uploads: unexpected('uploads'),
    details: detailsFn,
  }
}

const XBRL_FACTS = {
  facts: {
    'us-gaap': {
      Revenues: {
        units: {
          USD: [
            {
              form: '10-K',
              fp: 'FY',
              val: 1_200_000,
              start: '2019-01-01',
              end: '2019-12-31',
              filed: '2020-02-01',
            },
          ],
        },
      },
    },
  },
}

const PRICES =
  'Date,Open,High,Low,Close,Volume\n2020-01-02,10,11,9,10.5,1000\n2020-01-31,10.5,11,10,10.2,900\n'

function page(target: string, text: string): FetchedDocument {
  return {
    url: target,
    finalUrl: target,
    httpStatus: 200,
    contentType: 'text/plain',
    body: new TextEncoder().encode(text),
    archivedUrl: null,
    failure: null,
  }
}

/** About 12,500 estimated tokens in paragraphs, so the ranker cuts each to its 12,000. */
function longText(label: string): string {
  return Array.from(
    { length: 50 },
    (_, i) => `${label} paragraph ${i}. ${'word '.repeat(198)}`,
  ).join('\n\n')
}

function recordingSteps(): Steps & { ids: string[] } {
  const ids: string[] = []
  return {
    ids,
    run: (id, fn) => {
      ids.push(id)
      return fn()
    },
  }
}

suite('gatherCorpus', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })
  let projectId = ''
  let caseId = ''

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  async function clearDocuments() {
    await sql`delete from research_documents where url like ${`${HOST}/%`} or url in ${sql(OTHER_URLS)}`
  }

  beforeEach(async () => {
    await clearDocuments()
    const created = await createCase(db, {
      title: `Gathertest ${Date.now()} ${Math.random().toString(36).slice(2)}`,
      category: 'collapse',
    })
    caseId = created.id
    projectId = (await createProjectFromCase(db, { caseId, title: created.title })).id
  })

  afterEach(async () => {
    await sql`delete from projects where id = ${projectId}`
    await sql`delete from cases where id = ${caseId}`
    await clearDocuments()
  })

  const input = (round = 0) => ({ projectId, caseTitle: 'Gathertest', competitorLinks: [], round })

  it('stores every candidate, links the ranked ones and marks the rest unread', async () => {
    const links = Array.from({ length: 8 }, (_, i) => `${HOST}/story-${i + 1}`)
    const fetchDocument = vi.fn(async (target: string) => page(target, longText(target)))
    const steps = recordingSteps()

    const result = await gatherCorpus(steps, input(), {
      db,
      sources: () => companySources({ links, fetchDocument }),
      mocked: false,
    })

    expect(steps.ids).toEqual([
      'gather-entity-0',
      'gather-discover-0',
      'gather-fetch-0-0',
      'gather-fetch-0-1',
      'gather-rank-0',
    ])
    expect(fetchDocument).toHaveBeenCalledTimes(8)
    expect(result.entity).toEqual({
      qid: 'Q4242',
      titles: ['Gathertest Co'],
      cik: null,
      ticker: null,
      website: null,
    })
    // Tier 2's 30% share plus tier 1's unspent 25% holds five 12,000-token documents.
    expect(result.read).toHaveLength(5)
    expect(result.unread).toHaveLength(3)
    expect(result.failed).toBe(0)

    const linked = await listDossierDocuments(db, projectId)
    expect(linked).toHaveLength(8)
    expect(linked.map((d) => d.rank)).toEqual([1, 2, 3, 4, 5, null, null, null])
    expect(linked.slice(0, 5).map((d) => d.id)).toEqual(result.read)
    expect(new Set(linked.slice(5).map((d) => d.id))).toEqual(new Set(result.unread))
    expect(linked[5]).toMatchObject({ rank: null, tier: 2 })
    expect(fetchDocument).toHaveBeenCalledWith(links[0], {
      archiveFallback: true,
      userAgent: FAKE_USER_AGENT,
    })

    // The row keeps the whole page; the cut to the document cap is made when the corpus is read.
    const row = linked[0]!
    expect(row.text.length).toBeGreaterThan(48_000)
    expect(row.truncated).toBe(false)
    expect(row.tokens).toBe(Math.ceil(row.text.length / 4))
    expect(row.textHash).toMatch(/^[0-9a-f]{64}$/)
    expect(row).toMatchObject({ kind: 'reporting', tier: 2, httpStatus: 200, failure: null })
  })

  it('reuses a document fetched less than 90 days ago without calling fetch', async () => {
    const fresh = `${HOST}/fresh`
    const stale = `${HOST}/stale`
    const stored = (target: string, ageDays: number) =>
      upsertResearchDocument(db, {
        url: target,
        fetchedAt: new Date(Date.now() - ageDays * DAY),
        kind: 'reporting',
        tier: 2,
        text: `Stored text of ${target}.`,
        tokens: 8,
        httpStatus: 200,
      })
    const freshRow = await stored(fresh, 10)
    const staleRow = await stored(stale, 100)
    const fetchDocument = vi.fn(async (target: string) => page(target, `Refetched ${target}.`))

    const result = await gatherCorpus(recordingSteps(), input(), {
      db,
      sources: () => companySources({ links: [fresh, stale], fetchDocument }),
      mocked: false,
    })

    expect(fetchDocument.mock.calls.map(([target]) => target)).toEqual([stale])
    expect(new Set(result.read)).toEqual(new Set([freshRow.id, staleRow.id]))
    const rows = await findResearchDocumentsByUrl(db, [fresh, stale])
    const text = Object.fromEntries(rows.map((r) => [r.url, r.text]))
    expect(text).toEqual({ [fresh]: `Stored text of ${fresh}.`, [stale]: `Refetched ${stale}.` })
  })

  it('records a failed fetch and continues', async () => {
    const good = `${HOST}/good`
    const missing = `${HOST}/missing`
    const broken = `${HOST}/broken`
    const fetchDocument = vi.fn(async (target: string): Promise<FetchedDocument> => {
      if (target === broken) throw new Error('socket hang up')
      if (target === missing) {
        return { ...page(target, ''), httpStatus: 404, body: null, failure: 'returned 404' }
      }
      return page(target, 'A page that loaded.')
    })

    const result = await gatherCorpus(recordingSteps(), input(), {
      db,
      sources: () => companySources({ links: [missing, broken, good], fetchDocument }),
      mocked: false,
    })

    expect(fetchDocument).toHaveBeenCalledTimes(3)
    expect(result.failed).toBe(2)
    expect(result.unread).toEqual([])
    const linked = await listDossierDocuments(db, projectId)
    // Unranked links share one insert, so their order among themselves is not fixed.
    const byUrl = (a: { url: string }, b: { url: string }) => a.url.localeCompare(b.url)
    expect(linked[0]).toMatchObject({ url: good, rank: 1, failure: null })
    expect(
      linked
        .slice(1)
        .sort(byUrl)
        .map((d) => [d.url, d.rank, d.failure]),
    ).toEqual([
      [broken, null, 'could not fetch: socket hang up'],
      [missing, null, 'could not fetch: returned 404'],
    ])
    expect(result.read).toEqual([linked[0]!.id])
    expect(linked.find((d) => d.url === missing)).toMatchObject({
      rank: null,
      tier: 2,
      httpStatus: 404,
      text: '',
      tokens: 0,
    })
  })

  it('stores an image as a failure, drops NUL bytes, and turns a refused row into a failure', async () => {
    const image = `${HOST}/logo.png`
    const nul = `${HOST}/nul`
    const refused = `${HOST}/refused`
    const fetchDocument = vi.fn(async (target: string): Promise<FetchedDocument> => {
      if (target === image) {
        return { ...page(target, ''), contentType: 'image/png', body: new Uint8Array([0x89, 0, 1]) }
      }
      if (target === nul) return page(target, 'before\u0000after')
      // A content type Postgres will not hold stands in for any value the database refuses.
      return { ...page(target, 'fine text'), contentType: 'text/plain\u0000' }
    })

    const result = await gatherCorpus(recordingSteps(), input(), {
      db,
      sources: () => companySources({ links: [image, nul, refused], fetchDocument }),
      mocked: false,
    })

    expect(result.failed).toBe(2)
    const linked = await listDossierDocuments(db, projectId)
    const byUrl = new Map(linked.map((d) => [d.url, d]))
    expect(byUrl.get(nul)).toMatchObject({ rank: 1, failure: null, text: 'beforeafter' })
    expect(byUrl.get(image)).toMatchObject({
      rank: null,
      text: '',
      contentType: 'image/png',
      failure: 'not a text document (image/png)',
    })
    expect(byUrl.get(refused)).toMatchObject({ rank: null, text: '', contentType: null })
    expect(byUrl.get(refused)?.failure).toBe(
      'could not store: invalid byte sequence for encoding "UTF8": 0x00',
    )
  })

  it('in mock mode stores the four mock documents and calls no source', async () => {
    const steps = recordingSteps()

    const result = await gatherCorpus(steps, input(2), {
      db,
      sources: () => {
        throw new Error('mock mode built the live sources')
      },
      mocked: true,
    })

    expect(steps.ids).toEqual(['gather-entity-2', 'gather-fetch-2-0'])
    expect(result.read).toHaveLength(4)
    expect(result.unread).toEqual([])
    expect(result.failed).toBe(0)
    const linked = await listDossierDocuments(db, projectId)
    expect(linked.map((d) => [d.url, d.rank, d.kind])).toEqual(
      mockCorpusDocuments().map((d, i) => [d.url, i + 1, d.kind]),
    )
    expect(linked.map((d) => d.id)).toEqual(result.read)
    expect(linked[2]).toMatchObject({ tier: 3, httpStatus: 200, failure: null })
  })

  it('keeps a good stored copy when its refetch fails', async () => {
    const old = `${HOST}/old-but-good`
    const fetchedAt = new Date(Date.now() - 100 * DAY)
    const stored = await upsertResearchDocument(db, {
      url: old,
      fetchedAt,
      kind: 'reporting',
      tier: 2,
      text: 'The page as it read before.',
      textHash: 'stored-hash',
      tokens: 7,
      httpStatus: 200,
    })
    const fetchDocument = vi.fn(async (target: string): Promise<FetchedDocument> => ({
      ...page(target, ''),
      httpStatus: 503,
      body: null,
      failure: 'returned 503',
    }))

    const result = await gatherCorpus(recordingSteps(), input(), {
      db,
      sources: () => companySources({ links: [old], fetchDocument }),
      mocked: false,
    })

    expect(fetchDocument).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ read: [stored.id], failed: 0 })
    const [row] = await findResearchDocumentsByUrl(db, [old])
    expect(row).toMatchObject({
      id: stored.id,
      text: 'The page as it read before.',
      textHash: 'stored-hash',
      failure: null,
      fetchedAt,
    })
  })

  it('reads videos from one details call, with the transcript after the description', async () => {
    const [withTranscript, describedOnly, unknown] = VIDEO_IDS as [string, string, string]
    const detailsCall = vi.fn(async (ids: readonly string[]) =>
      ids.filter((id) => id !== unknown).map((id) => details(id, `Description of ${id}.`)),
    )
    const steps = recordingSteps()

    await gatherCorpus(
      steps,
      { ...input(), competitorLinks: VIDEO_IDS.map((id) => ({ url: `https://youtu.be/${id}` })) },
      {
        db,
        sources: () =>
          companySources({
            over: {
              youtube: youtubeWith(detailsCall),
              transcripts: {
                fetch: async (id) =>
                  id === withTranscript
                    ? [
                        { start: 5, text: 'The opening line.' },
                        { start: 3725.4, text: 'A line past the hour.' },
                      ]
                    : null,
              },
            },
          }),
        mocked: false,
      },
    )

    expect(steps.ids).toEqual([
      'gather-entity-0',
      'gather-discover-0',
      'gather-videos-0',
      'gather-fetch-0-0',
      'gather-rank-0',
    ])
    expect(detailsCall).toHaveBeenCalledTimes(1)
    expect(detailsCall).toHaveBeenCalledWith(VIDEO_IDS)
    const rows = Object.fromEntries(
      (await findResearchDocumentsByUrl(db, VIDEO_IDS.map(watch))).map((r) => [r.url, r]),
    )
    expect(rows[watch(withTranscript)]).toMatchObject({
      kind: 'video',
      title: `Video ${withTranscript}`,
      publishedAt: '2021-03-04',
      httpStatus: 200,
      failure: null,
      text: `Description of ${withTranscript}.\n\n[00:05] The opening line.\n[1:02:05] A line past the hour.`,
      meta: { videoId: withTranscript, transcript: true, channelTitle: 'Gathertest channel' },
    })
    expect(rows[watch(describedOnly)]).toMatchObject({
      text: `Description of ${describedOnly}.`,
      failure: null,
      meta: { videoId: describedOnly, transcript: false, channelTitle: 'Gathertest channel' },
    })
    expect(rows[watch(unknown)]).toMatchObject({
      text: '',
      failure: 'could not fetch: video not found',
    })
  })

  it('records the error of a details call that throws', async () => {
    const [first] = VIDEO_IDS as [string]

    const result = await gatherCorpus(
      recordingSteps(),
      { ...input(), competitorLinks: [{ url: watch(first) }] },
      {
        db,
        sources: () =>
          companySources({
            over: {
              youtube: youtubeWith(async () => {
                throw new Error('YouTube quota: spending 1 units would pass the daily 1000')
              }),
            },
          }),
        mocked: false,
      },
    )

    expect(result.failed).toBe(1)
    const [row] = await findResearchDocumentsByUrl(db, [watch(first)])
    expect(row?.failure).toBe(
      'could not fetch: YouTube quota: spending 1 units would pass the daily 1000',
    )
  })

  it('renders XBRL facts and Stooq prices as figures', async () => {
    const result = await gatherCorpus(recordingSteps(), input(), {
      db,
      sources: () =>
        companySources({
          cik: CIK,
          ticker: { symbol: 'GATHERTEST', exchange: 'Q13677' },
          over: {
            xbrl: { companyFacts: async () => XBRL_FACTS },
            stooq: { daily: async () => PRICES },
          },
        }),
      mocked: false,
    })

    expect(result).toMatchObject({ failed: 0, unread: [] })
    const rows = Object.fromEntries(
      (await findResearchDocumentsByUrl(db, [XBRL_URL, STOOQ_URL])).map((r) => [r.url, r]),
    )
    expect(rows[XBRL_URL]).toMatchObject({
      kind: 'figures',
      tier: 4,
      title: `XBRL company facts, CIK ${CIK}`,
      text: 'Revenues | 2019 | 1200000 | USD',
      meta: { cik: CIK },
    })
    expect(rows[STOOQ_URL]).toMatchObject({
      title: `Daily prices, ${SYMBOL}`,
      text: '2020-01 | 10.2',
      meta: { symbol: SYMBOL },
    })
  })

  it.each([
    {
      facts: null,
      prices: null,
      xbrlFailure: 'no XBRL company facts',
      pricesFailure: 'no prices for the symbol',
    },
    {
      facts: { facts: {} },
      prices: 'Date,Open,High,Low,Close,Volume\n',
      xbrlFailure: 'no annual figures in the XBRL company facts',
      pricesFailure: 'no prices for the symbol',
    },
  ])(
    'records why figures could not be read: $xbrlFailure',
    async ({ facts, prices, xbrlFailure, pricesFailure }) => {
      const result = await gatherCorpus(recordingSteps(), input(), {
        db,
        sources: () =>
          companySources({
            cik: CIK,
            ticker: { symbol: 'GATHERTEST', exchange: 'Q13677' },
            over: {
              xbrl: { companyFacts: async () => facts },
              stooq: { daily: async () => prices },
            },
          }),
        mocked: false,
      })

      expect(result).toMatchObject({ read: [], failed: 2 })
      const failures = Object.fromEntries(
        (await findResearchDocumentsByUrl(db, [XBRL_URL, STOOQ_URL])).map((r) => [
          r.url,
          r.failure,
        ]),
      )
      expect(failures).toEqual({
        [XBRL_URL]: `could not fetch: ${xbrlFailure}`,
        [STOOQ_URL]: `could not fetch: ${pricesFailure}`,
      })
    },
  )
})
