// @vitest-environment node

import type { EntityFacts } from '@boom-busters/case-finder'
import { PERSON_REFERENCE_CAP } from '@boom-busters/schemas'
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
  it('prefers the business item among the subject hits and takes references from the scandal article too', async () => {
    const hits = [
      'Wirecard scandal',
      'Wirecard',
      'Markus Braun',
      'Wirecard bankruptcy',
      'Wirecard affair',
    ]
    const qids = new Map(hits.map((title, i) => [title, `Q${i + 1}`]))
    const search = vi.fn(async (_query: string, limit: number) =>
      hits.slice(0, limit).map((title, i) => ({ title, pageid: i })),
    )
    const currentItems = vi.fn(async (title: string) => ({
      categories: [],
      externalLinks: [`https://news.example.org/${encodeURIComponent(title)}`],
      links: [],
    }))
    const sources = fakeSources({
      wikipedia: {
        ...fakeSources().wikipedia,
        search,
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

    const resolved = await resolveEntity(sources, { subject: 'Wirecard', people: [] })

    expect(search).toHaveBeenCalledWith('Wirecard', 5)
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
      subject: 'Wirecard',
      unresolved: false,
      people: [],
    })

    const candidates = await discoverCandidates(sources, resolved, {
      competitorLinks: [],
      sourceLinks: [],
      subject: 'Wirecard',
    })
    expect(currentItems.mock.calls.map(([title]) => title)).toEqual([
      'Wirecard',
      'Wirecard scandal',
      'Wirecard bankruptcy',
    ])
    expect(candidates.map((c) => c.url)).toContain('https://news.example.org/Wirecard%20scandal')
  })

  it('marks an editorial headline with no business among its hits unresolved and takes no company references', async () => {
    const subject = 'Theranos on the Record: Why the Jury Convicted Elizabeth Holmes'
    const currentItems = vi.fn(async () => ({
      categories: [],
      externalLinks: ['https://news.example.org/2022'],
      links: [],
    }))
    const youtubeSearch = vi.fn(async () => ({ fetchedAt: '2026-10-23', videos: [] }))
    const sources = fakeSources({
      wikipedia: {
        ...fakeSources().wikipedia,
        search: async () => [
          { title: '2022 in the United States', pageid: 1 },
          { title: 'Theranos fraud trial', pageid: 2 },
        ],
        qidsFor: async () =>
          new Map([
            ['2022 in the United States', 'Q9'],
            ['Theranos fraud trial', 'Q10'],
          ]),
        currentItems,
      },
      wikidata: {
        sparql: unexpected('sparql'),
        facts: async () =>
          new Map([
            ['Q9', facts('Q9', { instanceOf: ['Q14795564'] })],
            ['Q10', facts('Q10', { instanceOf: ['Q1456832'] })],
          ]),
      },
      youtube: {
        search: youtubeSearch,
        channelByHandle: unexpected('channelByHandle'),
        uploads: unexpected('uploads'),
        details: unexpected('details'),
      },
    })

    const resolved = await resolveEntity(sources, { subject, people: [] })

    expect(resolved).toMatchObject({
      qid: null,
      titles: [],
      businessTitle: null,
      cik: null,
      ticker: null,
      website: null,
      unresolved: true,
      subject,
      relatedTitles: ['Theranos fraud trial'],
    })

    const candidates = await discoverCandidates(sources, resolved, {
      competitorLinks: [],
      sourceLinks: [],
      subject,
    })
    expect(currentItems).not.toHaveBeenCalled()
    expect(candidates).toEqual([])
    expect(youtubeSearch).toHaveBeenCalledWith(subject)
  })

  it('resolves each person to the first human among their top three hits', async () => {
    const search = vi.fn(async (query: string, limit: number) => {
      const byQuery: Record<string, string[]> = {
        Theranos: ['Theranos'],
        'Elizabeth Holmes': [
          'Elizabeth Holmes (disambiguation)',
          'Elizabeth Holmes',
          'The Dropout',
          'Elizabeth Holmes (character)',
        ],
        'Sunny Balwani': ['Sunny (film)'],
      }
      return (byQuery[query] ?? []).slice(0, limit).map((title, i) => ({ title, pageid: i }))
    })
    const qids = new Map([
      ['Theranos', 'Q1'],
      ['Elizabeth Holmes (disambiguation)', 'Q2'],
      ['Elizabeth Holmes', 'Q3'],
      ['The Dropout', 'Q4'],
      ['Elizabeth Holmes (character)', 'Q5x'],
      ['Sunny (film)', 'Q6'],
    ])
    const sources = fakeSources({
      wikipedia: {
        ...fakeSources().wikipedia,
        search,
        qidsFor: async (titles) =>
          new Map(titles.flatMap((t) => (qids.has(t) ? [[t, qids.get(t)!]] : []))),
      },
      wikidata: {
        sparql: unexpected('sparql'),
        facts: async () =>
          new Map([
            ['Q1', facts('Q1', { instanceOf: ['Q4830453'] })],
            ['Q2', facts('Q2', { instanceOf: ['Q4167410'] })],
            ['Q3', facts('Q3', { instanceOf: ['Q5'] })],
            ['Q4', facts('Q4', { instanceOf: ['Q5398426'] })],
            ['Q5x', facts('Q5x', { instanceOf: ['Q5'] })],
            ['Q6', facts('Q6', { instanceOf: ['Q11424'] })],
          ]),
      },
    })

    const resolved = await resolveEntity(sources, {
      subject: 'Theranos',
      people: ['Elizabeth Holmes', 'Sunny Balwani'],
    })

    expect(search).toHaveBeenCalledWith('Elizabeth Holmes', 3)
    expect(search).toHaveBeenCalledWith('Sunny Balwani', 3)
    expect(resolved.people).toEqual([
      { name: 'Elizabeth Holmes', qid: 'Q3', title: 'Elizabeth Holmes' },
      { name: 'Sunny Balwani', qid: null, title: null },
    ])
    expect(resolved).toMatchObject({ qid: 'Q1', businessTitle: 'Theranos', unresolved: false })
  })

  it('records the people of a subject with no company article', async () => {
    const sources = fakeSources({
      wikipedia: {
        ...fakeSources().wikipedia,
        search: async (query) =>
          query === 'Ada Founder'
            ? [{ title: 'Ada Founder', pageid: 1 }]
            : [{ title: 'Startup (film)', pageid: 2 }],
        qidsFor: async () =>
          new Map([
            ['Ada Founder', 'Q7'],
            ['Startup (film)', 'Q8'],
          ]),
      },
      wikidata: {
        sparql: unexpected('sparql'),
        facts: async () =>
          new Map([
            ['Q7', facts('Q7', { instanceOf: ['Q5'] })],
            ['Q8', facts('Q8', { instanceOf: ['Q11424'] })],
          ]),
      },
    })

    const resolved = await resolveEntity(sources, { subject: 'Adaco', people: ['Ada Founder'] })

    expect(resolved).toMatchObject({
      unresolved: true,
      titles: [],
      qid: null,
      subject: 'Adaco',
      people: [{ name: 'Ada Founder', qid: 'Q7', title: 'Ada Founder' }],
    })
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
      { competitorLinks: [], sourceLinks: [], subject: 'Mockco' },
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
      sourceLinks: [],
      subject: 'Mockco',
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
      { competitorLinks: [], sourceLinks: [], subject: 'Mockco' },
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
      { competitorLinks: [], sourceLinks: [], subject: 'Mockco' },
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

  it('takes each resolved person article references, twenty a person, the record among them at tier 5', async () => {
    const many = (n: number, at: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => at(i))
    const holmesLinks = [
      'https://www.justice.gov/usao-ndca/pr/holmes-sentenced',
      'https://news.example.org/company-story',
      ...many(30, (i) => `https://news.example.org/holmes/${i}`),
    ]
    const currentItems = vi.fn(async (title: string) => ({
      categories: [],
      externalLinks:
        title === 'Elizabeth Holmes'
          ? holmesLinks
          : ['https://news.example.org/company-story', 'https://www.sec.gov/litigation/theranos'],
      links: [],
    }))
    const sources = fakeSources({
      wikipedia: { ...fakeSources().wikipedia, currentItems },
    })

    const candidates = await discoverCandidates(
      sources,
      entity({
        titles: ['Theranos'],
        businessTitle: 'Theranos',
        people: [
          { name: 'Elizabeth Holmes', qid: 'Q3', title: 'Elizabeth Holmes' },
          { name: 'Sunny Balwani', qid: null, title: null },
        ],
      }),
      { competitorLinks: [], sourceLinks: [], subject: 'Theranos' },
    )

    expect(currentItems.mock.calls.map(([title]) => title)).toEqual([
      'Theranos',
      'Elizabeth Holmes',
    ])
    const holmes = candidates.filter((c) => c.url.includes('holmes'))
    // The shared company story is the company's, so twenty of Holmes's own: one record, nineteen stories.
    expect(holmes).toHaveLength(PERSON_REFERENCE_CAP)
    expect(holmes.filter((c) => c.kind === 'reporting' && c.tier === 2)).toHaveLength(19)
    expect(candidates.find((c) => c.url.includes('holmes-sentenced'))).toMatchObject({
      kind: 'regulator',
      tier: 5,
    })
    expect(
      candidates.filter((c) => c.url === 'https://news.example.org/company-story'),
    ).toHaveLength(1)
    expect(candidates.map((c) => c.tier)).toEqual([...candidates.map((c) => c.tier)].sort())
  })

  it('puts the owner sources first at tier 1, pinned, outside the reference caps', async () => {
    const many = (n: number, at: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => at(i))
    const owned = [
      'https://longreads.example.org/the-whole-story?utm_source=x',
      'https://news.example.org/story/0',
      'https://podcasts.example.org/episode-9',
    ]
    const sources = fakeSources({
      wikipedia: {
        ...fakeSources().wikipedia,
        currentItems: async () => ({
          categories: [],
          externalLinks: many(70, (i) => `https://news.example.org/story/${i}`),
          links: [],
        }),
      },
    })

    const candidates = await discoverCandidates(sources, entity(), {
      competitorLinks: [],
      sourceLinks: owned.map((url) => ({ url })),
      subject: 'Mockco',
    })

    expect(candidates.slice(0, 3)).toEqual([
      {
        url: 'https://longreads.example.org/the-whole-story',
        kind: 'reporting',
        tier: 1,
        title: null,
        publishedAt: null,
        meta: { pinned: true },
      },
      expect.objectContaining({ url: 'https://news.example.org/story/0', tier: 1 }),
      expect.objectContaining({ url: 'https://podcasts.example.org/episode-9', tier: 1 }),
    ])
    const reporting = candidates.filter((c) => c.tier === 2)
    expect(reporting).toHaveLength(REFERENCE_CAPS.reporting)
    expect(reporting[0]?.url).toBe('https://news.example.org/story/1')
  })
})
