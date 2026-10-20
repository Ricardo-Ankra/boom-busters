import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPoliteClient } from './http'
import { mockSecReleases } from './mock'
import { liveSecReleases, releasesNaming, type SecRelease } from './sec-releases'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function setup() {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (u.endsWith('accounting-auditing-enforcement-releases?page=0')) {
      return new Response(fixture('sec-aaer-page0.html'))
    }
    if (u.endsWith('litigation-releases?page=0')) {
      return new Response(fixture('sec-litigation-page0.html'))
    }
    return new Response(fixture('sec-empty-page.html'))
  })
  const client = createPoliteClient({
    contact: 'me@example.com',
    cacheDir: null,
    fetchImpl,
    minIntervalMs: { 'sec.gov': 0 },
  })
  return { fetchImpl, source: liveSecReleases(client) }
}

describe('liveSecReleases', () => {
  it('parses AAER rows from the saved page', async () => {
    const { source, fetchImpl } = setup()
    const index = await source.index()
    const aaer = index.filter((r) => r.kind === 'sec-aaer')
    expect(aaer).toHaveLength(3)
    expect(aaer[0]).toEqual({
      kind: 'sec-aaer',
      number: 'AAER-4605',
      date: '2026-10-08',
      title: 'Carlos Lopez, CPA',
      url: 'https://www.sec.gov/files/litigation/admin/2026/34-106633.pdf',
    })
    expect(aaer[2]?.url).toBe(
      'https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26657',
    )
    expect(aaer[2]?.date).toBe('2026-09-30')
    // pages are fetched until one is empty
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(urls).toContain(
      'https://www.sec.gov/enforcement-litigation/accounting-auditing-enforcement-releases?page=1',
    )
  })

  it('parses litigation releases', async () => {
    const { source } = setup()
    const lit = (await source.index()).filter((r) => r.kind === 'sec-litigation')
    expect(lit.map((r) => r.number)).toEqual(['LR-26674', 'LR-26673', 'LR-26672'])
    expect(lit[1]?.title).toBe('Matthew Brown and Matthew Brown Companies, LLC')
    expect(lit[0]?.date).toBe('2026-10-19')
  })
})

const release = (
  kind: SecRelease['kind'],
  number: string,
  date: string,
  title: string,
  tail: string,
): SecRelease => ({ kind, number, date, title, url: `https://www.sec.gov/${tail}` })

const index: SecRelease[] = [
  release('sec-aaer', 'AAER-1', '2010-01-01', 'Enron Corp.', 'a'),
  release('sec-litigation', 'LR-2', '2011-01-01', 'Enronix Ltd', 'b'),
  release('sec-litigation', 'LR-3', '2013-01-01', 'Jeffrey Skilling and ENRON', 'c'),
]

describe('releasesNaming', () => {
  it('releasesNaming matches whole words only', () => {
    const docs = releasesNaming(index, ['Enron'], '2020-01-01')
    expect(docs.map((d) => d.title)).toEqual([
      'AAER-1: Enron Corp.',
      'LR-3: Jeffrey Skilling and ENRON',
    ])
    expect(docs[0]).toEqual({
      url: 'https://www.sec.gov/a',
      title: 'AAER-1: Enron Corp.',
      source: 'sec-aaer',
      datedAt: '2010-01-01',
    })
  })

  it('is strictly before T and treats regex characters literally', () => {
    expect(releasesNaming(index, ['Enron'], '2010-01-01')).toEqual([])
    expect(releasesNaming(index, ['En.on'], '2020-01-01')).toEqual([])
  })
})

describe('mockSecReleases', () => {
  it('is deterministic and obviously fake', async () => {
    const a = await mockSecReleases.index()
    expect(a).toEqual(await mockSecReleases.index())
    expect(a.length).toBeGreaterThan(0)
    expect(a.every((r) => r.title.startsWith('[mock]'))).toBe(true)
  })
})
