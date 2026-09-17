import { ValidationError } from '@boom-busters/schemas'
import type { ArticleField, FieldProvenance } from '@boom-busters/schemas'
import { extractArticle } from './extract'
import type { ExtractedArticle } from './extract'
import { assertSafeArticleUrl, MAX_REDIRECT_HOPS } from './safe-url'
import type { UrlGuardOptions } from './safe-url'

/**
 * Reading one cited article (decision 257).
 *
 * A plain GET of a page a human already cited, once, cached forever. Honest
 * user agent, no cookies, no browser spoofing: if a publisher does not want to
 * tell us who wrote the piece, the answer is to type it on the board, not to
 * pretend to be Chrome.
 *
 * Everything here is about not hanging and not over-reading. Eight seconds,
 * five redirect hops with the guard re-run on each, and the body abandoned at
 * `</head>`, because the metadata is in the head and article pages are
 * routinely several megabytes of everything else.
 */

/** Honest, and the same shape the Wikimedia adapter uses. */
const USER_AGENT = 'boom-busters/1.0 (single-user production console)'

const TIMEOUT_MS = 8_000
const RETRY_AFTER_MS = 1_000
/** Enough head for any publisher, and a hard stop for pages with none. */
export const BODY_CAP_BYTES = 512 * 1024

const ARCHIVE_LOOKUP = 'https://archive.org/wayback/available?url='

export interface ArticleFetchOptions extends UrlGuardOptions {
  /** Injected by tests and by the mock; nothing here calls global fetch directly. */
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Off in tests that are not about the fallback. Default on. */
  archiveFallback?: boolean
}

export interface FetchedArticle extends ExtractedArticle {
  /** True when the metadata came from a Wayback snapshot, not the live page. */
  archived: boolean
}

export interface ArticleProvider {
  fetchMetadata(url: string, options?: ArticleFetchOptions): Promise<FetchedArticle>
}

function refuse(message: string): never {
  throw new ValidationError(message, { field: 'article.url' })
}

/** Read only as far as the head, and never more than the cap. */
async function readHead(response: Response): Promise<string> {
  const body = response.body
  if (!body) return await response.text()

  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8')
  let html = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      html += decoder.decode(value, { stream: true })
      if (html.includes('</head>') || bytes >= BODY_CAP_BYTES) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return html
}

function htmlResponse(response: Response): boolean {
  const type = response.headers.get('content-type')?.toLowerCase() ?? ''
  return type.includes('text/html') || type.includes('application/xhtml+xml')
}

/**
 * One GET, following redirects by hand so the guard runs on every hop: a
 * public hostname is free to redirect at an address the first check refused.
 */
async function getPage(
  url: string,
  options: ArticleFetchOptions,
): Promise<{ html: string; finalUrl: string }> {
  const call = options.fetchImpl ?? fetch
  let target = (await assertSafeArticleUrl(url, options)).toString()

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await call(target, {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html, application/xhtml+xml' },
      referrerPolicy: 'no-referrer',
      signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null) refuse(`The publisher redirected to nowhere (${response.status})`)
      target = (
        await assertSafeArticleUrl(new URL(location, target).toString(), options)
      ).toString()
      continue
    }

    if (!response.ok) {
      refuse(`The publisher returned ${response.status}`)
    }
    if (!htmlResponse(response)) {
      refuse(
        `The address answered with ${response.headers.get('content-type') ?? 'no content type'}, not a web page`,
      )
    }
    return { html: await readHead(response), finalUrl: target }
  }

  refuse(`The address redirected more than ${MAX_REDIRECT_HOPS} times`)
}

/** Retried once, and only for the failures that are about the network. */
async function getPageWithRetry(
  url: string,
  options: ArticleFetchOptions,
): Promise<{ html: string; finalUrl: string }> {
  try {
    return await getPage(url, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A 403, a 404 or a 429 is an answer. Only a broken connection or a
    // publisher having a bad minute is worth asking twice.
    const worthRetrying = !(error instanceof ValidationError) || /returned 5\d\d/.test(message)
    if (!worthRetrying) throw error
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS))
    return await getPage(url, options)
  }
}

/** The Wayback Machine's own index. Keyless, and the answer is one URL. */
async function archivedCopy(url: string, options: ArticleFetchOptions): Promise<string | null> {
  const call = options.fetchImpl ?? fetch
  try {
    const response = await call(`${ARCHIVE_LOOKUP}${encodeURIComponent(url)}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      archived_snapshots?: { closest?: { available?: boolean; url?: string } }
    }
    const closest = body.archived_snapshots?.closest
    if (closest?.available !== true || typeof closest.url !== 'string') return null
    // Snapshots are indexed over http; the guard would rather they were not.
    return closest.url.replace(/^http:\/\//, 'https://')
  } catch {
    return null
  }
}

function markArchived(article: ExtractedArticle): FetchedArticle {
  const provenance: Partial<Record<ArticleField, FieldProvenance>> = {}
  for (const field of Object.keys(article.provenance) as ArticleField[]) {
    provenance[field] = 'archive'
  }
  return { ...article, provenance, archived: true }
}

export const liveArticleProvider: ArticleProvider = {
  async fetchMetadata(url, options = {}) {
    try {
      const { html, finalUrl } = await getPageWithRetry(url, options)
      return { ...extractArticle(html, finalUrl), archived: false }
    } catch (error) {
      if (options.archiveFallback === false) throw error

      // The page is gone, paywalled or hostile. The Wayback Machine holds a
      // great deal of the reporting this channel cites, and its snapshot
      // carries the publisher's own metadata as it stood.
      const snapshot = await archivedCopy(url, options)
      if (snapshot === null) throw error
      try {
        const { html } = await getPageWithRetry(snapshot, {
          ...options,
          archiveFallback: false,
        })
        return markArchived(extractArticle(html, url))
      } catch {
        throw error
      }
    }
  },
}
