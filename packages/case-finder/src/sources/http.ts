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
  /**
   * Fetch and return without writing the body to the cache, for a large reply
   * the caller keeps a small extract of instead (a revision's raw wikitext).
   */
  noStore?: boolean
  /**
   * getText only: whether a 2xx body is usable. A rejected fresh body throws
   * "unusable response" and is not cached; a rejected cached entry is a miss.
   * A source that reads JSON through getText passes one so a reply cut short
   * (a SPARQL timeout appends a stack trace to a 200) is never remembered.
   */
  accept?: (body: string) => boolean
}

export interface PoliteClient {
  /**
   * True when a settled, fresh cache entry exists, so a caller that pays per
   * request (the YouTube quota) can ask before spending. Never fetches.
   */
  isCached(url: string, init?: RequestInitLite): Promise<boolean>
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

/** An `accept` for a source that reads JSON through getText: the body parses. */
export function isJson(body: string): boolean {
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
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
    usable: (entry: CacheEntry) => boolean,
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
    return usable(entry) ? entry : null
  }

  function cacheFile(url: string, init: RequestInitLite): string | null {
    if (options.cacheDir === null) return null
    return path.join(
      options.cacheDir,
      new URL(url).host,
      `${createHash('sha1')
        .update(redact(init.cacheKey ?? url))
        .digest('hex')}.json`,
    )
  }

  const isSuccess = (status: number) => status >= 200 && status < 300

  /**
   * `check` judges a 2xx body and throws when it is unusable. It runs before
   * anything is written, and on a cache read where a throw means a miss, so a
   * broken answer is neither remembered nor replayed.
   */
  async function raw(
    url: string,
    init: RequestInitLite = {},
    check: (body: string) => void = () => {},
  ): Promise<RawResult> {
    const host = new URL(url).host
    const file = cacheFile(url, init)

    if (file !== null) {
      const hit = await readCache(file, init.maxAgeDays, (entry) => cachedUsable(entry, check))
      if (hit) return { ...hit, fromCache: true }
    }

    const { status, body } = await request(url, host, init.headers ?? {})
    if (isSuccess(status)) check(body)
    const entry: CacheEntry = { fetchedAt: now().toISOString().slice(0, 10), status, body }
    // Only a settled answer is remembered: success, or the page is gone (404, 410).
    // Auth, rate-limit, timeout and server errors are transient and never cached.
    const settled = isSuccess(status) || status === 404 || status === 410
    if (file !== null && settled && init.noStore !== true) {
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(entry))
    }
    return { ...entry, fromCache: false }
  }

  /** A cached 2xx entry is usable when `check` accepts its body; other statuses are never judged. */
  function cachedUsable(entry: CacheEntry, check: (body: string) => void): boolean {
    if (!isSuccess(entry.status)) return true
    try {
      check(entry.body)
      return true
    } catch {
      return false
    }
  }

  const acceptCheck = (url: string, init: RequestInitLite | undefined) => (body: string) => {
    if (init?.accept !== undefined && !init.accept(body)) {
      throw new Error(`GET ${redact(url)} unusable response`)
    }
  }

  return {
    async isCached(url: string, init: RequestInitLite = {}) {
      const file = cacheFile(url, init)
      // Only settled answers are ever written, so any fresh, usable entry counts.
      return (
        file !== null &&
        (await readCache(file, init.maxAgeDays, (e) => cachedUsable(e, acceptCheck(url, init)))) !==
          null
      )
    },
    async getJson<T>(url: string, schema: z.ZodType<T>, init?: RequestInitLite) {
      const safeUrl = redact(url)
      let data: T | undefined
      const check = (body: string) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(body)
        } catch {
          throw new Error(`GET ${safeUrl} did not return JSON`)
        }
        const checked = schema.safeParse(parsed)
        if (!checked.success) {
          throw new Error(`GET ${safeUrl} returned an unexpected shape: ${checked.error.message}`)
        }
        data = checked.data
      }
      const result = await raw(url, init, check)
      if (!isSuccess(result.status)) {
        throw new Error(`GET ${safeUrl} failed with status ${result.status}`)
      }
      return { data: data as T, fetchedAt: result.fetchedAt, fromCache: result.fromCache }
    },
    async getText(url: string, init?: RequestInitLite) {
      const result = await raw(url, init, acceptCheck(url, init))
      return {
        data: result.body,
        fetchedAt: result.fetchedAt,
        fromCache: result.fromCache,
        status: result.status,
      }
    },
  }
}
