import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPoliteClient } from './http'
import { livePageviews } from './pageviews'
import { mockPageviews } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

/** Routes by the article segment of the REST URL; unknown articles are 404. */
function routedFetch(routes: Record<string, string>) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    for (const [article, file] of Object.entries(routes)) {
      if (u.includes(`/user/${article}/`)) return new Response(fixture(file), { status: 200 })
    }
    return new Response(fixture('pageviews-404.json'), { status: 404 })
  })
}

const sourceFor = (fetchImpl: ReturnType<typeof routedFetch>) =>
  livePageviews(
    createPoliteClient({
      contact: 'me@example.com',
      cacheDir: null,
      fetchImpl,
      minIntervalMs: { 'wikimedia.org': 0 },
    }),
  )

describe('live pageviews', () => {
  it('sums views across a title and its redirects month by month', async () => {
    const fetchImpl = routedFetch({
      Wirecard: 'pageviews-wirecard-monthly.json',
      Wirecard_AG: 'pageviews-wirecard-ag-monthly.json',
    })
    const out = await sourceFor(fetchImpl).monthly(
      'en.wikipedia',
      ['Wirecard', 'Wirecard AG'],
      '2019-03',
      '2019-06',
    )
    expect(out).toEqual([
      { month: '2019-03', views: 1000 },
      { month: '2019-04', views: 2010 },
      { month: '2019-05', views: 3020 },
      { month: '2019-06', views: 4030 },
    ])
  })

  it('fills months with no data as 0 from the requested start', async () => {
    const fetchImpl = routedFetch({ Wirecard: 'pageviews-wirecard-monthly.json' })
    const out = await sourceFor(fetchImpl).monthly(
      'en.wikipedia',
      ['Wirecard'],
      '2018-01',
      '2019-08',
    )
    expect(out).toHaveLength(20)
    expect(out.slice(0, 14).every((m) => m.views === 0)).toBe(true)
    expect(out[0]).toEqual({ month: '2018-01', views: 0 })
    expect(out[14]).toEqual({ month: '2019-03', views: 1000 })
    expect(out[19]).toEqual({ month: '2019-08', views: 0 })
  })

  it('treats a 404 as no views', async () => {
    const out = await sourceFor(routedFetch({})).monthly(
      'en.wikipedia',
      ['Nobody'],
      '2020-01',
      '2020-03',
    )
    expect(out).toEqual([
      { month: '2020-01', views: 0 },
      { month: '2020-02', views: 0 },
      { month: '2020-03', views: 0 },
    ])
  })

  it('fails loudly on a non-404 error status', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 403 }))
    await expect(
      sourceFor(fetchImpl as never).monthly('en.wikipedia', ['X'], '2020-01', '2020-01'),
    ).rejects.toThrow(/403/)
  })

  it('requests the documented URL with spaces as underscores and slashes encoded', async () => {
    const fetchImpl = routedFetch({})
    await sourceFor(fetchImpl).monthly('de.wikipedia', ['AC/DC band'], '2020-02', '2020-03')
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/de.wikipedia/all-access/user/AC%2FDC_band/monthly/2020020100/2020033100',
    )
  })

  it('reads daily views and fills every day with 0', async () => {
    const fetchImpl = routedFetch({ Wirecard: 'pageviews-wirecard-daily.json' })
    const out = await sourceFor(fetchImpl).daily(
      'en.wikipedia',
      ['Wirecard'],
      '2020-06-17',
      '2020-06-21',
    )
    expect(out).toEqual([
      { date: '2020-06-17', views: 0 },
      { date: '2020-06-18', views: 500 },
      { date: '2020-06-19', views: 0 },
      { date: '2020-06-20', views: 900 },
      { date: '2020-06-21', views: 0 },
    ])
    expect(String(fetchImpl.mock.calls[0]![0])).toMatch(/\/daily\/2020061700\/2020062100$/)
  })
})

describe('mock pageviews', () => {
  it('is stable, distinct per title, complete and never negative', async () => {
    const a = await mockPageviews.monthly('en.wikipedia', ['Alpha'], '2020-01', '2020-12')
    const a2 = await mockPageviews.monthly('en.wikipedia', ['Alpha'], '2020-01', '2020-12')
    const b = await mockPageviews.monthly('en.wikipedia', ['Beta'], '2020-01', '2020-12')
    expect(a).toEqual(a2)
    expect(a).not.toEqual(b)
    expect(a).toHaveLength(12)
    expect(a.every((m) => m.views >= 0)).toBe(true)
    const d = await mockPageviews.daily('en.wikipedia', ['Alpha'], '2020-02-27', '2020-03-02')
    expect(d.map((x) => x.date)).toEqual([
      '2020-02-27',
      '2020-02-28',
      '2020-02-29',
      '2020-03-01',
      '2020-03-02',
    ])
  })
})
