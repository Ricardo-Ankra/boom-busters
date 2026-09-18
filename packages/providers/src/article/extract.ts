import { parse } from 'node-html-parser'
import type { ArticleField, FieldProvenance } from '@boom-busters/schemas'

/**
 * Reading an article's own declared metadata (decision 257).
 *
 * Pure: HTML in, five strings out, with a note of where each came from. The
 * fetch, the cache and the board all sit elsewhere, so this can be tested
 * against saved heads until every publisher habit is covered.
 *
 * Two rules are worth stating out loud, because both are tempting to break.
 *
 * **JSON-LD beats Open Graph.** The `NewsArticle` block is the publisher's
 * structured record of the piece; `og:title` is its social-sharing copy, and
 * they disagree more often than you would expect ("$1.9 billion" against
 * "$1.9bn", a byline dropped for length).
 *
 * **`dateModified` is never promoted to the publication date.** It sits right
 * next to `datePublished` in almost every JSON-LD block, and using it would
 * put 2024 on screen for a piece written in 2019. If there is no publication
 * date, there is no date, and the board asks for one.
 */

export interface ExtractedArticle {
  outlet: string | null
  headline: string | null
  author: string | null
  /** YYYY-MM-DD. Day precision, because the card shows a date. */
  publishedAt: string | null
  description: string | null
  provenance: Partial<Record<ArticleField, FieldProvenance>>
}

/** A headline longer than this is not a headline; the board flags it. */
const HEADLINE_MAX = 400
const OUTLET_MAX = 120
const AUTHOR_MAX = 200
const DESCRIPTION_MAX = 400

const ARTICLE_TYPES = new Set([
  'article',
  'newsarticle',
  'reportagenewsarticle',
  'analysisnewsarticle',
  'backgroundnewsarticle',
  'opinionnewsarticle',
  'reviewnewsarticle',
  'blogposting',
  'liveblogposting',
])

interface Head {
  meta: Map<string, string>
  title: string | null
  jsonld: Record<string, unknown>[]
}

/** `&amp;` and friends. The parser leaves attribute values encoded. */
function decode(text: string): string {
  return text
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
        ndash: '–',
        mdash: '—',
        lsquo: '‘',
        rsquo: '’',
        ldquo: '“',
        rdquo: '”',
        hellip: '…',
        pound: '£',
        euro: '€',
      }
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      }
      if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
      return named[entity.toLowerCase()] ?? whole
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = decode(value)
  if (text === '' || text.length > max) return null
  return text
}

function readHead(html: string): Head {
  const root = parse(html, { comment: false })
  const meta = new Map<string, string>()

  for (const tag of root.querySelectorAll('meta')) {
    const key =
      tag.getAttribute('property') ?? tag.getAttribute('name') ?? tag.getAttribute('itemprop')
    const value = tag.getAttribute('content')
    if (key === undefined || value === undefined) continue
    const lower = key.toLowerCase()
    // First wins: publishers repeat og:title inside article bodies.
    if (!meta.has(lower)) meta.set(lower, value)
  }

  const jsonld: Record<string, unknown>[] = []
  for (const script of root.querySelectorAll('script')) {
    const type = script.getAttribute('type')?.toLowerCase()
    if (type !== 'application/ld+json') continue
    try {
      collectJsonLd(JSON.parse(script.rawText) as unknown, jsonld)
    } catch {
      // A malformed block is one publisher's bug, not a reason to give up on
      // the other sources on the page.
    }
  }

  const title = root.querySelector('title')?.rawText ?? null
  return { meta, title, jsonld }
}

/** JSON-LD arrives as an object, an array, or an `@graph` of both. */
function collectJsonLd(node: unknown, into: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const entry of node) collectJsonLd(entry, into)
    return
  }
  if (node === null || typeof node !== 'object') return
  const record = node as Record<string, unknown>
  into.push(record)
  if ('@graph' in record) collectJsonLd(record['@graph'], into)
}

function articleNode(blocks: readonly Record<string, unknown>[]): Record<string, unknown> | null {
  for (const block of blocks) {
    const type = block['@type']
    const types = Array.isArray(type) ? type : [type]
    if (types.some((one) => typeof one === 'string' && ARTICLE_TYPES.has(one.toLowerCase()))) {
      return block
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** "Elena Marsh", ["Elena Marsh", "Tom Reid"], {name: "..."}, or a URL. */
function readAuthor(value: unknown): string | null {
  const names: string[] = []
  const push = (node: unknown): void => {
    if (typeof node === 'string') {
      const text = decode(node)
      // `article:author` is a profile URL as often as it is a name.
      if (text !== '' && !/^https?:\/\//i.test(text)) names.push(text)
      return
    }
    if (Array.isArray(node)) {
      for (const entry of node) push(entry)
      return
    }
    if (node !== null && typeof node === 'object') push((node as Record<string, unknown>)['name'])
  }
  push(value)

  const unique = [...new Set(names.map((name) => name.replace(/^by\s+/i, '').trim()))].filter(
    (name) => name !== '',
  )
  if (unique.length === 0) return null
  if (unique.length === 1) return unique[0] as string
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique[0]} and others`
}

/** Publishers write dates every way ISO 8601 allows, and a few it does not. */
function readDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null

  const stamp = Date.parse(text)
  if (Number.isNaN(stamp)) return null

  const when = new Date(stamp)
  const year = when.getUTCFullYear()
  // A date before the press or after tomorrow is a parse that went wrong.
  if (year < 1900 || stamp > Date.now() + 24 * 60 * 60 * 1000) return null

  const month = String(when.getUTCMonth() + 1).padStart(2, '0')
  const day = String(when.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** The registrable-ish domain, title-cased: the outlet fallback, and a guess. */
function outletFromDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    const parts = host.split('.')
    // "news.bbc.co.uk" to "bbc": drop the public suffix and any leading label.
    const suffixes = parts.length > 2 && (parts.at(-2) ?? '').length <= 3 ? 2 : 1
    const name = parts[Math.max(0, parts.length - suffixes - 1)]
    if (name === undefined || name === '') return null
    return name.charAt(0).toUpperCase() + name.slice(1)
  } catch {
    return null
  }
}

/** `<title>` carries the masthead; the card shows it once, in its own place. */
function stripSiteSuffix(title: string, outlet: string | null): string {
  if (outlet === null) return title
  const escaped = outlet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return title.replace(new RegExp(`\\s*[|–—-]\\s*${escaped}\\s*$`, 'i'), '').trim()
}

/**
 * Read what the page declares about itself. `url` is used only for the outlet
 * fallback, and never to invent any other field.
 */
export function extractArticle(html: string, url: string): ExtractedArticle {
  const head = readHead(html)
  const ld = articleNode(head.jsonld)
  const provenance: Partial<Record<ArticleField, FieldProvenance>> = {}

  const take = <T>(
    field: ArticleField,
    sources: readonly (readonly [FieldProvenance, () => T | null])[],
  ): T | null => {
    for (const [from, read] of sources) {
      const value = read()
      if (value === null || value === undefined) continue
      provenance[field] = from
      return value
    }
    return null
  }

  const publisher = ld?.['publisher']
  const outlet = take<string>('outlet', [
    [
      'jsonld',
      () =>
        clean(
          publisher !== null && typeof publisher === 'object'
            ? (publisher as Record<string, unknown>)['name']
            : publisher,
          OUTLET_MAX,
        ),
    ],
    ['og', () => clean(head.meta.get('og:site_name'), OUTLET_MAX)],
    ['meta', () => clean(head.meta.get('application-name'), OUTLET_MAX)],
    ['domain', () => outletFromDomain(url)],
  ])

  const headline = take<string>('headline', [
    ['jsonld', () => clean(ld?.['headline'], HEADLINE_MAX)],
    ['og', () => clean(head.meta.get('og:title'), HEADLINE_MAX)],
    ['meta', () => clean(head.meta.get('twitter:title'), HEADLINE_MAX)],
    [
      'title',
      () => {
        const title = clean(head.title, HEADLINE_MAX)
        if (title === null) return null
        const trimmed = stripSiteSuffix(title, outlet)
        return trimmed === '' ? null : trimmed
      },
    ],
  ])

  const author = take<string>('author', [
    ['jsonld', () => readAuthor(ld?.['author'])],
    ['meta', () => clean(readAuthor(head.meta.get('author')), AUTHOR_MAX)],
    ['meta', () => clean(readAuthor(head.meta.get('article:author')), AUTHOR_MAX)],
  ])

  const publishedAt = take<string>('publishedAt', [
    ['jsonld', () => readDate(ld?.['datePublished'])],
    ['og', () => readDate(head.meta.get('article:published_time'))],
    ['meta', () => readDate(head.meta.get('date'))],
    ['meta', () => readDate(head.meta.get('dc.date.issued'))],
    ['meta', () => readDate(head.meta.get('datepublished'))],
  ])

  const description = take<string>('description', [
    ['jsonld', () => clean(ld?.['description'], DESCRIPTION_MAX)],
    ['og', () => clean(head.meta.get('og:description'), DESCRIPTION_MAX)],
  ])

  return { outlet, headline, author, publishedAt, description, provenance }
}
