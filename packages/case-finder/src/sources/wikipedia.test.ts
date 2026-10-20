import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
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
    await expect(sourceFor(error).parsed(1)).rejects.toThrow()
    const missing = wikipediaFetch(() => 'wikipedia-wikitext-badrevid.json')
    await expect(sourceFor(missing).parsed(1)).rejects.toThrow(/revision 1/)
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
