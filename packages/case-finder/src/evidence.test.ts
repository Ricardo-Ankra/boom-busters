import { describe, expect, it, vi } from 'vitest'
import { gatherAt } from './evidence'
import {
  T,
  byQid,
  entry,
  fakeWikipedia,
  flatPageviews,
  gather,
  silent,
  sources,
  video,
} from './gather/fixtures'
import { mockCourtListener, mockWikidata, mockYoutube } from './sources/mock'
import { monthRange, type PageviewsSource } from './sources/pageviews'
import { QuotaExhaustedError } from './sources/quota'
import { YoutubeNotFoundError, type YoutubeSource } from './sources/youtube'
import { channelMemo } from './gather/channels'
import { minusDays } from './dates'

/** A channel's whole history, empty: enough for gathering, which only reads whether it came back. */
const completeUploads = async (channelId: string) => ({
  channelId,
  uploads: [],
  fetchedOn: '2026-10-20',
  complete: true,
})

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

  it('an SEC release dated on or after asOf never reaches documents', async () => {
    const release = (number: string, date: string) => ({
      kind: 'sec-litigation' as const,
      number,
      date,
      title: `SEC v. Article Q1 and others`,
      url: `https://www.sec.gov/litigation/${number}`,
    })
    const secReleases = {
      index: async () => [
        release('LR-1', '2020-03-14'),
        release('LR-2', '2020-03-15'),
        release('LR-3', '2021-01-01'),
      ],
    }
    const [e] = await gather([entry('Q1')], sources({ secReleases }))
    const sec = e!.documents.filter((d) => d.source === 'sec-litigation')
    expect(sec.map((d) => d.url)).toEqual(['https://www.sec.gov/litigation/LR-1'])
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

  it('English series sum the title with its former titles only', async () => {
    const pageviews = flatPageviews()
    const wikipedia = fakeWikipedia({ 'Article Q1': {} })
    vi.mocked(wikipedia.redirectsTo).mockResolvedValue(['Old Name', 'Nickname'])
    vi.mocked(wikipedia.formerTitles).mockResolvedValue(['Old Name'])
    await gather([entry('Q1')], sources({ pageviews, wikipedia }))
    expect(wikipedia.formerTitles).toHaveBeenCalledWith('Article Q1', ['Old Name', 'Nickname'])
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

  it('series ends and the CourtListener cut-off follow the anchor day, not the clock', async () => {
    const pageviews = flatPageviews()
    const courtlistener = { dockets: vi.fn(mockCourtListener.dockets) }
    await gatherAt([entry('Q1')], T, sources({ pageviews, courtlistener }), silent, {
      anchorDay: '2026-03-05',
    })
    const ends = (fn: typeof pageviews.monthly | typeof pageviews.daily) =>
      vi.mocked(fn).mock.calls.map((c) => c[3])
    expect(new Set(ends(pageviews.monthly))).toEqual(new Set(['2026-02']))
    expect(ends(pageviews.daily)).toEqual(['2026-03-04'])
    expect(courtlistener.dockets).toHaveBeenCalledWith('Article Q1', '2026-03-05')
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
      uploads: vi.fn(completeUploads),
    }
    const evidence = await gather([entry('Q1'), entry('Q22')], sources({ youtube }))
    const shared = vi.mocked(youtube.uploads).mock.calls.filter(([id]) => id === 'UCshared')
    expect(shared).toEqual([['UCshared', 'UUshared', { until: '2018-12-01', maxPages: 20 }]])
    expect(youtube.uploads).toHaveBeenCalledTimes(3)
    for (const e of evidence) expect(Object.keys(e.channels)).toContain('UCshared')
  })

  it('fetches uploads only for channels with a video that counts towards coverage', async () => {
    const search = async () => ({
      fetchedAt: '2026-10-20',
      videos: [
        video('counted', 'UCcounted', { title: 'Inside Article Q1' }),
        video('short', 'UCshort', { title: 'Article Q1 in a minute', durationSec: 60 }),
        video('late', 'UClate', { title: 'Article Q1 today', publishedAt: T }),
        video('old', 'UCold', { title: 'Article Q1 back then', publishedAt: '2018-03-14' }),
        video('other', 'UCother', { title: 'Something else entirely' }),
      ],
    })
    const uploads = vi.fn(completeUploads)
    const [e] = await gather(
      [entry('Q1')],
      sources({ youtube: { ...mockYoutube, search, uploads } }),
    )
    expect(uploads.mock.calls.map(([id]) => id)).toEqual(['UCcounted'])
    expect(Object.keys(e!.channels)).toEqual(['UCcounted'])
  })

  it("asks back to the window start of the channel's oldest counted video", async () => {
    const search = async () => ({
      fetchedAt: '2026-10-20',
      videos: [
        video('newer', 'UCx', { title: 'Article Q1 part 2', publishedAt: '2019-08-31' }),
        video('older', 'UCx', { title: 'Article Q1 part 1', publishedAt: '2018-08-31' }),
      ],
    })
    const uploads = vi.fn(completeUploads)
    await gather([entry('Q1')], sources({ youtube: { ...mockYoutube, search, uploads } }))
    expect(uploads.mock.calls).toEqual([['UCx', 'UUx', { until: '2018-02-28', maxPages: 20 }]])
  })

  it('a later back-test date that needs older history deepens the shared memo', async () => {
    const search = async () => ({
      fetchedAt: '2026-10-20',
      videos: [
        video('recent', 'UCx', { title: 'Article Q1 now', publishedAt: '2019-06-01' }),
        video('early', 'UCx', { title: 'Article Q1 then', publishedAt: '2018-01-01' }),
      ],
    })
    // Each fetch stops on the first upload strictly older than asked: the day before.
    const uploads = vi.fn(
      async (channelId: string, _p: string, options: { until?: string } = {}) => ({
        channelId,
        uploads: [video('reached', channelId, { publishedAt: minusDays(options.until!, 1) })],
        fetchedOn: '2026-10-20',
        complete: false,
      }),
    )
    const youtube = { ...mockYoutube, search, uploads }
    const channels = channelMemo(youtube)
    // At T only 'recent' counts; a year earlier only 'early' does.
    await gather([entry('Q1')], sources({ youtube }), T, silent, { channels })
    await gather([entry('Q1')], sources({ youtube }), '2019-03-15', silent, { channels })
    await gather([entry('Q1')], sources({ youtube }), T, silent, { channels })
    expect(uploads.mock.calls.map((c) => c[2])).toEqual([
      { until: '2018-12-01', maxPages: 20 },
      { until: '2017-07-01', maxPages: 20 },
    ])
  })

  it('a channel whose uploads playlist is not found is left out; any other error throws', async () => {
    const search = async () => ({
      fetchedAt: '2026-10-20',
      videos: [
        video('v1', 'UCgone', { title: 'Article Q1 explained' }),
        video('v2', 'UCkept', { title: 'Article Q1 explained again' }),
      ],
    })
    const uploads = vi.fn(async (channelId: string) => {
      if (channelId === 'UCgone') throw new YoutubeNotFoundError('playlist UUgone not found')
      return completeUploads(channelId)
    })
    const [e] = await gather(
      [entry('Q1')],
      sources({ youtube: { ...mockYoutube, search, uploads } }),
    )
    expect(Object.keys(e!.channels)).toEqual(['UCkept'])

    const broken = vi.fn(async () => {
      throw new Error('GET playlistItems failed with status 500')
    })
    await expect(
      gather([entry('Q1')], sources({ youtube: { ...mockYoutube, search, uploads: broken } })),
    ).rejects.toThrow(/500/)
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
    // Each search has a counted video on a shared channel and its own, and one that does not count.
    const youtube: YoutubeSource = {
      ...mockYoutube,
      search: async (query: string) => ({
        fetchedAt: '2026-10-20',
        videos: [
          video(`${query}-1`, 'UCshared'),
          video(`${query}-2`, `UCown${query}`),
          video(`${query}-3`, `UCshort${query}`, { durationSec: 60 }),
        ],
      }),
      uploads: completeUploads,
    }
    await gather(hitlist, sources({ youtube }), T, (l) => lines.push(l))
    expect(lines.at(-1)).toBe(
      'evidence 2020-03-15: 2 entries; population downfall=1, success=1; ' +
        '2 YouTube searches; 3 channels fetched',
    )
  })
})
