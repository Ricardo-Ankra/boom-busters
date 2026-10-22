import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPoliteClient } from './http'
import { liveWikipedia, normalTitle } from './wikipedia'
import { mockWikipedia } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** Route each request by its query parameters to a fixture; an unrouted request fails the test. */
function wikipediaFetch(route: (p: URLSearchParams) => string) {
  return vi.fn(async (url: string | URL | Request) => {
    const params = new URL(String(url)).searchParams
    return new Response(fixture(route(params)), { status: 200 })
  })
}

const sourceFor = (fetchImpl: ReturnType<typeof wikipediaFetch>) =>
  liveWikipedia(
    createPoliteClient({
      contact: 'me@example.com',
      cacheDir: null,
      fetchImpl,
      minIntervalMs: { 'wikipedia.org': 0 },
    }),
  )

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

const searchParamsOf = (fetchImpl: ReturnType<typeof wikipediaFetch>) =>
  fetchImpl.mock.calls.map((c) => new URL(String(c[0])).searchParams)

function categoryRoute(p: URLSearchParams): string {
  const title = p.get('cmtitle')
  if (title === 'Category:Frauds') {
    return p.get('cmcontinue') ? 'wikipedia-category-page2.json' : 'wikipedia-category-page1.json'
  }
  if (title === 'Category:Sub A') return 'wikipedia-category-suba.json'
  if (title === 'Category:Sub B') return 'wikipedia-category-subb.json'
  throw new Error(`unrouted ${p.toString()}`)
}

describe('live wikipedia', () => {
  it('follows continuation across pages of category members', async () => {
    const fetchImpl = wikipediaFetch(categoryRoute)
    const titles = await sourceFor(fetchImpl).categoryMembers('Frauds', 0)
    expect(titles).toEqual(['Alpha Fraud', 'Beta & Co', 'Gamma Scheme'])
    const calls = searchParamsOf(fetchImpl)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.get('cmcontinue')).toBe('page|ALPHA2|2')
    expect(calls[1]!.get('continue')).toBe('-||')
    expect(calls[0]!.get('format')).toBe('json')
    expect(calls[0]!.get('formatversion')).toBe('2')
    expect(calls[0]!.get('cmtype')).toBe('page|subcat')
    expect(calls[0]!.get('cmlimit')).toBe('max')
  })

  it('depth 1 includes members of direct subcategories once', async () => {
    const fetchImpl = wikipediaFetch(categoryRoute)
    const titles = await sourceFor(fetchImpl).categoryMembers('Frauds', 1)
    expect(titles).toEqual([
      'Alpha Fraud',
      'Beta & Co',
      'Gamma Scheme',
      'Delta Collapse',
      'Epsilon Ponzi',
    ])
    const asked = searchParamsOf(fetchImpl).map((p) => p.get('cmtitle'))
    expect(asked.filter((t) => t === 'Category:Sub A')).toHaveLength(1)
    expect(asked.filter((t) => t === 'Category:Sub B')).toHaveLength(1)
  })

  it('listLinks follows continuation and asks for namespace 0', async () => {
    const fetchImpl = wikipediaFetch((p) =>
      p.get('plcontinue') ? 'wikipedia-links-page2.json' : 'wikipedia-links-page1.json',
    )
    const links = await sourceFor(fetchImpl).listLinks('List of frauds')
    expect(links).toEqual(['Alpha Fraud', 'Beta & Co', 'Gamma Scheme'])
    const first = searchParamsOf(fetchImpl)[0]!
    expect(first.get('titles')).toBe('List of frauds')
    expect(first.get('plnamespace')).toBe('0')
  })

  it('redirectsTo returns redirect titles only', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-redirects.json')
    expect(await sourceFor(fetchImpl).redirectsTo('Wirecard')).toEqual([
      'Wirecard AG',
      'Wirecard scandal',
    ])
  })

  describe('formerTitles', () => {
    const MOVED = 'Moved page [[Old Co]] to [[New Co]]'
    const reply = (pages: object[], extra: object = {}) =>
      JSON.stringify({ batchcomplete: true, query: { pages, ...extra } })
    const respond = (body: (p: URLSearchParams) => string) =>
      vi.fn(async (url: string | URL | Request) => {
        return new Response(body(new URL(String(url)).searchParams), { status: 200 })
      })
    const source = (fetchImpl: ReturnType<typeof respond>) =>
      liveWikipedia(
        createPoliteClient({
          contact: 'me@example.com',
          cacheDir: null,
          fetchImpl,
          minIntervalMs: { 'wikipedia.org': 0 },
        }),
      )

    it('keeps a redirect whose edit summary is a page move, or that transcludes R from move', async () => {
      const fetchImpl = respond(() =>
        reply([
          { title: 'Old Co', revisions: [{ comment: 'Moved page [[Old Co]] to [[New Co]]' }] },
          {
            title: 'Old Co Inc',
            revisions: [{ comment: 'Rcat' }],
            templates: [{ ns: 10, title: 'Template:R from move' }],
          },
          { title: 'Nickname', revisions: [{ comment: 'create redirect' }] },
        ]),
      )
      const former = await source(fetchImpl).formerTitles('New Co', [
        'Old Co',
        'Nickname',
        'Old Co Inc',
      ])
      expect(former).toEqual(['Old Co', 'Old Co Inc'])
      const params = searchParamsOf(fetchImpl as never)[0]!
      expect(params.get('prop')).toBe('revisions|templates')
      expect(params.get('rvprop')).toBe('comment')
      expect(params.get('tltemplates')).toBe('Template:R from move')
      expect(params.get('tllimit')).toBe('max')
      expect(params.get('titles')).toBe('Old Co|Nickname|Old Co Inc')
    })

    it('counts a pre-2013 automatic summary, which has no "page"', async () => {
      const fetchImpl = respond(() =>
        reply([
          { title: 'Old Co', revisions: [{ comment: 'Old Co moved [[Old Co]] to [[New Co]]' }] },
        ]),
      )
      expect(await source(fetchImpl).formerTitles('New Co', ['Old Co'])).toEqual(['Old Co'])
    })

    it('a redirect with neither marker, or no revision data, is not a former title', async () => {
      const fetchImpl = respond(() =>
        reply([
          { title: 'A', revisions: [{ comment: 'Moved to a better place' }] },
          { title: 'B', missing: true },
          { title: 'C' },
        ]),
      )
      expect(await source(fetchImpl).formerTitles('X', ['A', 'B', 'C'])).toEqual([])
    })

    it('batches by 50, keeps the input order, and asks nothing for no redirects', async () => {
      const titles = Array.from({ length: 120 }, (_, i) => `Title ${i}`)
      const fetchImpl = respond((p) =>
        reply(
          p
            .get('titles')!
            .split('|')
            .reverse()
            .map((title) => ({ title, revisions: [{ comment: MOVED }] })),
        ),
      )
      expect(await source(fetchImpl).formerTitles('X', titles)).toEqual(titles)
      expect(
        searchParamsOf(fetchImpl as never).map((p) => p.get('titles')!.split('|').length),
      ).toEqual([50, 50, 20])
      const none = respond(() => reply([]))
      expect(await source(none).formerTitles('X', [])).toEqual([])
      expect(none).not.toHaveBeenCalled()
    })

    it('maps a normalised title back to the one requested', async () => {
      const fetchImpl = respond(() =>
        reply([{ title: 'Old co', revisions: [{ comment: MOVED }] }], {
          normalized: [{ from: 'old_co', to: 'Old co' }],
        }),
      )
      expect(await source(fetchImpl).formerTitles('X', ['old_co'])).toEqual(['old_co'])
    })

    it('follows continue for templates and joins them to the first reply', async () => {
      const fetchImpl = respond((p) =>
        p.get('tlcontinue') === 'next'
          ? reply([{ title: 'Old Co', templates: [{ ns: 10, title: 'Template:R from move' }] }])
          : JSON.stringify({
              continue: { tlcontinue: 'next', continue: '||' },
              query: { pages: [{ title: 'Old Co', revisions: [{ comment: 'Rcat' }] }] },
            }),
      )
      expect(await source(fetchImpl).formerTitles('X', ['Old Co'])).toEqual(['Old Co'])
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('the mock answers every second redirect', async () => {
      expect(await mockWikipedia.formerTitles('X', ['a', 'b', 'c'])).toEqual(['a', 'c'])
    })
  })

  it('qidsFor maps requested titles through normalisation and redirects', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-qids.json')
    const map = await sourceFor(fetchImpl).qidsFor([
      'wirecard',
      'Wirecard AG',
      'Beta & Co',
      'No Item',
    ])
    expect(map.get('wirecard')).toBe('Q1001')
    expect(map.get('Wirecard AG')).toBe('Q1001')
    expect(map.get('Beta & Co')).toBe('Q1002')
    expect(map.has('No Item')).toBe(false)
    const params = searchParamsOf(fetchImpl)[0]!
    expect(params.get('titles')).toBe('wirecard|Wirecard AG|Beta & Co|No Item')
    expect(params.get('redirects')).toBe('1')
  })

  it('qidsFor batches titles by 50', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-qids.json')
    await sourceFor(fetchImpl).qidsFor(Array.from({ length: 120 }, (_, i) => `Title ${i}`))
    const sizes = searchParamsOf(fetchImpl).map((p) => p.get('titles')!.split('|').length)
    expect(sizes).toEqual([50, 50, 20])
  })

  it('revisionBefore returns the latest revision before the day', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-revision.json')
    expect(await sourceFor(fetchImpl).revisionBefore('Wirecard', '2020-01-01')).toEqual({
      revid: 987654,
      timestamp: '2019-12-31T23:10:00Z',
    })
    const params = searchParamsOf(fetchImpl)[0]!
    expect(params.get('rvstart')).toBe('2019-12-31T23:59:59Z')
    expect(params.get('rvdir')).toBe('older')
    expect(params.get('rvlimit')).toBe('1')
    expect(params.get('redirects')).toBeNull()
  })

  it('revisionBefore starts one second before midnight, across a leap day', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-revision.json')
    await sourceFor(fetchImpl).revisionBefore('Wirecard', '2020-03-01')
    expect(searchParamsOf(fetchImpl)[0]!.get('rvstart')).toBe('2020-02-29T23:59:59Z')
  })

  it('revisionBefore makes one request and ignores continue', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-revision-continue.json')
    expect(await sourceFor(fetchImpl).revisionBefore('Wirecard', '2020-01-01')).toEqual({
      revid: 987654,
      timestamp: '2019-12-31T23:10:00Z',
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('revisionBefore returns null for an article created after the day', async () => {
    const created = wikipediaFetch(() => 'wikipedia-revision-none.json')
    expect(await sourceFor(created).revisionBefore('Newer Article', '2010-01-01')).toBeNull()
    const missing = wikipediaFetch(() => 'wikipedia-revision-missing.json')
    expect(await sourceFor(missing).revisionBefore('Nonexistent', '2010-01-01')).toBeNull()
  })

  it('parsed reads the revision wikitext, not a parse of it', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-wikitext.json')
    await sourceFor(fetchImpl).parsed(987654)
    const params = searchParamsOf(fetchImpl)[0]!
    expect(params.get('action')).toBe('query')
    expect(params.get('prop')).toBe('revisions')
    expect(params.get('revids')).toBe('987654')
    expect(params.get('rvprop')).toBe('content')
    expect(params.get('rvslots')).toBe('main')
    expect(params.get('oldid')).toBeNull()
  })

  it('parsed takes categories from the wikitext, sort keys and comments dropped', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-wikitext.json')
    const parsed = await sourceFor(fetchImpl).parsed(987654)
    // {{Ponzi schemes}} would add categories in a parse of today's template; the text has none.
    expect(parsed.categories).toEqual(['Companies established in 1999', 'Accounting scandals'])
  })

  it('parsed takes article links only: piped, sectioned, deduped, colon titles kept', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-wikitext.json')
    const parsed = await sourceFor(fetchImpl).parsed(987654)
    expect(parsed.links).toEqual([
      'Payment processor',
      'Aschheim',
      'Markus Braun',
      'Wirecard scandal',
      'Star Wars: Episode I',
    ])
  })

  it('parsed takes literal URLs, template parameters included, deduped', async () => {
    const fetchImpl = wikipediaFetch(() => 'wikipedia-wikitext.json')
    const parsed = await sourceFor(fetchImpl).parsed(987654)
    expect(parsed.externalLinks).toEqual([
      'https://www.sec.gov/x',
      'https://example.org/report?a=1&b=2',
    ])
  })

  it('parsed throws on an API error body or a missing revision', async () => {
    const error = wikipediaFetch(() => 'wikipedia-wikitext-error.json')
    await expect(sourceFor(error).parsed(1)).rejects.toThrow(/nosuchrevid/)
    const missing = wikipediaFetch(() => 'wikipedia-wikitext-badrevid.json')
    await expect(sourceFor(missing).parsed(1)).rejects.toThrow(/revision 1/)
  })

  it('a hidden revision has no items, not an error', async () => {
    const hidden = wikipediaFetch(() => 'wikipedia-wikitext-hidden.json')
    const empty = { categories: [], externalLinks: [], links: [] }
    await expect(sourceFor(hidden).parsed(987654)).resolves.toEqual(empty)
    const absent = wikipediaFetch(() => 'wikipedia-wikitext-nocontent.json')
    await expect(sourceFor(absent).parsed(987654)).resolves.toEqual(empty)
  })

  it('parsed keeps only the extracted items, per revision, and reads them back first', async () => {
    const cacheDir = await mkdtemp(path.join(tmpdir(), 'cf-wp-'))
    dirs.push(cacheDir)
    const itemsCacheDir = path.join(cacheDir, 'wikipedia-items')
    const sourceWith = (fetchImpl: ReturnType<typeof wikipediaFetch>) =>
      liveWikipedia(
        createPoliteClient({
          contact: 'me@example.com',
          cacheDir,
          fetchImpl,
          minIntervalMs: { 'wikipedia.org': 0 },
        }),
        { itemsCacheDir },
      )
    const fetchImpl = wikipediaFetch(() => 'wikipedia-wikitext.json')
    const first = await sourceWith(fetchImpl).parsed(987654)
    // The raw wikitext reply is never written; the items are, under the revision id.
    expect(await readdir(cacheDir)).toEqual(['wikipedia-items'])
    expect(await readdir(itemsCacheDir)).toEqual(['987654.json'])
    expect(JSON.parse(await readFile(path.join(itemsCacheDir, '987654.json'), 'utf8'))).toEqual(
      first,
    )
    const offline = wikipediaFetch(() => {
      throw new Error('no network')
    })
    expect(await sourceWith(offline).parsed(987654)).toEqual(first)
    expect(offline).not.toHaveBeenCalled()
  })

  it('a hidden revision caches its empty items; an error caches nothing', async () => {
    const itemsCacheDir = await mkdtemp(path.join(tmpdir(), 'cf-wp-items-'))
    dirs.push(itemsCacheDir)
    const client = (route: string) =>
      createPoliteClient({
        contact: 'me@example.com',
        cacheDir: null,
        fetchImpl: wikipediaFetch(() => route),
        minIntervalMs: { 'wikipedia.org': 0 },
      })
    await liveWikipedia(client('wikipedia-wikitext-hidden.json'), { itemsCacheDir }).parsed(5)
    await expect(
      liveWikipedia(client('wikipedia-wikitext-error.json'), { itemsCacheDir }).parsed(6),
    ).rejects.toThrow()
    expect(await readdir(itemsCacheDir)).toEqual(['5.json'])
  })

  it('normalTitle trims, spaces underscores and upper-cases the first letter', () => {
    expect(normalTitle(' wirecard_scandal ')).toBe('Wirecard scandal')
  })
})

describe('mock wikipedia', () => {
  it('is deterministic and obviously fake', async () => {
    const a = await mockWikipedia.categoryMembers('Frauds', 1)
    expect(a).toEqual(await mockWikipedia.categoryMembers('Frauds', 1))
    expect(a[0]).toBe('Mock article 1 in Frauds')
    expect(a.length).toBeGreaterThan((await mockWikipedia.categoryMembers('Frauds', 0)).length)
    expect(new Set(a).size).toBe(a.length)
    const qids = await mockWikipedia.qidsFor(['Mock article 1 in Frauds'])
    expect(qids.get('Mock article 1 in Frauds')).toMatch(/^Q\d+$/)
    const rev = await mockWikipedia.revisionBefore('X', '2020-01-01')
    expect(rev!.timestamp < '2020-01-01').toBe(true)
    const parsed = await mockWikipedia.parsed(rev!.revid)
    expect(parsed.categories[0]).toContain('Mock')
    expect(parsed.links[0]).toContain('Mock')
  })
})
