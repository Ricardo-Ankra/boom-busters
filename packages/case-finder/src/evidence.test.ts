import { describe, expect, it, vi } from 'vitest'
import { gatherAt, type Sources } from './evidence'
import {
  mockCourtListener,
  mockEdgar,
  mockSecReleases,
  mockWikidata,
  mockYoutube,
} from './sources/mock'
import { dayRange, monthRange, type PageviewsSource } from './sources/pageviews'
import { QuotaExhaustedError } from './sources/quota'
import type { WikipediaSource } from './sources/wikipedia'
import type { YoutubeSource } from './sources/youtube'
import type { DatedTag, HitlistEntry, YoutubeVideo } from './types'

const NOW = () => new Date('2026-10-20T12:00:00Z')
const T = '2020-03-15'
const DOWNFALL: DatedTag = {
  tag: 'wikidata:dissolved-convicted',
  lane: 'downfall',
  since: '2019-01-01',
}
const silent = () => {}

function entry(qid: string, overrides: Partial<HitlistEntry> = {}): HitlistEntry {
  const enTitle = overrides.enTitle !== undefined ? overrides.enTitle : `Article ${qid}`
  return {
    qid,
    enTitle,
    query: enTitle,
    sitelinks: enTitle === null ? {} : { enwiki: enTitle },
    tags: [DOWNFALL],
    country: null,
    cik: null,
    ...overrides,
  }
}

/** Flat views per (project, title): 1000 a month (and 1000 a day) unless `levels` names the title. */
function flatPageviews(levels: Record<string, number> = {}): PageviewsSource {
  const level = (titles: string[]) => titles.reduce((sum, t) => sum + (levels[t] ?? 1000), 0)
  return {
    monthly: vi.fn(async (_project: string, titles: string[], from: string, to: string) =>
      monthRange(from, to).map((month) => ({ month, views: level(titles) })),
    ),
    daily: vi.fn(async (_project: string, titles: string[], from: string, to: string) =>
      dayRange(from, to).map((date) => ({ date, views: level(titles) })),
    ),
  }
}

/** Pages as they stood before T's month: categories, links and external links per title. */
function fakeWikipedia(
  pages: Record<string, { categories?: string[]; links?: string[]; externalLinks?: string[] }>,
) {
  const titles = Object.keys(pages)
  const source: WikipediaSource = {
    categoryMembers: vi.fn(async () => []),
    listLinks: vi.fn(async () => []),
    redirectsTo: vi.fn(async () => []),
    qidsFor: vi.fn(async () => new Map()),
    revisionBefore: vi.fn(async (title: string, day: string) => {
      const i = titles.indexOf(title)
      if (i < 0) return null
      const timestamp = new Date(Date.parse(`${day}T00:00:00Z`) - 3_600_000)
        .toISOString()
        .replace('.000Z', 'Z')
      return { revid: i + 1, timestamp }
    }),
    parsed: vi.fn(async (revid: number) => {
      const page = pages[titles[revid - 1]!]!
      return {
        categories: page.categories ?? [],
        externalLinks: page.externalLinks ?? [],
        links: page.links ?? [],
      }
    }),
  }
  return source
}

function sources(overrides: Partial<Sources> = {}): Sources {
  return {
    pageviews: flatPageviews(),
    wikidata: mockWikidata,
    wikipedia: fakeWikipedia({}),
    youtube: mockYoutube,
    courtlistener: mockCourtListener,
    edgar: mockEdgar,
    secReleases: mockSecReleases,
    ...overrides,
  }
}

const video = (id: string, channelId: string): YoutubeVideo => ({
  id,
  channelId,
  title: `[fake] ${id}`,
  publishedAt: '2019-06-01',
  durationSec: 900,
  views: 1000,
})

const gather = (hitlist: HitlistEntry[], s: Sources, asOf = T, log: (l: string) => void = silent) =>
  gatherAt(hitlist, asOf, s, log, { now: NOW })

const byQid = (evidence: Awaited<ReturnType<typeof gatherAt>>, qid: string) =>
  evidence.find((e) => e.entry.qid === qid)!

describe('gatherAt', () => {
  it('YouTube is searched only for the ranked population', async () => {
    const youtube = { ...mockYoutube, search: vi.fn(mockYoutube.search) }
    const s = sources({ youtube, pageviews: flatPageviews({ 'Article Q2': 10 }) })
    const hitlist = [
      entry('Q1'),
      entry('Q2'),
      entry('Q3', { tags: [{ tag: 'lopucki', lane: 'downfall', since: '2021-01-01' }] }),
    ]
    const evidence = await gather(hitlist, s)
    expect(youtube.search).toHaveBeenCalledTimes(1)
    expect(youtube.search).toHaveBeenCalledWith('Article Q1')
    expect(byQid(evidence, 'Q1').search).not.toBeNull()
    for (const qid of ['Q2', 'Q3']) {
      const e = byQid(evidence, qid)
      expect(e.search).toBeNull()
      expect(e.documents).toEqual([])
      expect(e.people).toEqual([])
      expect(e.enDaily).toEqual([])
      expect(e.worldMonthly).toEqual([])
    }
    expect(evidence.map((e) => e.entry.qid)).toEqual(['Q1', 'Q2', 'Q3'])
  })

  it("a category tag counts only if the revision before T's month has it", async () => {
    const wikipedia = fakeWikipedia({ 'Article Q1': { categories: ['Accounting scandals'] } })
    const hitlist = [
      entry('Q1', {
        tags: [
          { tag: 'category:Accounting scandals', lane: 'downfall', since: null },
          { tag: 'category:Ponzi schemes', lane: 'downfall', since: null },
        ],
      }),
      entry('Q2', {
        tags: [{ tag: 'category:Accounting scandals', lane: 'downfall', since: null }],
      }),
    ]
    const evidence = await gather(hitlist, sources({ wikipedia }))
    expect(wikipedia.revisionBefore).toHaveBeenCalledWith('Article Q1', '2020-03-01')
    expect(byQid(evidence, 'Q1').tagsAtT.map((t) => t.tag)).toEqual([
      'category:Accounting scandals',
    ])
    // Q2's article had no revision before the month, so its category tag is dropped.
    expect(byQid(evidence, 'Q2').tagsAtT).toEqual([])
  })

  it('a dated category tag also needs its date before T', async () => {
    const wikipedia = fakeWikipedia({
      'Article Q1': { categories: ['Companies that filed for Chapter 11 bankruptcy in 2020'] },
    })
    const tag: DatedTag = {
      tag: 'category:Companies that filed for Chapter 11 bankruptcy in 2020',
      lane: 'downfall',
      since: '2020-03-15',
    }
    const evidence = await gather([entry('Q1', { tags: [tag] })], sources({ wikipedia }))
    expect(byQid(evidence, 'Q1').tagsAtT).toEqual([])
  })

  it('a LoPucki tag filed after T is ignored', async () => {
    const hitlist = [
      entry('Q1', { tags: [{ tag: 'lopucki', lane: 'downfall', since: '2020-03-15' }] }),
      entry('Q2', { tags: [{ tag: 'lopucki', lane: 'downfall', since: '2020-03-14' }] }),
      entry('Q3', { tags: [{ tag: 'founder-link', lane: 'success', since: null }] }),
    ]
    const evidence = await gather(hitlist, sources())
    expect(byQid(evidence, 'Q1').tagsAtT).toEqual([])
    expect(byQid(evidence, 'Q2').tagsAtT.map((t) => t.tag)).toEqual(['lopucki'])
    expect(byQid(evidence, 'Q3').tagsAtT.map((t) => t.tag)).toEqual(['founder-link'])
  })

  it("a list tag counts only when the list page's revision before T's month links to the entry", async () => {
    const wikipedia = fakeWikipedia({
      'Article Q1': {},
      'Article Q2': {},
      'List of frauds': { links: ['Article_Q1', 'Something else'] },
    })
    const tag: DatedTag = { tag: 'list:List of frauds', lane: 'downfall', since: null }
    const hitlist = [entry('Q1', { tags: [tag] }), entry('Q2', { tags: [tag] })]
    const evidence = await gather(hitlist, sources({ wikipedia }))
    expect(byQid(evidence, 'Q1').tagsAtT).toEqual([tag])
    expect(byQid(evidence, 'Q2').tagsAtT).toEqual([])
    const listCalls = vi
      .mocked(wikipedia.revisionBefore)
      .mock.calls.filter(([title]) => title === 'List of frauds')
    expect(listCalls).toEqual([['List of frauds', '2020-03-01']])
  })

  it('one monthly fetch serves two different asOf dates', async () => {
    const inner = flatPageviews()
    // A stand-in for the disk cache: identical arguments are served without a fetch.
    const seen = new Map<string, ReturnType<PageviewsSource['monthly']>>()
    const pageviews: PageviewsSource = {
      monthly: (...args) => {
        const key = JSON.stringify(args)
        if (!seen.has(key)) seen.set(key, inner.monthly(...args))
        return seen.get(key)!
      },
      daily: inner.daily,
    }
    const hitlist = [entry('Q1')]
    const early = await gather(hitlist, sources({ pageviews }), '2019-06-10')
    const late = await gather(hitlist, sources({ pageviews }), '2020-03-15')
    expect(vi.mocked(inner.monthly).mock.calls[0]!.slice(2)).toEqual(['2015-07', '2026-09'])
    expect(
      vi.mocked(inner.monthly).mock.calls.filter(([project]) => project === 'en.wikipedia'),
    ).toHaveLength(1)
    expect(early[0]!.enMonthly.at(-1)!.month).toBe('2019-05')
    expect(late[0]!.enMonthly.at(-1)!.month).toBe('2020-02')
    expect(early[0]!.enMonthly[0]!.month).toBe('2015-07')
  })

  it('English series sum the title with its redirects', async () => {
    const pageviews = flatPageviews()
    const wikipedia = fakeWikipedia({ 'Article Q1': {} })
    vi.mocked(wikipedia.redirectsTo).mockResolvedValue(['Old Name'])
    await gather([entry('Q1')], sources({ pageviews, wikipedia }))
    expect(pageviews.monthly).toHaveBeenCalledWith(
      'en.wikipedia',
      ['Article Q1', 'Old Name'],
      '2015-07',
      '2026-09',
    )
    expect(pageviews.daily).toHaveBeenCalledWith(
      'en.wikipedia',
      ['Article Q1', 'Old Name'],
      '2015-07-01',
      '2026-10-19',
    )
  })

  it('worldMonthly is one summed row per month across two editions', async () => {
    const pageviews = flatPageviews({ Wirecard: 1000, Wirecard_yue: 500 })
    const hitlist = [
      entry('Q1', {
        sitelinks: { enwiki: 'Article Q1', dewiki: 'Wirecard', zh_yuewiki: 'Wirecard_yue' },
      }),
    ]
    const [e] = await gather(hitlist, sources({ pageviews }))
    expect(pageviews.monthly).toHaveBeenCalledWith(
      'de.wikipedia',
      ['Wirecard'],
      '2015-07',
      '2026-09',
    )
    expect(pageviews.monthly).toHaveBeenCalledWith(
      'zh-yue.wikipedia',
      ['Wirecard_yue'],
      '2015-07',
      '2026-09',
    )
    const months = e!.worldMonthly.map((m) => m.month)
    expect(new Set(months).size).toBe(months.length)
    expect(months).toEqual(monthRange('2015-07', '2020-02'))
    expect(e!.worldMonthly.every((m) => m.views === 1500)).toBe(true)
  })

  it('nothing in the returned evidence is dated on or after asOf', async () => {
    const courtlistener = { dockets: vi.fn(mockCourtListener.dockets) }
    const wikipedia = fakeWikipedia({
      'Article Q1': { externalLinks: ['https://www.sec.gov/litigation/q1.pdf'] },
    })
    const hitlist = [
      entry('Q1', { cik: '0000000001', sitelinks: { enwiki: 'Article Q1', dewiki: 'Q1 de' } }),
    ]
    const [e] = await gather(hitlist, sources({ courtlistener, wikipedia }))
    expect(courtlistener.dockets).toHaveBeenCalledWith('Article Q1', '2026-10-20')
    expect(e!.enMonthly.length).toBeGreaterThan(0)
    expect(e!.enMonthly.every((m) => m.month < '2020-03')).toBe(true)
    expect(e!.worldMonthly.every((m) => m.month < '2020-03')).toBe(true)
    expect(e!.enDaily.length).toBeGreaterThan(0)
    expect(e!.enDaily.every((d) => d.date < T)).toBe(true)
    expect(e!.documents.map((d) => d.source)).toContain('edgar')
    expect(e!.documents.map((d) => d.source)).toContain('wikipedia-reference')
    expect(e!.documents.every((d) => d.datedAt === null || d.datedAt < T)).toBe(true)
  })

  it('CourtListener dockets keep only those undated or dated before asOf', async () => {
    const courtlistener = {
      dockets: vi.fn(async () => [
        {
          url: 'https://x.invalid/1',
          title: 'a',
          source: 'courtlistener' as const,
          datedAt: '2020-03-14',
        },
        {
          url: 'https://x.invalid/2',
          title: 'b',
          source: 'courtlistener' as const,
          datedAt: '2020-03-15',
        },
        { url: 'https://x.invalid/3', title: 'c', source: 'courtlistener' as const, datedAt: null },
      ]),
    }
    const [e] = await gather([entry('Q1')], sources({ courtlistener }))
    expect(e!.documents.filter((d) => d.source === 'courtlistener').map((d) => d.url)).toEqual([
      'https://x.invalid/1',
      'https://x.invalid/3',
    ])
  })

  it('a channel appearing in two entries results is fetched once', async () => {
    const youtube: YoutubeSource = {
      ...mockYoutube,
      search: vi.fn(async (query: string) => ({
        fetchedAt: '2026-10-20',
        videos: [video(`${query}-1`, 'UCshared'), video(`${query}-2`, `UCown${query.length}`)],
      })),
      uploads: vi.fn(async (channelId: string) => ({ channelId, uploads: [] })),
    }
    const evidence = await gather([entry('Q1'), entry('Q22')], sources({ youtube }))
    const shared = vi.mocked(youtube.uploads).mock.calls.filter(([id]) => id === 'UCshared')
    expect(shared).toEqual([['UCshared', 'UUshared', { maxPages: 1 }]])
    expect(youtube.uploads).toHaveBeenCalledTimes(3)
    for (const e of evidence) expect(Object.keys(e.channels)).toContain('UCshared')
  })

  it('an entry below the floor gets no revision call and keeps only its dated plain tags', async () => {
    const wikipedia = fakeWikipedia({ 'Article Q1': { categories: ['Ponzi schemes'] } })
    const hitlist = [
      entry('Q1', {
        tags: [
          { tag: 'category:Ponzi schemes', lane: 'downfall', since: null },
          { tag: 'list:List of frauds', lane: 'downfall', since: null },
          { tag: 'lopucki', lane: 'downfall', since: '2019-02-01' },
          { tag: 'wikidata:dissolved-convicted', lane: 'downfall', since: '2021-01-01' },
        ],
      }),
    ]
    const s = sources({ wikipedia, pageviews: flatPageviews({ 'Article Q1': 299 }) })
    const [e] = await gather(hitlist, s)
    expect(wikipedia.revisionBefore).not.toHaveBeenCalled()
    expect(wikipedia.parsed).not.toHaveBeenCalled()
    expect(e!.tagsAtT.map((t) => t.tag)).toEqual(['lopucki'])
  })

  it('a population entry with no query gets an empty search, never null', async () => {
    const youtube = { ...mockYoutube, search: vi.fn(mockYoutube.search) }
    const [e] = await gather([entry('Q1', { query: '  ' })], sources({ youtube }))
    expect(youtube.search).not.toHaveBeenCalled()
    expect(e!.search).toEqual({ fetchedAt: '2026-10-20', videos: [] })
  })

  it('people come from one Wikidata facts call over the population', async () => {
    const wikidata = { ...mockWikidata, facts: vi.fn(mockWikidata.facts) }
    const hitlist = [entry('Q1'), entry('Q2'), entry('Q3', { tags: [] })]
    const evidence = await gather(hitlist, sources({ wikidata }))
    expect(wikidata.facts).toHaveBeenCalledTimes(1)
    expect(wikidata.facts).toHaveBeenCalledWith(['Q1', 'Q2'])
    expect(byQid(evidence, 'Q1').people[0]!.name).toBe('Mock founder of Q1')
  })

  it('QuotaExhaustedError propagates', async () => {
    const youtube: YoutubeSource = {
      ...mockYoutube,
      search: async () => {
        throw new QuotaExhaustedError('out of units')
      },
    }
    await expect(gather([entry('Q1')], sources({ youtube }))).rejects.toBeInstanceOf(
      QuotaExhaustedError,
    )
  })

  it('logs a summary with the population per lane, searches and channels', async () => {
    const lines: string[] = []
    const hitlist = [
      entry('Q1'),
      entry('Q2', { tags: [{ tag: 'founder-link', lane: 'success', since: null }] }),
    ]
    await gather(hitlist, sources(), T, (l) => lines.push(l))
    expect(lines.at(-1)).toBe(
      'evidence 2020-03-15: 2 entries; population downfall=1, success=1; ' +
        '2 YouTube searches; 6 channels fetched',
    )
  })
})
