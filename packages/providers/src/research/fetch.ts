import { DOCUMENT_BODY_CAP_BYTES, ValidationError } from '@boom-busters/schemas'
import { assertSafeArticleUrl, MAX_REDIRECT_HOPS, USER_AGENT } from '../article'
import type { UrlGuardOptions } from '../article'

/**
 * Fetching one gathered document (dossier research).
 *
 * The same posture as the article reader: an honest user agent, the URL guard
 * on every hop, eight seconds. The differences are that the body is read in
 * full up to a byte cap rather than stopping at `</head>`, and that a bad page
 * is a recorded failure on the document, never a thrown error, so one dead
 * link cannot stop a corpus from being gathered.
 */

const TIMEOUT_MS = 8_000
const ARCHIVE_LOOKUP = 'https://archive.org/wayback/available?url='

export interface FetchedDocument {
  url: string
  finalUrl: string | null
  httpStatus: number | null
  contentType: string | null
  body: Uint8Array | null
  archivedUrl: string | null
  failure: string | null
}

export interface FetchDocumentOptions extends UrlGuardOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  archiveFallback?: boolean
  maxBytes?: number
}

interface Attempt {
  finalUrl: string | null
  httpStatus: number | null
  contentType: string | null
  body: Uint8Array | null
  failure: string | null
  /** The URL guard said no. A snapshot of a refused address is still that address's content. */
  refused?: boolean
}

function timeoutSignal(external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  return external ? AbortSignal.any([external, timeout]) : timeout
}

/** Stops reading the moment the cap is crossed, so a hostile body costs one cap, not all of it. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array | 'too large'> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    return 'too large'
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer())

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) return 'too large'
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

/** One GET, redirects followed by hand so the guard runs on every hop. */
async function attempt(
  url: string,
  options: FetchDocumentOptions,
  maxBytes: number,
): Promise<Attempt> {
  const call = options.fetchImpl ?? fetch
  const empty: Attempt = {
    finalUrl: null,
    httpStatus: null,
    contentType: null,
    body: null,
    failure: null,
  }

  try {
    let target = (await assertSafeArticleUrl(url, options)).toString()

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
      const response = await call(target, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        referrerPolicy: 'no-referrer',
        signal: timeoutSignal(options.signal),
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => undefined)
        if (location === null) {
          return {
            ...empty,
            finalUrl: target,
            httpStatus: response.status,
            failure: `redirected to nowhere (${response.status})`,
          }
        }
        target = (
          await assertSafeArticleUrl(new URL(location, target).toString(), options)
        ).toString()
        continue
      }

      const contentType = response.headers.get('content-type')
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return {
          ...empty,
          finalUrl: target,
          httpStatus: response.status,
          contentType,
          failure: `returned ${response.status}`,
        }
      }

      const body = await readCapped(response, maxBytes)
      if (body === 'too large') {
        return {
          ...empty,
          finalUrl: target,
          httpStatus: response.status,
          contentType,
          failure: 'too large',
        }
      }
      return { finalUrl: target, httpStatus: response.status, contentType, body, failure: null }
    }
    return { ...empty, failure: `redirected more than ${MAX_REDIRECT_HOPS} times` }
  } catch (error) {
    return {
      ...empty,
      failure: error instanceof Error ? error.message : String(error),
      refused: error instanceof ValidationError,
    }
  }
}

function toDocument(url: string, archivedUrl: string | null, found: Attempt): FetchedDocument {
  return {
    url,
    finalUrl: found.finalUrl,
    httpStatus: found.httpStatus,
    contentType: found.contentType,
    body: found.body,
    archivedUrl,
    failure: found.failure,
  }
}

/** The Wayback Machine's index: keyless, and the answer is one URL. */
async function archivedCopy(url: string, options: FetchDocumentOptions): Promise<string | null> {
  const call = options.fetchImpl ?? fetch
  try {
    const response = await call(`${ARCHIVE_LOOKUP}${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: timeoutSignal(options.signal),
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } }
    }
    const closest = body.archived_snapshots?.closest
    if (closest?.available !== true || typeof closest.url !== 'string') return null
    // Snapshots are indexed over http; upgrade so the fetch stays on https.
    return closest.url.replace(/^http:\/\//, 'https://')
  } catch {
    return null
  }
}

export async function fetchDocument(
  url: string,
  options: FetchDocumentOptions = {},
): Promise<FetchedDocument> {
  if (url.trim() === '') {
    throw new ValidationError('A document needs a url', { field: 'document.url' })
  }
  const maxBytes = options.maxBytes ?? DOCUMENT_BODY_CAP_BYTES
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new ValidationError('maxBytes must be a positive number', { field: 'document.maxBytes' })
  }

  const live = await attempt(url, options, maxBytes)
  if (live.failure === null) return toDocument(url, null, live)

  // Too large is an answer about the page, not about our reach: a snapshot of
  // the same page would be the same size. A refused address stays refused.
  if (options.archiveFallback === false || live.failure === 'too large' || live.refused === true) {
    return toDocument(url, null, live)
  }

  const snapshot = await archivedCopy(url, options)
  if (snapshot === null) return toDocument(url, null, live)
  const archived = await attempt(snapshot, options, maxBytes)
  if (archived.failure !== null) return toDocument(url, null, live)
  return toDocument(url, snapshot, archived)
}
