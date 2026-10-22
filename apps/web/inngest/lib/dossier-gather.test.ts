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
import type { FetchedDocument } from '@boom-busters/providers'
import { mockCorpusDocuments } from '@boom-busters/providers'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchSources } from '@/lib/research-sources'
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

function unexpected(name: string) {
  return () => {
    throw new Error(`unexpected call to ${name}`)
  }
}

/** Every source throws unless a test sets it, so "calls no source" is checked by construction. */
function fakeSources(over: Partial<ResearchSources> = {}): ResearchSources {
  return {
    wikipedia: {
      categoryMembers: unexpected('categoryMembers'),
      listLinks: unexpected('listLinks'),
      redirectsTo: unexpected('redirectsTo'),
      formerTitles: unexpected('formerTitles'),
      qidsFor: unexpected('qidsFor'),
      revisionBefore: unexpected('revisionBefore'),
      parsed: unexpected('parsed'),
      search: unexpected('search'),
      currentItems: unexpected('currentItems'),
    },
    wikidata: { sparql: unexpected('sparql'), facts: unexpected('facts') },
    edgar: {
      filings: unexpected('filings'),
      exhibits: unexpected('exhibits'),
      latestFiling: unexpected('latestFiling'),
    },
    courtlistener: { dockets: unexpected('dockets') },
    youtube: null,
    transcripts: null,
    stooq: { daily: unexpected('daily') },
    wayback: { captures: unexpected('captures') },
    xbrl: { companyFacts: unexpected('companyFacts') },
    fetchDocument: unexpected('fetchDocument'),
    ...over,
  }
}

/** A company with no CIK, ticker or website: its only documents are its article's references. */
function referenceSources(
  links: string[],
  fetchDocument: ResearchSources['fetchDocument'],
): ResearchSources {
  const base = fakeSources()
  return fakeSources({
    wikipedia: {
      ...base.wikipedia,
      search: async () => [{ title: 'Gathertest Co', pageid: 1 }],
      qidsFor: async () => new Map([['Gathertest Co', 'Q4242']]),
      currentItems: async () => ({ categories: [], externalLinks: links, links: [] }),
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
              cik: null,
              dissolved: '2020-06-25',
              instanceOf: ['Q4830453'],
              isClass: false,
              ticker: null,
              website: null,
              inception: null,
              people: [],
            },
          ],
        ]),
    },
    courtlistener: { dockets: async () => [] },
    fetchDocument,
  })
}

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
    await sql`delete from research_documents where url like ${`${HOST}/%`}`
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
      sources: referenceSources(links, fetchDocument),
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
      sources: referenceSources([fresh, stale], fetchDocument),
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
      sources: referenceSources([missing, broken, good], fetchDocument),
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
      httpStatus: 404,
      text: '',
      tokens: 0,
    })
  })

  it('in mock mode stores the four mock documents and calls no source', async () => {
    const steps = recordingSteps()

    const result = await gatherCorpus(steps, input(2), {
      db,
      sources: fakeSources({ courtlistener: { dockets: unexpected('dockets') } }),
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
})
