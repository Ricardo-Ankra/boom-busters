import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
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

  it('retries a 503 once, then throws', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => json({}, 503))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const outcome = client
      .getJson('https://api.example.com/x?key=SECRET', schema)
      .catch((e: Error) => e)
    await vi.advanceTimersByTimeAsync(1000)
    const err = (await outcome) as Error
    expect(err.message).toMatch(/api\.example\.com\/x.*503/)
    expect(err.message).not.toContain('SECRET')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries once on a network error', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const result = client.getJson('https://api.example.com/x', schema)
    await vi.advanceTimersByTimeAsync(1000)
    expect((await result).data).toEqual({ ok: true })
  })

  it('waits for Retry-After on a 429 and retries once', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '3' }))
      .mockResolvedValueOnce(json({ ok: true }))
    const client = createPoliteClient({ contact: 'me@example.com', cacheDir: null, fetchImpl })
    const result = client.getJson('https://api.example.com/x', schema)
    await vi.advanceTimersByTimeAsync(2900)
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
})
