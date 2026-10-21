import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPoliteClient } from './http'
import { mockYoutube } from './mock'
import { createQuotaLedger, QuotaExhaustedError } from './quota'
import { liveYoutube, parseIsoDuration, uploadsPlaylistId, YoutubeNotFoundError } from './youtube'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

type Route = [needle: string, file: string, status?: number]

/** First route whose needle is in the URL wins, so list the specific ones first. */
function routedFetch(routes: Route[]) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    const hit = routes.find(([needle]) => u.includes(needle))
    if (!hit) return new Response('{}', { status: 404 })
    return new Response(fixture(hit[1]), { status: hit[2] ?? 200 })
  })
}

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

async function setup(
  fetchImpl: ReturnType<typeof routedFetch>,
  options: { daily?: number; cache?: boolean } = {},
) {
  let cacheDir: string | null = null
  if (options.cache) {
    cacheDir = await mkdtemp(path.join(tmpdir(), 'cf-yt-'))
    dirs.push(cacheDir)
  }
  const ledger = createQuotaLedger(options.daily ?? 10_000, 0)
  const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
  return { ledger, source: liveYoutube(client, 'SECRETKEY', ledger), fetchImpl }
}

const searchRoutes: Route[] = [
  ['/search?', 'youtube-search.json'],
  ['/videos?', 'youtube-videos.json'],
]

describe('parseIsoDuration', () => {
  it('parses ISO 8601 durations', () => {
    expect(parseIsoDuration('PT8M')).toBe(480)
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723)
    expect(parseIsoDuration('P0D')).toBe(0)
    expect(parseIsoDuration('P1DT1H')).toBe(90_000)
    expect(parseIsoDuration('PT45S')).toBe(45)
    expect(parseIsoDuration('nonsense')).toBe(0)
    expect(parseIsoDuration('')).toBe(0)
  })
})

describe('uploadsPlaylistId', () => {
  it('turns a leading UC into UU', () => {
    expect(uploadsPlaylistId('UCaaa')).toBe('UUaaa')
    expect(uploadsPlaylistId('UCUCx')).toBe('UUUCx')
  })
})

describe('live youtube search', () => {
  it('a search spends 101 units, and a cached repeat spends none', async () => {
    const { source, ledger, fetchImpl } = await setup(routedFetch(searchRoutes), { cache: true })
    const first = await source.search('wirecard fraud')
    expect(ledger.remaining()).toBe(10_000 - 101)
    const second = await source.search('wirecard fraud')
    expect(ledger.remaining()).toBe(10_000 - 101)
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('keeps the search order, drops hits videos.list omits, and maps fields', async () => {
    const { source } = await setup(routedFetch(searchRoutes))
    const out = await source.search('wirecard')
    expect(out.videos.map((v) => v.id)).toEqual(['vid1', 'vid3'])
    expect(out.videos[0]).toEqual({
      id: 'vid1',
      channelId: 'UCaaa',
      title: 'The Wirecard collapse',
      publishedAt: '2020-07-15',
      durationSec: 480,
      views: 420000,
    })
    expect(out.videos[1]?.durationSec).toBe(3723)
    expect(out.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('sends the documented parameters and the key', async () => {
    const { source, fetchImpl } = await setup(routedFetch(searchRoutes))
    await source.search('a b')
    const urls = fetchImpl.mock.calls.map((c) => String(c[0]))
    expect(urls[0]).toContain('https://www.googleapis.com/youtube/v3/search?')
    expect(urls[0]).toContain('part=snippet')
    expect(urls[0]).toContain('type=video')
    expect(urls[0]).toContain('maxResults=25')
    expect(urls[0]).toContain('q=a%20b')
    expect(urls[0]).toContain('key=SECRETKEY')
    expect(urls[1]).toContain('/videos?')
    expect(urls[1]).toContain('id=vid1,vid2,vid3')
  })

  it('an empty search result spends 100 and makes no videos call', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"items":[]}', { status: 200 }))
    const { source, ledger } = await setup(fetchImpl as never)
    expect((await source.search('nothing')).videos).toEqual([])
    expect(ledger.remaining()).toBe(10_000 - 100)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a quotaExceeded 403 throws QuotaExhaustedError and caches nothing', async () => {
    const fetchImpl = routedFetch([['/search?', 'youtube-quota-403.json', 403]])
    const { source } = await setup(fetchImpl, { cache: true })
    await expect(source.search('x')).rejects.toBeInstanceOf(QuotaExhaustedError)
    await expect(source.search('x')).rejects.toBeInstanceOf(QuotaExhaustedError)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('any other non-2xx throws an Error with the status and no key', async () => {
    const fetchImpl = routedFetch([['/search?', 'youtube-forbidden-403.json', 403]])
    const { source } = await setup(fetchImpl)
    const err = await source.search('x').catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(QuotaExhaustedError)
    expect((err as Error).message).toContain('403')
    expect((err as Error).message).not.toContain('SECRETKEY')
  })

  it('refuses to start a call the ledger cannot afford', async () => {
    // 100 is enough for search.list but the videos.list that follows is not.
    const tight = await setup(routedFetch(searchRoutes), { daily: 100 })
    await expect(tight.source.search('x')).rejects.toBeInstanceOf(QuotaExhaustedError)
    expect(tight.ledger.remaining()).toBe(0)
    const poor = await setup(routedFetch(searchRoutes), { daily: 99 })
    await expect(poor.source.search('x')).rejects.toBeInstanceOf(QuotaExhaustedError)
    expect(poor.fetchImpl).not.toHaveBeenCalled()
  })
})

describe('live youtube with a truncated reply', () => {
  it('throws without the key, and the broken body is not cached', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"items": [{"id": ', { status: 200 }))
    const { source } = await setup(fetchImpl as unknown as ReturnType<typeof routedFetch>, {
      cache: true,
    })
    const err = (await source.channelByHandle('@aaa').catch((e: Error) => e)) as Error
    expect(err.message).toContain('unusable response')
    expect(err.message).not.toContain('SECRETKEY')
    await expect(source.channelByHandle('@aaa')).rejects.toThrow('unusable response')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe('live youtube channels', () => {
  it('looks a channel up by handle for one unit', async () => {
    const { source, ledger, fetchImpl } = await setup(
      routedFetch([['/channels?', 'youtube-channel.json']]),
    )
    expect(await source.channelByHandle('@aaa')).toEqual({
      channelId: 'UCaaa',
      uploadsPlaylistId: 'UUaaa',
    })
    expect(ledger.remaining()).toBe(10_000 - 1)
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('forHandle=%40aaa')
  })

  it('names the handle when no channel comes back', async () => {
    const { source } = await setup(routedFetch([['/channels?', 'youtube-channel-none.json']]))
    await expect(source.channelByHandle('@ghost')).rejects.toThrow('@ghost')
  })
})

describe('live youtube uploads', () => {
  const routes: Route[] = [
    ['pageToken=PAGE2', 'youtube-playlist-page2.json'],
    ['/playlistItems?', 'youtube-playlist-page1.json'],
    ['id=u3', 'youtube-uploads-videos2.json'],
    ['/videos?', 'youtube-uploads-videos1.json'],
  ]

  it('uploads pages through the playlist and reads views and durations', async () => {
    const { source, ledger } = await setup(routedFetch(routes))
    const out = await source.uploads('UCaaa', 'UUaaa')
    expect(out.channelId).toBe('UCaaa')
    expect(out.uploads.map((v) => [v.id, v.durationSec, v.views])).toEqual([
      ['u1', 600, 100],
      ['u2', 0, 0],
      ['u3', 65, 7],
    ])
    // two playlist pages plus two videos.list calls
    expect(ledger.remaining()).toBe(10_000 - 4)
  })

  it('maxPages stops paging', async () => {
    const { source, ledger, fetchImpl } = await setup(routedFetch(routes))
    const out = await source.uploads('UCaaa', 'UUaaa', { maxPages: 1 })
    expect(out.uploads.map((v) => v.id)).toEqual(['u1', 'u2'])
    expect(ledger.remaining()).toBe(10_000 - 2)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a cached repeat spends nothing', async () => {
    const { source, ledger } = await setup(routedFetch(routes), { cache: true })
    await source.uploads('UCaaa', 'UUaaa')
    await source.uploads('UCaaa', 'UUaaa')
    expect(ledger.remaining()).toBe(10_000 - 4)
  })

  it('a whole history is complete and carries the day its first page was fetched', async () => {
    const { source } = await setup(routedFetch(routes))
    const out = await source.uploads('UCaaa', 'UUaaa')
    expect(out.complete).toBe(true)
    expect(out.fetchedOn).toBe(new Date().toISOString().slice(0, 10))
  })

  it('stops on the page whose oldest upload is before `until`, and is then not complete', async () => {
    // Page 1's oldest upload is u1, published 2020-01-02.
    const { source, ledger } = await setup(routedFetch(routes))
    const out = await source.uploads('UCaaa', 'UUaaa', { until: '2020-01-03' })
    expect(out.uploads.map((v) => v.id)).toEqual(['u1', 'u2'])
    expect(out.complete).toBe(false)
    expect(ledger.remaining()).toBe(10_000 - 2)
  })

  it('pages on when the oldest upload is published on `until` itself', async () => {
    const { source } = await setup(routedFetch(routes))
    const out = await source.uploads('UCaaa', 'UUaaa', { until: '2020-01-02' })
    expect(out.uploads.map((v) => v.id)).toEqual(['u1', 'u2', 'u3'])
    expect(out.complete).toBe(true)
  })

  it('a page that repeats an upload already held keeps only the first copy', async () => {
    // Page 2 read on a later day, after a new upload shifted the pages: it starts with u2 again.
    const seam: Route[] = [
      ['pageToken=PAGE2', 'youtube-playlist-page2-seam.json'],
      ['/playlistItems?', 'youtube-playlist-page1.json'],
      ['id=u3', 'youtube-uploads-videos2.json'],
      ['/videos?', 'youtube-uploads-videos1.json'],
    ]
    const { source } = await setup(routedFetch(seam))
    const out = await source.uploads('UCaaa', 'UUaaa')
    expect(out.uploads.map((v) => v.id)).toEqual(['u1', 'u2', 'u3'])
    expect(out.uploads[1]).toMatchObject({ id: 'u2', title: 'Two' })
  })

  it('pages on while the oldest upload is still after `until`', async () => {
    const { source } = await setup(routedFetch(routes))
    const out = await source.uploads('UCaaa', 'UUaaa', { until: '2020-01-01' })
    expect(out.uploads.map((v) => v.id)).toEqual(['u1', 'u2', 'u3'])
    expect(out.complete).toBe(true)
  })

  it('maxPages cuts a history short of `until`, and it is not complete', async () => {
    const { source } = await setup(routedFetch(routes))
    const out = await source.uploads('UCaaa', 'UUaaa', { until: '2019-01-01', maxPages: 1 })
    expect(out.uploads.map((v) => v.id)).toEqual(['u1', 'u2'])
    expect(out.complete).toBe(false)
  })

  it('a deeper second call reads the earlier pages from the cache for free', async () => {
    const { source, ledger } = await setup(routedFetch(routes), { cache: true })
    const shallow = await source.uploads('UCaaa', 'UUaaa', { maxPages: 1 })
    expect(ledger.remaining()).toBe(10_000 - 2)
    const deep = await source.uploads('UCaaa', 'UUaaa', { until: '2019-01-01' })
    expect(deep.uploads.map((v) => v.id)).toEqual(['u1', 'u2', 'u3'])
    expect(deep.fetchedOn).toBe(shallow.fetchedOn)
    // Only page 2 and its videos.list were paid for.
    expect(ledger.remaining()).toBe(10_000 - 4)
  })

  it('a playlistNotFound 404 throws YoutubeNotFoundError, and a cached repeat spends nothing', async () => {
    const fetchImpl = routedFetch([['/playlistItems?', 'youtube-playlist-404.json', 404]])
    const { source, ledger } = await setup(fetchImpl, { cache: true })
    await expect(source.uploads('UCgone', 'UUgone')).rejects.toBeInstanceOf(YoutubeNotFoundError)
    await expect(source.uploads('UCgone', 'UUgone')).rejects.toBeInstanceOf(YoutubeNotFoundError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(ledger.remaining()).toBe(10_000 - 1)
  })

  it('a 403 on the playlist is not a not-found', async () => {
    const fetchImpl = routedFetch([['/playlistItems?', 'youtube-forbidden-403.json', 403]])
    const { source } = await setup(fetchImpl)
    const err = await source.uploads('UCx', 'UUx').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(YoutubeNotFoundError)
  })
})

describe('mock youtube', () => {
  it('is deterministic, never looks real, and spends nothing', async () => {
    const a = await mockYoutube.search('wirecard')
    const b = await mockYoutube.search('wirecard')
    expect(a).toEqual(b)
    expect(a.videos.map((v) => v.title)).toEqual([
      '[mock] wirecard video 1',
      '[mock] wirecard video 2',
      '[mock] wirecard video 3',
    ])
    expect(a.videos.every((v) => v.channelId.startsWith('UCmock'))).toBe(true)
    const ch = await mockYoutube.channelByHandle('@x')
    expect(ch.uploadsPlaylistId).toBe(uploadsPlaylistId(ch.channelId))
    const up = await mockYoutube.uploads(ch.channelId, ch.uploadsPlaylistId)
    expect(up.channelId).toBe(ch.channelId)
    expect(up.uploads.length).toBeGreaterThan(0)
    expect(up.complete).toBe(true)
    expect(up.fetchedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('mock uploads are newest first and honour until and maxPages', async () => {
    const all = await mockYoutube.uploads('UCmockx', 'UUmockx')
    const dates = all.uploads.map((v) => v.publishedAt)
    expect(dates).toEqual([...dates].sort().reverse())
    expect(all.uploads.length).toBeGreaterThan(50)

    const one = await mockYoutube.uploads('UCmockx', 'UUmockx', { maxPages: 1 })
    expect(one.uploads).toEqual(all.uploads.slice(0, 50))
    expect(one.complete).toBe(false)

    // The eleventh upload sits on the first page, so asking back to it reads one page.
    const until = all.uploads[10]!.publishedAt
    const reached = await mockYoutube.uploads('UCmockx', 'UUmockx', { until })
    expect(reached.uploads).toEqual(all.uploads.slice(0, 50))
    expect(reached.complete).toBe(false)
    expect(reached.fetchedOn).toBe(all.fetchedOn)
  })
})
