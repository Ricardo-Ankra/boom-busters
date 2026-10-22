// @vitest-environment node

import type { EntityFacts } from '@boom-busters/case-finder'
import { describe, expect, it, vi } from 'vitest'
import type { ResearchSources } from '@/lib/research-sources'
import { fakeSources as sharedFakeSources, unexpected } from '@/test/fake-research-sources'
import {
  discoverCandidates,
  EMPTY_ENTITY,
  REFERENCE_CAPS,
  resolveEntity,
  type ResolvedEntity,
} from './dossier-discover'

/**
 * Discovery against plain fake sources: no network, no database.
 */

/** Discovery reads every article's references and the docket search; by default both find nothing. */
function fakeSources(over: Partial<ResearchSources> = {}): ResearchSources {
  const base = sharedFakeSources()
  return sharedFakeSources({
    wikipedia: {
      ...base.wikipedia,
      currentItems: async () => ({ categories: [], externalLinks: [], links: [] }),
    },
    courtlistener: { dockets: async () => [] },
    ...over,
  })
}

function facts(qid: string, over: Partial<EntityFacts> = {}): EntityFacts {
  return {
    qid,
    enTitle: null,
    sitelinks: {},
    country: null,
    cik: null,
    dissolved: null,
    instanceOf: [],
    isClass: false,
    ticker: null,
    website: null,
    inception: null,
    people: [],
    ...over,
  }
}

function entity(over: Partial<ResolvedEntity> = {}): ResolvedEntity {
  return { ...EMPTY_ENTITY, qid: 'Q1', titles: ['Mockco'], businessTitle: 'Mockco', ...over }
}

describe('resolveEntity', () => {
  it('prefers the business item among the search hits and takes references from the scandal article too', async () => {
    const hits = [
      'Wirecard scandal',
      'Wirecard',
      'Markus Braun',
      'Wirecard bankruptcy',
      'Wirecard affair',
    ]
    const qids = new Map(hits.map((title, i) => [title, `Q${i + 1}`]))
    const currentItems = vi.fn(async (title: string) => ({
      categories: [],
      externalLinks: [`https://news.example.org/${encodeURIComponent(title)}`],
      links: [],
    }))
    const sources = fakeSources({
      wikipedia: {
        ...fakeSources().wikipedia,
        search: async (_query, limit) =>
          hits.slice(0, limit).map((title, i) => ({ title, pageid: i })),
        qidsFor: async () => qids,
        currentItems,
      },
      wikidata: {
        sparql: unexpected('sparql'),
        facts: async () =>
          new Map([
            ['Q1', facts('Q1', { instanceOf: ['Q16510064'] })],
            [
              'Q2',
              facts('Q2', {
                instanceOf: ['Q891723'],
                ticker: { symbol: 'WDI', exchange: 'Q2385849' },
                website: 'https://www.wirecard.com',
                inception: '1999-01-01',
                dissolved: '2020-11-18',
              }),
            ],
            ['Q3', facts('Q3', { instanceOf: ['Q5'] })],
          ]),
      },
    })

    const resolved = await resolveEntity(sources, 'Wirecard: The Billions That Never Were')

    expect(resolved).toMatchObject({
      qid: 'Q2',
      businessTitle: 'Wirecard',
      relatedTitles: ['Wirecard scandal', 'Wirecard bankruptcy'],
      titles: ['Wirecard', 'Wirecard scandal', 'Wirecard bankruptcy'],
      ticker: 'WDI',
      exchange: 'Q2385849',
      website: 'https://www.wirecard.com',
      inception: '1999-01-01',
      dissolved: '2020-11-18',
    })

    const candidates = await discoverCandidates(sources, resolved, {
      competitorLinks: [],
      caseTitle: 'Wirecard',
    })
    expect(currentItems.mock.calls.map(([title]) => title)).toEqual([
      'Wirecard',
      'Wirecard scandal',
      'Wirecard bankruptcy',
    ])
    expect(candidates.map((c) => c.url)).toContain('https://news.example.org/Wirecard%20scandal')
  })

  it('falls back to the first hit when no hit is a business', async () => {
    const sources = fakeSources({
      wikipedia: {
        ...fakeSources().wikipedia,
        search: async () => [{ title: 'Some fraud', pageid: 1 }],
        qidsFor: async () => new Map([['Some fraud', 'Q9']]),
      },
      wikidata: { sparql: unexpected('sparql'), facts: async () => new Map([['Q9', facts('Q9')]]) },
    })

    const resolved = await resolveEntity(sources, 'Some fraud')

    expect(resolved).toMatchObject({ qid: 'Q9', businessTitle: 'Some fraud', relatedTitles: [] })
  })
})

describe('discoverCandidates', () => {
  it('files candidates by tier and keeps a duplicate url once at its first tier', async () => {
    const exhibit = 'https://www.sec.gov/Archives/edgar/data/1/0001/ex99-1.htm'
    const captures = vi.fn(async () => [
      {
        timestamp: '20190301000000',
        url: 'https://web.archive.org/web/20190301000000/https://www.mockco.com/',
      },
    ])
    const sources = fakeSources({
      edgar: {
        filings: unexpected('filings'),
        exhibits: async () => [
          {
            url: exhibit,
            title: '8-K exhibit 99.1 filed 2019-05-01',
            source: 'edgar',
            datedAt: '2019-05-01',
          },
        ],
        latestFiling: async () => ({
          url: 'https://www.sec.gov/Archives/edgar/data/1/0002/10k.htm',
          title: '10-K filed 2020-03-01',
          source: 'edgar',
          datedAt: '2020-03-01',
        }),
      },
      wayback: { captures },
      wikipedia: {
        ...fakeSources().wikipedia,
        currentItems: async () => ({
          categories: [],
          externalLinks: [
            'https://www.mockco.com/press/2019?utm_source=wiki',
            'https://www.ft.com/content/mockco',
            'https://www.sec.gov/litigation/mockco',
            'https://www.courtlistener.com/opinion/1/mockco/',
            'https://www.ft.com/content/mockco#comments',
            exhibit,
            'https://web.archive.org/web/2019/https://www.ft.com/content/mockco',
          ],
          links: [],
        }),
      },
      youtube: {
        search: async () => ({
          fetchedAt: '2026-10-22',
          videos: [
            {
              id: 'vid1',
              channelId: 'UC1',
              title: 'Mockco explained',
              publishedAt: '2021-01-01',
              durationSec: 600,
              views: 10,
            },
          ],
        }),
        channelByHandle: unexpected('channelByHandle'),
        uploads: unexpected('uploads'),
        details: unexpected('details'),
      },
      courtlistener: {
        dockets: async () => [
          {
            url: 'https://www.courtlistener.com/docket/9/mockco/',
            title: 'In re Mockco',
            source: 'courtlistener',
            datedAt: '2021-02-01',
          },
        ],
      },
    })

    const candidates = await discoverCandidates(
      sources,
      entity({
        cik: '0000001',
        website: 'https://www.mockco.com',
        ticker: 'MOCK',
        exchange: 'Q13677',
        inception: '2005-03-01',
        dissolved: '2020-06-25',
      }),
      { competitorLinks: [], caseTitle: 'Mockco' },
    )

    expect(candidates.map((c) => [c.kind, c.tier])).toEqual([
      ['filing', 1],
      ['filing', 1],
      ['web-archive', 1],
      ['press-release', 1],
      ['reporting', 2],
      ['video', 3],
      ['figures', 4],
      ['figures', 4],
      ['regulator', 5],
      ['court', 5],
      ['court', 5],
    ])
    expect(captures).toHaveBeenCalledWith('https://www.mockco.com', {
      from: '2005',
      to: '20200625',
      limit: -6,
    })
    expect(candidates.filter((c) => c.url === exhibit)).toEqual([
      expect.objectContaining({ kind: 'filing', publishedAt: '2019-05-01' }),
    ])
    expect(candidates.filter((c) => c.url.startsWith('https://www.ft.com/'))).toHaveLength(1)
    expect(candidates.find((c) => c.kind === 'press-release')?.url).toBe(
      'https://www.mockco.com/press/2019',
    )
    expect(candidates.find((c) => c.kind === 'video')).toMatchObject({
      url: 'https://www.youtube.com/watch?v=vid1',
      title: 'Mockco explained',
      meta: { videoId: 'vid1' },
    })
    expect(candidates.filter((c) => c.kind === 'figures').map((c) => c.meta)).toEqual([
      { cik: '0000001' },
      { symbol: 'mock.us' },
    ])
  })

  it('turns a competitor link into a video candidate and ignores a non-video link', async () => {
    const candidates = await discoverCandidates(fakeSources(), entity(), {
      competitorLinks: [
        { url: 'https://youtu.be/abc123' },
        { url: 'https://www.example.com/an-article' },
      ],
      caseTitle: 'Mockco',
    })

    expect(candidates).toEqual([
      {
        url: 'https://www.youtube.com/watch?v=abc123',
        kind: 'video',
        tier: 3,
        title: null,
        publishedAt: null,
        meta: { videoId: 'abc123' },
      },
    ])
  })

  it('keeps every other source when one throws', async () => {
    const sources = fakeSources({
      edgar: {
        filings: unexpected('filings'),
        exhibits: async () => {
          throw new Error('GET index.json failed with status 503')
        },
        latestFiling: async () => ({
          url: 'https://www.sec.gov/Archives/edgar/data/1/0002/10k.htm',
          title: '10-K filed 2020-03-01',
          source: 'edgar',
          datedAt: '2020-03-01',
        }),
      },
      wayback: {
        captures: async () => {
          throw new Error('GET cdx failed with status 503')
        },
      },
      xbrl: { companyFacts: unexpected('companyFacts') },
    })

    const candidates = await discoverCandidates(
      sources,
      entity({ cik: '1', website: 'https://www.mockco.com' }),
      { competitorLinks: [], caseTitle: 'Mockco' },
    )

    expect(candidates.map((c) => c.kind)).toEqual(['filing', 'figures'])
  })

  it('cuts a reference list over the caps, in page order', async () => {
    const many = (n: number, at: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => at(i))
    const externalLinks = [
      ...many(25, (i) => `https://www.mockco.com/press/${i}`),
      ...many(70, (i) => `https://news.example.org/story/${i}`),
      ...many(35, (i) => `https://www.sec.gov/litigation/${i}`),
    ]
    const base = fakeSources()
    const sources = fakeSources({
      wikipedia: {
        ...base.wikipedia,
        currentItems: async () => ({ categories: [], externalLinks, links: [] }),
      },
    })

    const candidates = await discoverCandidates(
      sources,
      entity({ website: 'https://www.mockco.com' }),
      { competitorLinks: [], caseTitle: 'Mockco' },
    )

    const urlsOf = (kind: string) => candidates.filter((c) => c.kind === kind).map((c) => c.url)
    expect(urlsOf('press-release')).toEqual(
      many(REFERENCE_CAPS.pressRelease, (i) => `https://www.mockco.com/press/${i}`),
    )
    expect(urlsOf('reporting')).toEqual(
      many(REFERENCE_CAPS.reporting, (i) => `https://news.example.org/story/${i}`),
    )
    expect(urlsOf('regulator')).toEqual(
      many(REFERENCE_CAPS.primary, (i) => `https://www.sec.gov/litigation/${i}`),
    )
  })
})
