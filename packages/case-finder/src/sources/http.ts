import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { z } from 'zod'
import type { IsoDate } from '../types'

/**
 * The one HTTP door for every case-finder data source. It identifies us with a
 * contact address (Wikimedia and the SEC both require that), spaces calls per
 * host, retries once, and keeps a disk cache so a back-test re-run costs no
 * requests and no quota.
 *
 * Secrets stay out of everything we keep: query-string keys are stripped from
 * cache keys, file contents and error messages, and request headers (the
 * CourtListener `Authorization` token) are never written or logged.
 */

export interface PoliteClientOptions {
  /** DATA_CONTACT_EMAIL, sent in the User-Agent. */
  contact: string
  /** null = no disk cache (tests). */
  cacheDir: string | null
  fetchImpl?: typeof fetch
  /** Minimum gap between calls, by host suffix. Merged over the defaults. */
  minIntervalMs?: Record<string, number>
  now?: () => Date
}

export interface RequestInitLite {
  headers?: Record<string, string>
  cacheKey?: string
  /** A cached entry older than this is refetched. Default: never expires. */
  maxAgeDays?: number
}

export interface PoliteClient {
  getJson<T>(
    url: string,
    schema: z.ZodType<T>,
    init?: RequestInitLite,
  ): Promise<{ data: T; fetchedAt: IsoDate; fromCache: boolean }>
  getText(
    url: string,
    init?: RequestInitLite,
  ): Promise<{ data: string; fetchedAt: IsoDate; fromCache: boolean; status: number }>
}

const DEFAULT_INTERVALS: Record<string, number> = {
  'wikimedia.org': 50,
  'wikipedia.org': 50,
  'wikidata.org': 1000,
  'sec.gov': 120,
  'courtlistener.com': 800,
  'googleapis.com': 0,
}

const SECRET_PARAMS = ['key', 'token', 'api_key', 'apikey']
const RETRY_DELAY_MS = 1000
const RETRY_AFTER_CAP_MS = 60_000
const DAY_MS = 86_400_000

/**
 * Drop every secret query parameter from a URL or a free-form cache key,
 * keeping the rest in order. Works on the raw string so a key that is not a
 * full URL is handled the same way.
 */
function redact(value: string): string {
  const q = value.indexOf('?')
  if (q === -1) return value
  const hashAt = value.indexOf('#', q)
  const query = value.slice(q + 1, hashAt === -1 ? undefined : hashAt)
  const tail = hashAt === -1 ? '' : value.slice(hashAt)
  const kept = query.split('&').filter((pair) => {
    if (pair === '') return false
    let name = pair.split('=')[0] ?? ''
    try {
      name = decodeURIComponent(name)
    } catch {
      // keep the raw name
    }
    return !SECRET_PARAMS.includes(name.toLowerCase())
  })
  return value.slice(0, q) + (kept.length > 0 ? `?${kept.join('&')}` : '') + tail
}

/** Retry-After in ms: seconds or an HTTP date; missing, empty or unparseable is 1 s. */
function retryAfterMs(header: string | null): number {
  const text = header?.trim() ?? ''
  if (text === '') return RETRY_DELAY_MS
  const seconds = Number(text)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : RETRY_DELAY_MS
  const date = Date.parse(text)
  return Number.isNaN(date) ? RETRY_DELAY_MS : Math.max(0, date - Date.now())
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface CacheEntry {
  fetchedAt: IsoDate
  status: number
  body: string
}

interface RawResult extends CacheEntry {
  fromCache: boolean
}

export function createPoliteClient(options: PoliteClientOptions): PoliteClient {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date())
  const intervals = { ...DEFAULT_INTERVALS, ...options.minIntervalMs }
  const userAgent = `boom-busters-case-finder/1.0 (+${options.contact})`
  const nextSlot = new Map<string, number>()

  const intervalFor = (host: string): number => {
    const match = Object.keys(intervals)
      .filter((suffix) => host === suffix || host.endsWith(`.${suffix}`))
      .sort((a, b) => b.length - a.length)[0]
    return match === undefined ? 0 : (intervals[match] ?? 0)
  }

  /** Reserve the next slot for this host synchronously, then wait for it. */
  async function waitForSlot(host: string): Promise<void> {
    const interval = intervalFor(host)
    const at = Math.max(Date.now(), nextSlot.get(host) ?? 0)
    nextSlot.set(host, at + interval)
    const wait = at - Date.now()
    if (wait > 0) await sleep(wait)
  }

  async function attempt(
    url: string,
    host: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    await waitForSlot(host)
    return fetchImpl(url, { headers: { 'User-Agent': userAgent, ...headers } })
  }

  /** One request with the retry policy; the final response is returned whatever its status. */
  async function request(
    url: string,
    host: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    let res: Response
    try {
      res = await attempt(url, host, headers)
    } catch {
      await sleep(RETRY_DELAY_MS)
      res = await attempt(url, host, headers)
      return { status: res.status, body: await res.text() }
    }
    if (res.status === 429) {
      await sleep(Math.min(retryAfterMs(res.headers.get('Retry-After')), RETRY_AFTER_CAP_MS))
      res = await attempt(url, host, headers)
    } else if (res.status >= 500) {
      await sleep(RETRY_DELAY_MS)
      res = await attempt(url, host, headers)
    }
    return { status: res.status, body: await res.text() }
  }

  async function readCache(
    file: string,
    maxAgeDays: number | undefined,
  ): Promise<CacheEntry | null> {
    let entry: CacheEntry
    try {
      entry = JSON.parse(await readFile(file, 'utf8')) as CacheEntry
    } catch {
      return null
    }
    if (maxAgeDays !== undefined) {
      const ageDays =
        (Date.parse(now().toISOString().slice(0, 10)) - Date.parse(entry.fetchedAt)) / DAY_MS
      if (ageDays > maxAgeDays) return null
    }
    return entry
  }

  async function raw(url: string, init: RequestInitLite = {}): Promise<RawResult> {
    const host = new URL(url).host
    const file =
      options.cacheDir === null
        ? null
        : path.join(
            options.cacheDir,
            host,
            `${createHash('sha1')
              .update(redact(init.cacheKey ?? url))
              .digest('hex')}.json`,
          )

    if (file !== null) {
      const hit = await readCache(file, init.maxAgeDays)
      if (hit) return { ...hit, fromCache: true }
    }

    const { status, body } = await request(url, host, init.headers ?? {})
    const entry: CacheEntry = { fetchedAt: now().toISOString().slice(0, 10), status, body }
    // Only a settled answer is remembered: success, or the page is gone (404, 410).
    // Auth, rate-limit, timeout and server errors are transient and never cached.
    const settled = (status >= 200 && status < 300) || status === 404 || status === 410
    if (file !== null && settled) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(entry))
    }
    return { ...entry, fromCache: false }
  }

  return {
    async getJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInitLite) {
      const safeUrl = redact(url)
      const result = await raw(url, init)
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`GET ${safeUrl} failed with status ${result.status}`)
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(result.body)
      } catch {
        throw new Error(`GET ${safeUrl} did not return JSON`)
      }
      const checked = schema.safeParse(parsed)
      if (!checked.success) {
        throw new Error(`GET ${safeUrl} returned an unexpected shape: ${checked.error.message}`)
      }
      return { data: checked.data, fetchedAt: result.fetchedAt, fromCache: result.fromCache }
    },
    async getText(url: string, init?: RequestInitLite) {
      const result = await raw(url, init)
      return {
        data: result.body,
        fetchedAt: result.fetchedAt,
        fromCache: result.fromCache,
        status: result.status,
      }
    },
  }
}
