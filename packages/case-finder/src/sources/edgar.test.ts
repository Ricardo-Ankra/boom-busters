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

describe('mockEdgar', () => {
  it('is deterministic and obviously fake', async () => {
    const a = await mockEdgar.filings('1', 'success', '2020-01-01')
    expect(a).toEqual(await mockEdgar.filings('1', 'success', '2020-01-01'))
    expect(a.length).toBeGreaterThan(0)
    expect(a.every((d) => d.title.startsWith('[mock]') && d.datedAt! < '2020-01-01')).toBe(true)
  })
})
