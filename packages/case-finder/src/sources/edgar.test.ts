import { readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { liveEdgar } from './edgar'
import { createPoliteClient } from './http'
import { mockEdgar } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function setup(missing = false) {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    if (missing) return new Response('Not found', { status: 404 })
    if (u.endsWith('/index.json')) return new Response(fixture('edgar-filing-index.json'))
    if (u.endsWith('-submissions-001.json')) {
      return new Response(fixture('edgar-submissions-001.json'))
    }
    return new Response(fixture('edgar-submissions.json'))
  })
  const client = createPoliteClient({
    contact: 'me@example.com',
    cacheDir: null,
    fetchImpl,
    minIntervalMs: { 'sec.gov': 0 },
  })
  return { fetchImpl, source: liveEdgar(client) }
}

describe('liveEdgar with a truncated reply', () => {
  it('is rejected as unusable rather than cached', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cf-edgar-'))
    try {
      const fetchImpl = vi.fn(async () => new Response('{"filings": {"rec', { status: 200 }))
      const source = liveEdgar(
        createPoliteClient({
          contact: 'me@example.com',
          cacheDir: dir,
          fetchImpl,
          minIntervalMs: { 'sec.gov': 0 },
        }),
      )
      await expect(source.filings('1234567', 'success', '2022-01-01')).rejects.toThrow(
        'unusable response',
      )
      expect(await readdir(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('liveEdgar', () => {
  it('counts only the forms the lane takes, dated before T', async () => {
    const { source } = setup()
    const success = await source.filings('1234567', 'success', '2022-01-01')
    expect(success.map((d) => d.title)).toEqual([
      '10-K filed 2021-03-01',
      '10-K filed 2019-03-01',
      '10-K filed 2015-03-02',
    ])
    expect(success[0]).toEqual({
      url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456721000001/a10k.htm',
      title: '10-K filed 2021-03-01',
      source: 'edgar',
      datedAt: '2021-03-01',
    })
    const downfall = await source.filings('1234567', 'downfall', '2022-01-01')
    expect(downfall.map((d) => d.title)).toEqual([
      '8-K filed 2021-05-10',
      'NT 10-K filed 2020-03-02',
    ])
  })

  it('excludes filings on or after T', async () => {
    const { source } = setup()
    const docs = await source.filings('1234567', 'success', '2021-03-01')
    expect(docs.map((d) => d.datedAt)).toEqual(['2019-03-01', '2015-03-02'])
  })

  it('pads the CIK to 10 digits and fetches the older files', async () => {
    const { source, fetchImpl } = setup()
    await source.filings('1234567', 'success', '2022-01-01')
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(urls).toEqual([
      'https://data.sec.gov/submissions/CIK0001234567.json',
      'https://data.sec.gov/submissions/CIK0001234567-submissions-001.json',
    ])
  })

  it('returns nothing for a CIK that is not a filer', async () => {
    const { source } = setup(true)
    expect(await source.filings('99', 'success', '2022-01-01')).toEqual([])
  })
})

describe('liveEdgar exhibits and latest filing', () => {
  it('reads each matching 8-K folder once and returns its exhibit 99.1, newest first', async () => {
    const { source, fetchImpl } = setup()
    const docs = await source.exhibits('1234567', { items: ['2.02', '4.02'], newest: 2 })
    expect(docs).toEqual([
      {
        url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456721000002/ex99-1.htm',
        title: '8-K exhibit 99.1 filed 2021-05-10',
        source: 'edgar',
        datedAt: '2021-05-10',
      },
      {
        url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456720000003/ex99-1.htm',
        title: '8-K exhibit 99.1 filed 2020-06-15',
        source: 'edgar',
        datedAt: '2020-06-15',
      },
    ])
    const indexes = fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.endsWith('index.json'))
    expect(indexes).toEqual([
      'https://www.sec.gov/Archives/edgar/data/1234567/000123456721000002/index.json',
      'https://www.sec.gov/Archives/edgar/data/1234567/000123456720000003/index.json',
    ])
  })

  it('takes only the newest N matching filings and skips other items', async () => {
    const { source } = setup()
    const docs = await source.exhibits('1234567', { items: ['2.02', '4.02'], newest: 1 })
    expect(docs.map((d) => d.datedAt)).toEqual(['2021-05-10'])
    expect(await source.exhibits('1234567', { items: ['5.02'], newest: 3 })).toEqual([])
  })

  it('returns nothing for a non-filer', async () => {
    const { source } = setup(true)
    expect(await source.exhibits('99', { items: ['4.02'], newest: 1 })).toEqual([])
    expect(await source.latestFiling('99', '10-K')).toBeNull()
  })

  it('latestFiling is the newest filing of the form, with no date cut-off', async () => {
    const { source } = setup()
    expect(await source.latestFiling('1234567', '10-K')).toEqual({
      url: 'https://www.sec.gov/Archives/edgar/data/1234567/000123456723000006/f10k.htm',
      title: '10-K filed 2023-03-01',
      source: 'edgar',
      datedAt: '2023-03-01',
    })
    expect(await source.latestFiling('1234567', 'S-1')).toBeNull()
  })
})

describe('mockEdgar', () => {
  it('is deterministic and obviously fake', async () => {
    const a = await mockEdgar.filings('1', 'success', '2020-01-01')
    expect(a).toEqual(await mockEdgar.filings('1', 'success', '2020-01-01'))
    expect(a.length).toBeGreaterThan(0)
    expect(a.every((d) => d.title.startsWith('[mock]') && d.datedAt! < '2020-01-01')).toBe(true)
  })

  it('answers exhibits and latestFiling with fixed fake documents', async () => {
    const docs = await mockEdgar.exhibits('1', { items: ['4.02'], newest: 2 })
    expect(docs).toHaveLength(2)
    expect(docs.every((d) => d.title.startsWith('[mock] 8-K exhibit 99.1'))).toBe(true)
    expect((await mockEdgar.latestFiling('1', '10-K'))?.title).toBe('[mock] 10-K filed 2025-03-01')
  })
})
