import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPoliteClient } from './http'
import { liveWayback } from './wayback'
import { mockWayback } from './mock'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const clientFor = (body: string) => {
  const fetchImpl = vi.fn(async (_url: string | URL | Request) => new Response(body))
  return {
    fetchImpl,
    client: createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl }),
  }
}

describe('liveWayback', () => {
  it('skips the header row and maps each capture to a replay url', async () => {
    const { client, fetchImpl } = clientFor(fixture('wayback-cdx.json'))
    const captures = await liveWayback(client).captures('example.com', {
      from: '2018',
      to: '20200101',
      limit: 5,
    })
    expect(captures).toEqual([
      {
        timestamp: '20180105123456',
        url: 'https://web.archive.org/web/20180105123456/http://example.com/',
      },
      {
        timestamp: '20190301000000',
        url: 'https://web.archive.org/web/20190301000000/https://www.example.com/',
      },
    ])
    expect(String(fetchImpl.mock.calls[0]![0])).toBe(
      'https://web.archive.org/cdx/search/cdx?url=example.com&output=json&filter=statuscode:200&collapse=timestamp:4&from=2018&to=20200101&limit=5',
    )
  })

  it('returns nothing for an empty reply', async () => {
    const { client } = clientFor('')
    const options = { from: '2018', to: '2019', limit: 1 }
    expect(await liveWayback(client).captures('x.com', options)).toEqual([])
  })
})

describe('mockWayback', () => {
  it('returns fixed captures', async () => {
    const rows = await mockWayback.captures('x.com', { from: '2018', to: '2019', limit: 3 })
    expect(rows.length).toBeGreaterThan(0)
  })
})
