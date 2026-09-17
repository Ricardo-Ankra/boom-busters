import { z } from 'zod'

/**
 * A cited news article, as the app knows it (decision 257).
 *
 * The headline shot type shows an outlet, a headline, a byline and a
 * publication date. None of those may be written by a model: a fabricated
 * headline in a card that looks like evidence is a false statement attributed
 * to a real publication, and a wrong byline attaches a real journalist to
 * whatever the edit implies. So every string here comes from the article's own
 * declared metadata, or from the owner typing it, and each one records which.
 *
 * Keyed by URL rather than by slot, because an article's byline and date are
 * fixed the moment it is published: one article can back several claims,
 * several shots and several films, and fetching it twice is waste.
 */

/**
 * Where a field came from, strongest first.
 *
 * `jsonld` is the publisher's own structured record of the article and beats
 * `og`, which is its social-sharing copy (they disagree more often than you
 * would think: "$1.9 billion" against "$1.9bn"). `domain` means the outlet
 * name was guessed from the hostname, which the board marks as a guess.
 */
export const FIELD_PROVENANCES = [
  'jsonld',
  'og',
  'meta',
  'title',
  'domain',
  'archive',
  'manual',
] as const
export const FieldProvenanceSchema = z.enum(FIELD_PROVENANCES)
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>

export const ARTICLE_FIELDS = [
  'outlet',
  'headline',
  'author',
  'publishedAt',
  'description',
] as const
export const ArticleFieldSchema = z.enum(ARTICLE_FIELDS)
export type ArticleField = z.infer<typeof ArticleFieldSchema>

/**
 * `fetched` is what the page declared, `manual` is what the owner typed, and
 * `failed` is a page that would not give its metadata up (a paywall, a consent
 * wall, a dead link). A failed record is stored rather than discarded so the
 * board can say what went wrong instead of re-trying on every render of the
 * page.
 */
export const ARTICLE_STATUSES = ['fetched', 'manual', 'failed'] as const
export const ArticleStatusSchema = z.enum(ARTICLE_STATUSES)
export type ArticleStatus = z.infer<typeof ArticleStatusSchema>

/** Day precision: the card shows a date, never a time. */
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD date')

export const ArticleMetadataSchema = z.object({
  /** The normalised URL. Primary key of the store, and the audit trail. */
  url: z.string().min(1),
  outlet: z.string().trim().min(1).max(120).nullable(),
  /** Verbatim as published. Never truncated: trimming a quotation misquotes it. */
  headline: z.string().trim().min(1).max(400).nullable(),
  /** Absent is a real answer. A wire story has no byline. */
  author: z.string().trim().min(1).max(200).nullable(),
  publishedAt: IsoDate.nullable(),
  /** The standfirst. Stored always, rendered only when the brief asks for it. */
  description: z.string().trim().min(1).max(400).nullable(),
  provenance: z.partialRecord(ArticleFieldSchema, FieldProvenanceSchema).default({}),
  status: ArticleStatusSchema,
  failureReason: z.string().trim().min(1).max(400).nullable(),
})
export type ArticleMetadata = z.infer<typeof ArticleMetadataSchema>

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/**
 * Parameters that identify a referral rather than an article. Dropped so that
 * the same piece shared three ways is one row, and so the card's printed
 * source is the address a reader would type.
 */
const TRACKING_PARAMS =
  /^(utm_.*|fbclid|gclid|mc_[ce]id|igshid|ref|ref_src|s|__twitter_impression)$/i

/**
 * One row per article.
 *
 * Lowercases the scheme and host, drops `www.`, the fragment and tracking
 * parameters, and drops a trailing slash. Path case is preserved: plenty of
 * publishers serve case-sensitive paths. Returns null for anything that is not
 * an http(s) URL, which is the same test the dossier applies to a claim's
 * source.
 */
export function normaliseArticleUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.hostname === '') return null

  parsed.hash = ''
  parsed.username = ''
  parsed.password = ''
  parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')

  const kept = [...parsed.searchParams.entries()].filter(([key]) => !TRACKING_PARAMS.test(key))
  // Rebuilt rather than deleted in place: deleting while iterating skips keys.
  parsed.search = ''
  for (const [key, value] of kept) parsed.searchParams.append(key, value)

  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : ''
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`
}

/** How much of the source line the card can carry before it stops being readable. */
const SOURCE_LABEL_MAX = 48

/**
 * What the card prints bottom right: the address without its scheme, elided in
 * the middle when it is long, because the end of a news URL (the slug) says
 * more about which article this is than the middle does.
 */
export function articleSourceLabel(url: string): string {
  const bare = url.replace(/^https?:\/\//, '')
  if (bare.length <= SOURCE_LABEL_MAX) return bare
  const head = bare.slice(0, SOURCE_LABEL_MAX - 22)
  const tail = bare.slice(-18)
  return `${head}...${tail}`
}

// ---------------------------------------------------------------------------
// The highlighted phrase
// ---------------------------------------------------------------------------

/**
 * Money, a percentage, or a plain figure, with the scale word that belongs to
 * it. Ordered so that a currency amount wins over the bare number inside it.
 */
const FIGURE_PATTERNS: RegExp[] = [
  /[$£€¥]\s?\d[\d,.]*\s?(?:trillion|billion|million|thousand|bn|tn|[mk])?\b/i,
  /\d[\d,.]*\s?(?:per cent|percent|%)/i,
  /\d[\d,.]*\s?(?:trillion|billion|million|thousand|bn|tn)\b/i,
  /\b\d{1,3}(?:,\d{3})+\b/,
]

/**
 * The phrase the marker should draw under, suggested rather than decided.
 *
 * `emphasis` cannot be planned: at plan time nobody knows the headline yet. A
 * model call to choose it would be a paid round trip to underline a number, so
 * this is a heuristic instead, and the owner overrides it in a text field. In
 * this channel's material the figure in the headline is almost always the
 * thing the narration is leaning on.
 *
 * Null is a fine answer. A card with no highlight is a good card.
 */
export function suggestEmphasis(headline: string): string | null {
  const text = headline.trim()
  if (text === '') return null

  let best: { at: number; hit: string } | null = null
  for (const pattern of FIGURE_PATTERNS) {
    const found = pattern.exec(text)
    if (!found) continue
    const hit = found[0].trim()
    if (
      best === null ||
      found.index < best.at ||
      (found.index === best.at && hit.length > best.hit.length)
    ) {
      best = { at: found.index, hit }
    }
  }
  return best?.hit ?? null
}

/** Whitespace as the renderer sees it: any run of blanks is one space. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Whether the marker can be drawn. The card highlights a span of the headline
 * it is already showing, so an emphasis that is not in the headline is dropped
 * rather than approximated: a highlight over words the publication did not
 * print is the same kind of error as a wrong byline, only smaller.
 */
export function emphasisFits(headline: string, emphasis: string): boolean {
  const phrase = collapse(emphasis)
  if (phrase === '') return false
  return collapse(headline).includes(phrase)
}

/**
 * Whether there is enough here to put on screen.
 *
 * The author is deliberately not required: plenty of reporting carries no
 * byline, and a card that refuses to render without one would send the owner
 * to invent a name. Outlet, headline and date are the claim the card makes.
 */
export function articleIsRenderable(meta: ArticleMetadata): boolean {
  return meta.outlet !== null && meta.headline !== null && meta.publishedAt !== null
}
