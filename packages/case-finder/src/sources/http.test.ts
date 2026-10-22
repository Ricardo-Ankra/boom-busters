import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createPoliteClient } from './http'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

const okFetch = () =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => json({ ok: true }))

const schema = z.object({ ok: z.boolean() })
const dirs: string[] = []
const tmp = async () => {
  const d = await mkdtemp(path.join(tmpdir(), 'cf-http-'))
  dirs.push(d)
  return d
}

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })))
})

describe('polite client', () => {
  it('sends the contact in the User-Agent', async () => {
    const fetchImpl = okFetch()
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    await client.getJson('https://api.example.com/x', schema)
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(
      'boom-busters-case-finder/1.0 (+me@example.com)',
    )
  })

  it('a second identical call is served from cache with fromCache true and no fetch', async () => {
    const cacheDir = await tmp()
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createPoliteClient({
      contact: 'me@example.com',
      cacheDir,
      fetchImpl,
      now: () => new Date('2026-10-20T10:00:00Z'),
    })
    const first = await client.getJson('https://api.example.com/x?a=1', schema)
    const second = await client.getJson('https://api.example.com/x?a=1', schema)
    expect(first.fromCache).toBe(false)
    expect(second).toEqual({ data: { ok: true }, fetchedAt: '2026-10-20', fromCache: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('noStore fetches and returns without writing the body to the cache', async () => {
    const cacheDir = await tmp()
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
    const first = await client.getJson('https://api.example.com/big', schema, { noStore: true })
    expect(first).toMatchObject({ data: { ok: true }, fromCache: false })
    const text = await client.getText('https://api.example.com/big', { noStore: true })
    expect(text.data).toBe('{"ok":true}')
    expect(await readdir(cacheDir)).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('refetches an entry older than maxAgeDays', async () => {
    const cacheDir = await tmp()
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    let day = 1
    const client = createPoliteClient({
      contact: 'me@example.com',
      cacheDir,
      fetchImpl,
      now: () => new Date(Date.UTC(2026, 9, day)),
    })
    const url = 'https://api.example.com/x'
    await client.getJson(url, schema, { maxAgeDays: 3 })
    day = 3
    expect((await client.getJson(url, schema, { maxAgeDays: 3 })).fromCache).toBe(true)
    day = 6
    expect((await client.getJson(url, schema, { maxAgeDays: 3 })).fromCache).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('the API key is stripped from the cache key', async () => {
    const cacheDir = await tmp()
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
    await client.getJson('https://www.googleapis.com/youtube/v3/videos?id=1&key=SECRET-ONE', schema)
    const second = await client.getJson(
      'https://www.googleapis.com/youtube/v3/videos?id=1&key=SECRET-TWO',
      schema,
    )
    expect(second.fromCache).toBe(true)
    const hostDir = path.join(cacheDir, 'www.googleapis.com')
    const files = await readdir(hostDir)
    expect(files).toHaveLength(1)
    const content = await readFile(path.join(hostDir, files[0]!), 'utf8')
    expect(content).not.toContain('SECRET')
  })

  it('never writes an Authorization header to disk', async () => {
    const cacheDir = await tmp()
    const fetchImpl = okFetch()
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
    await client.getJson('https://www.courtlistener.com/api/x', schema, {
      headers: { Authorization: 'Token TOPSECRET' },
    })
    const hostDir = path.join(cacheDir, 'www.courtlistener.com')
    const files = await readdir(hostDir)
    const content = await readFile(path.join(hostDir, files[0]!), 'utf8')
    expect(content).not.toContain('TOPSECRET')
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Token TOPSECRET')
  })

  it('spaces calls to the same host by minIntervalMs', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    await client.getJson('https://www.wikidata.org/a', schema)
    const second = client.getJson('https://www.wikidata.org/b', schema)
    await vi.advanceTimersByTimeAsync(900)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    await second
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('matches a host by suffix and lets options override the defaults', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createPoliteClient({
      contact: 'me@example.com',
      cacheDir: null,
      fetchImpl,
      minIntervalMs: { 'sec.gov': 500 },
    })
    await client.getJson('https://data.sec.gov/a', schema)
    const second = client.getJson('https://data.sec.gov/b', schema)
    await vi.advanceTimersByTimeAsync(400)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    await second
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('a persistent 503 is retried six times, then thrown with the URL redacted', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => json({}, 503))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const outcome = client
      .getJson('https://api.example.com/x?key=SECRET', schema)
      .catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(275_000)
    const err = (await outcome) as Error
    expect(err.message).toMatch(/api\.example\.com\/x.*503/)
    expect(err.message).not.toContain('SECRET')
    expect(fetchImpl).toHaveBeenCalledTimes(7)
  })

  it('a network error then a 200 succeeds after a 5 s wait', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const result = client.getJson('https://api.example.com/x', schema)
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).data).toEqual({ ok: true })
  })

  it('a Retry-After under the 5 s floor still waits 5 s on a 429', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const result = client.getJson('https://api.example.com/x', schema)
    await vi.advanceTimersByTimeAsync(4900)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect((await result).data).toEqual({ ok: true })
  })

  it('a 404 is returned for getText with status 404 and not retried', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const result = await client.getText('https://api.example.com/missing')
    expect(result.status).toBe(404)
    expect(result.data).toBe('nope')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('getJson throws on a 404 naming the URL without secrets', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const err = await client
      .getJson('https://api.example.com/missing?token=SECRET&q=1', schema)
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('api.example.com/missing')
    expect((err as Error).message).toContain('404')
    expect((err as Error).message).not.toContain('SECRET')
  })

  it('a schema failure throws naming the URL without secrets', async () => {
    const fetchImpl = vi.fn(async () => json({ nope: 1 }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const err = await client
      .getJson('https://api.example.com/x?api_key=SECRET', schema)
      .catch((e: Error) => e)
    expect((err as Error).message).toContain('api.example.com/x')
    expect((err as Error).message).not.toContain('SECRET')
  })

  it.each([
    'https://api.example.com/x?key=AAA&token=BBB&id=1',
    'https://api.example.com/x?id=1&key=AAA&apikey=BBB&q=2',
    'https://api.example.com/x?ID=1&KEY=AAA&Api_Key=BBB',
  ])('strips adjacent secrets from the cache key, file and error: %s', async (url) => {
    const cacheDir = await tmp()
    // A body that fails the schema is never cached, so the cache file comes from a valid one.
    const failing = createPoliteClient({
      contact: 'me@example.com',
      cacheDir: null,
      fetchImpl: vi.fn(async () => json({ nope: 1 })),
    })
    const err = (await failing.getJson(url, schema).catch((e: Error) => e)) as Error
    expect(err.message).not.toMatch(/AAA|BBB/)
    const fetchImpl = vi.fn(async () => json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
    await client.getJson(url, schema)
    const files = await readdir(path.join(cacheDir, 'api.example.com'))
    const content = await readFile(path.join(cacheDir, 'api.example.com', files[0]!), 'utf8')
    expect(content).not.toMatch(/AAA|BBB/)
    // the same call with different secrets shares the cache entry
    const other = url.replace('AAA', 'CCC').replace('BBB', 'DDD')
    expect((await client.getText(other)).fromCache).toBe(true)
    // an explicit cacheKey is redacted too
    await client.getText('https://api.example.com/y', { cacheKey: 'k?key=AAA&token=BBB&n=1' })
    expect(
      (
        await client.getText('https://api.example.com/z', {
          cacheKey: 'k?key=CCC&token=DDD&n=1',
        })
      ).fromCache,
    ).toBe(true)
  })

  it('a 429 without Retry-After waits 5 s before the retry', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const result = client.getJson('https://api.example.com/x', schema)
    await vi.advanceTimersByTimeAsync(4900)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    expect((await result).data).toEqual({ ok: true })
  })

  it('a 429 with an empty Retry-After waits 5 s too', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '' }))
      .mockResolvedValueOnce(json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const result = client.getJson('https://api.example.com/x', schema)
    await vi.advanceTimersByTimeAsync(4900)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(100)
    await result
  })

  describe('rate limiting (R17)', () => {
    const url = 'https://api.example.com/x'
    const make = (fetchImpl: typeof fetch, extra: object = {}) =>
      createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl, ...extra })
    const sequence = (...statuses: number[]) => {
      const queue = [...statuses]
      return vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => {
        const status = queue.shift() ?? 200
        return status === 200 ? json({ ok: true }) : json({}, status)
      })
    }

    it('a 429 then a 200 succeeds after a 5 s wait', async () => {
      vi.useFakeTimers()
      const fetchImpl = sequence(429, 200)
      const result = make(fetchImpl).getJson(url, schema)
      await vi.advanceTimersByTimeAsync(4999)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await result).data).toEqual({ ok: true })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('three 429s then a 200 wait 5, 10 and 20 s', async () => {
      vi.useFakeTimers()
      const fetchImpl = sequence(429, 429, 429, 200)
      const result = make(fetchImpl).getJson(url, schema)
      for (const [wait, calls] of [
        [5000, 2],
        [10_000, 3],
        [20_000, 4],
      ] as const) {
        await vi.advanceTimersByTimeAsync(wait - 1)
        expect(fetchImpl).toHaveBeenCalledTimes(calls - 1)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchImpl).toHaveBeenCalledTimes(calls)
      }
      expect((await result).data).toEqual({ ok: true })
    })

    it('a Retry-After of 30 on the first 429 waits 30 s', async () => {
      vi.useFakeTimers()
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '30' }))
        .mockResolvedValueOnce(json({ ok: true }))
      const result = make(fetchImpl).getJson(url, schema)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await result).data).toEqual({ ok: true })
    })

    it('seven 429s give up after six retries, waiting 5, 10, 20, 40, 80 and 120 s', async () => {
      vi.useFakeTimers()
      const fetchImpl = sequence(429, 429, 429, 429, 429, 429, 429)
      const outcome = make(fetchImpl)
        .getText(`${url}?key=SECRET`)
        .then((r) => r.status)
      await vi.advanceTimersByTimeAsync(274_999)
      expect(fetchImpl).toHaveBeenCalledTimes(6)
      await vi.advanceTimersByTimeAsync(1)
      expect(await outcome).toBe(429)
      expect(fetchImpl).toHaveBeenCalledTimes(7)
    })

    it('getJson names the redacted URL when the last retry is still a 429', async () => {
      vi.useFakeTimers()
      const fetchImpl = sequence(429, 429, 429, 429, 429, 429, 429)
      const outcome = make(fetchImpl)
        .getJson(`${url}?key=SECRET`, schema)
        .catch((e: Error) => e)
      await vi.advanceTimersByTimeAsync(275_000)
      const err = (await outcome) as Error
      expect(err.message).toMatch(/api\.example\.com\/x.*429/)
      expect(err.message).not.toContain('SECRET')
    })

    it('a 429 is never cached', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      const cacheDir = await tmp()
      const fetchImpl = sequence(429, 429, 429, 429, 429, 429, 429)
      const client = make(fetchImpl, { cacheDir })
      const outcome = client.getText(url)
      // the cache read is real disk I/O: let it finish before the fake clock moves
      while (fetchImpl.mock.calls.length === 0) await new Promise((r) => setImmediate(r))
      await vi.advanceTimersByTimeAsync(275_000)
      expect((await outcome).status).toBe(429)
      expect(await client.isCached(url)).toBe(false)
    })

    it('doubles the host spacing after a 429: 0 ms goes to 250 ms', async () => {
      vi.useFakeTimers()
      const fetchImpl = sequence(429, 200, 200)
      const client = make(fetchImpl)
      const first = client.getJson(url, schema)
      await vi.advanceTimersByTimeAsync(5000)
      await first
      const second = client.getJson('https://api.example.com/y', schema)
      await vi.advanceTimersByTimeAsync(249)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      await second
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('caps the doubled spacing at 2 s', async () => {
      vi.useFakeTimers()
      const fetchImpl = sequence(429, 200, 200)
      const client = make(fetchImpl, { minIntervalMs: { 'example.com': 1500 } })
      const first = client.getJson(url, schema)
      await vi.advanceTimersByTimeAsync(5000)
      await first
      const second = client.getJson('https://api.example.com/y', schema)
      await vi.advanceTimersByTimeAsync(1999)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      await second
      expect(fetchImpl).toHaveBeenCalledTimes(3)
    })

    it('reports each backoff through onBackoff', async () => {
      vi.useFakeTimers()
      const onBackoff = vi.fn()
      const result = make(sequence(429, 429, 200), { onBackoff }).getJson(url, schema)
      await vi.advanceTimersByTimeAsync(15_000)
      await result
      expect(onBackoff.mock.calls).toEqual([
        ['api.example.com', 5000],
        ['api.example.com', 10_000],
      ])
    })

    it('five 503s then a 200 wait 5, 10, 20, 40 and 80 s', async () => {
      vi.useFakeTimers()
      const fetchImpl = sequence(503, 503, 503, 503, 503, 200)
      const result = make(fetchImpl).getJson(url, schema)
      let calls = 1
      for (const wait of [5000, 10_000, 20_000, 40_000, 80_000]) {
        await vi.advanceTimersByTimeAsync(wait - 1)
        expect(fetchImpl).toHaveBeenCalledTimes(calls)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchImpl).toHaveBeenCalledTimes(++calls)
      }
      expect((await result).data).toEqual({ ok: true })
    })

    it('a Retry-After on a 503 is honoured', async () => {
      vi.useFakeTimers()
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(json({}, 503, { 'Retry-After': '30' }))
        .mockResolvedValueOnce(json({ ok: true }))
      const result = make(fetchImpl).getJson(url, schema)
      await vi.advanceTimersByTimeAsync(29_999)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await result).data).toEqual({ ok: true })
    })

    it('seven network errors give up after six retries and rethrow', async () => {
      vi.useFakeTimers()
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
      const outcome = make(fetchImpl)
        .getText(url)
        .catch((e: Error) => e)
      await vi.advanceTimersByTimeAsync(274_999)
      expect(fetchImpl).toHaveBeenCalledTimes(6)
      await vi.advanceTimersByTimeAsync(1)
      expect(((await outcome) as Error).message).toBe('fetch failed')
      expect(fetchImpl).toHaveBeenCalledTimes(7)
    })

    it('a body read that fails mid-response is retried like a network error', async () => {
      vi.useFakeTimers()
      const broken = {
        status: 200,
        headers: new Headers(),
        text: () => Promise.reject(new TypeError('terminated')),
      }
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(broken)
        .mockResolvedValueOnce(json({ ok: true }))
      const result = make(fetchImpl).getJson(url, schema)
      await vi.advanceTimersByTimeAsync(4999)
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect((await result).data).toEqual({ ok: true })
    })

    it('an AbortError, or any error that is not a TypeError, surfaces at once', async () => {
      const abort = new DOMException('aborted', 'AbortError')
      const first = vi.fn().mockRejectedValue(abort)
      await expect(make(first).getText(url)).rejects.toBe(abort)
      expect(first).toHaveBeenCalledTimes(1)
      const other = vi.fn().mockRejectedValue(new Error('boom'))
      await expect(make(other).getText(url)).rejects.toThrow('boom')
      expect(other).toHaveBeenCalledTimes(1)
    })

    it('network errors and 5xx do not slow the host, and are reported through onBackoff', async () => {
      vi.useFakeTimers()
      const onBackoff = vi.fn()
      const fetchImpl = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(json({}, 503))
        .mockImplementation(async () => json({ ok: true }))
      const client = make(fetchImpl, { onBackoff })
      const first = client.getJson(url, schema)
      await vi.advanceTimersByTimeAsync(15_000)
      await first
      expect(onBackoff.mock.calls).toEqual([
        ['api.example.com', 5000],
        ['api.example.com', 10_000],
      ])
      const second = client.getJson('https://api.example.com/y', schema)
      await vi.advanceTimersByTimeAsync(0)
      await second
      expect(fetchImpl).toHaveBeenCalledTimes(4)
    })
  })

  it('caches a 404 but not a 403', async () => {
    const cacheDir = await tmp()
    const answers = new Map([
      ['https://api.example.com/gone', 404],
      ['https://api.example.com/denied', 403],
    ])
    const fetchImpl = vi.fn(
      async (url: string | URL | Request) =>
        new Response('x', { status: answers.get(String(url)) }),
    )
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
    await client.getText('https://api.example.com/gone')
    expect((await client.getText('https://api.example.com/gone')).fromCache).toBe(true)
    await client.getText('https://api.example.com/denied')
    expect((await client.getText('https://api.example.com/denied')).fromCache).toBe(false)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('isCached is true only for a settled, fresh entry, and never fetches', async () => {
    const cacheDir = await tmp()
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('/denied') ? new Response('x', { status: 403 }) : json({ ok: true }),
    )
    let day = 1
    const client = createPoliteClient({
      contact: 'me@example.com',
      cacheDir,
      fetchImpl,
      now: () => new Date(Date.UTC(2026, 9, day)),
    })
    const ok = 'https://api.example.com/ok?key=SECRET'
    expect(await client.isCached(ok)).toBe(false)
    await client.getJson(ok, schema)
    await client.getText('https://api.example.com/denied')
    expect(await client.isCached(ok)).toBe(true)
    expect(await client.isCached('https://api.example.com/ok?key=OTHER')).toBe(true)
    expect(await client.isCached('https://api.example.com/denied')).toBe(false)
    day = 6
    expect(await client.isCached(ok, { maxAgeDays: 3 })).toBe(false)
    expect(await client.isCached(ok)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const noCache = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    expect(await noCache.isCached(ok)).toBe(false)
  })

  describe('a body that does not validate is never cached', () => {
    const url = 'https://api.example.com/q?key=SECRET'
    const truncated = () => new Response('{"ok": tru', { status: 200 })

    it('getJson: a 200 with truncated JSON throws and writes nothing, so the next call fetches again', async () => {
      const cacheDir = await tmp()
      const fetchImpl = vi.fn(async () => truncated())
      const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
      await expect(client.getJson(url, schema)).rejects.toThrow(
        'GET https://api.example.com/q did not return JSON',
      )
      expect(await readdir(cacheDir)).toEqual([])
      await expect(client.getJson(url, schema)).rejects.toThrow('did not return JSON')
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('getJson: a 200 of the wrong shape is not cached either', async () => {
      const cacheDir = await tmp()
      const fetchImpl = vi.fn(async () => json({ nope: 1 }))
      const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
      await expect(client.getJson(url, schema)).rejects.toThrow('unexpected shape')
      expect(await readdir(cacheDir)).toEqual([])
    })

    it('getJson: a poisoned cache file is a miss, refetched and overwritten by a valid body', async () => {
      const cacheDir = await tmp()
      const bad = createPoliteClient({
        contact: 'me@example.com',
        cacheDir,
        fetchImpl: vi.fn(async () => json({ ok: true })),
      })
      await bad.getJson(url, schema)
      const [host] = await readdir(cacheDir)
      const [file] = await readdir(path.join(cacheDir, host!))
      const full = path.join(cacheDir, host!, file!)
      await writeFile(
        full,
        JSON.stringify({ fetchedAt: '2026-10-01', status: 200, body: '{"ok": tru' }),
      )
      const fetchImpl = vi.fn(async () => json({ ok: true }))
      const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
      const result = await client.getJson(url, schema)
      expect(result).toMatchObject({ data: { ok: true }, fromCache: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
      expect(JSON.parse(await readFile(full, 'utf8')).body).toBe('{"ok":true}')
    })

    it('getJson: a poisoned cache file stays in place when the fresh body is bad too', async () => {
      const cacheDir = await tmp()
      const seed = createPoliteClient({
        contact: 'me@example.com',
        cacheDir,
        fetchImpl: vi.fn(async () => json({ ok: true })),
      })
      await seed.getJson(url, schema)
      const [host] = await readdir(cacheDir)
      const [file] = await readdir(path.join(cacheDir, host!))
      const full = path.join(cacheDir, host!, file!)
      const poisoned = JSON.stringify({ fetchedAt: '2026-10-01', status: 200, body: 'oops' })
      await writeFile(full, poisoned)
      const client = createPoliteClient({
        contact: 'me@example.com',
        cacheDir,
        fetchImpl: vi.fn(async () => truncated()),
      })
      await expect(client.getJson(url, schema)).rejects.toThrow('did not return JSON')
      expect(await readFile(full, 'utf8')).toBe(poisoned)
    })

    it('getText with accept: a rejected 2xx body throws "unusable response" and caches nothing', async () => {
      const cacheDir = await tmp()
      const fetchImpl = vi.fn(async () => truncated())
      const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
      const accept = (body: string) => body.endsWith('}')
      await expect(client.getText(url, { accept })).rejects.toThrow(
        'GET https://api.example.com/q unusable response',
      )
      expect(await readdir(cacheDir)).toEqual([])
      expect(await client.isCached(url, { accept })).toBe(false)
    })

    it('getText with accept: a cached entry it rejects is a miss, and isCached agrees', async () => {
      const cacheDir = await tmp()
      const first = createPoliteClient({
        contact: 'me@example.com',
        cacheDir,
        fetchImpl: vi.fn(async () => new Response('plain', { status: 200 })),
      })
      await first.getText(url)
      const accept = (body: string) => body.startsWith('{')
      expect(await first.isCached(url)).toBe(true)
      expect(await first.isCached(url, { accept })).toBe(false)
      const fetchImpl = vi.fn(async () => json({ ok: true }))
      const client = createPoliteClient({ contact: 'me@example.com', cacheDir, fetchImpl })
      const res = await client.getText(url, { accept })
      expect(res).toMatchObject({ data: '{"ok":true}', fromCache: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('getText with accept: a non-2xx body is returned as before, accept is not asked', async () => {
      const fetchImpl = vi.fn(async () => new Response('gone', { status: 404 }))
      const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
      const res = await client.getText(url, { accept: () => false })
      expect(res).toMatchObject({ data: 'gone', status: 404 })
    })
  })
})
