import { z } from 'zod'

/**
 * A real post shown on screen as a card (decision 284).
 *
 * The social shot type quotes what someone said in public: a name, a handle,
 * the post's own words and the day it was posted. None of those may be
 * written by a model, for the same reason the headline card's byline is
 * never invented: a fabricated quotation attached to a real account is a
 * false statement about a real person. So every string here comes from X's
 * own public reader, or from the owner typing it, and `provenance` records
 * which.
 *
 * Keyed by the post's normalised address, never by the handle (ruling 1):
 * the id in that address does not change when an account renames or a handle
 * is typed in a different case, so one post is one row however it is
 * referenced.
 */

export const SOCIAL_PLATFORMS = ['x'] as const
export const SocialPlatformSchema = z.enum(SOCIAL_PLATFORMS)
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>

export const POST_FIELDS = ['authorName', 'handle', 'text', 'postedAt'] as const
export const PostFieldSchema = z.enum(POST_FIELDS)
export type PostField = z.infer<typeof PostFieldSchema>

/** `oembed` is what X's public reader declared, `manual` is what the owner typed. */
export const POST_PROVENANCES = ['oembed', 'manual'] as const
export const PostProvenanceSchema = z.enum(POST_PROVENANCES)
export type PostProvenance = z.infer<typeof PostProvenanceSchema>

/**
 * `fetched` is what the reader gave up, `manual` is what the owner typed, and
 * `failed` is a post the reader would not give its words up (deleted,
 * protected, suspended). A failed record is stored rather than discarded so
 * the board can say what went wrong instead of re-trying on every render of
 * the page.
 */
export const POST_STATUSES = ['fetched', 'manual', 'failed'] as const
export const PostStatusSchema = z.enum(POST_STATUSES)
export type PostStatus = z.infer<typeof PostStatusSchema>

export const SocialPostRecordSchema = z.object({
  /** `https://x.com/i/status/<id>`: the primary key (ruling 1). */
  url: z.string().min(1),
  platform: SocialPlatformSchema,
  postId: z.string().regex(/^\d{1,20}$/),
  /** As X shows it, case kept, no `@`. From the address until the reader says otherwise. */
  handle: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,15}$/)
    .nullable(),
  authorName: z.string().trim().min(1).max(120).nullable(),
  /** Verbatim. Never truncated: an excerpt is a separate, visible choice. */
  text: z.string().min(1).max(25000).nullable(),
  postedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  endedWithMediaLink: z.boolean(),
  provenance: z.partialRecord(PostFieldSchema, PostProvenanceSchema).default({}),
  status: PostStatusSchema,
  failureReason: z.string().trim().min(1).max(400).nullable(),
})
export type SocialPostRecord = z.infer<typeof SocialPostRecordSchema>

// ---------------------------------------------------------------------------
// The post address
// ---------------------------------------------------------------------------

const POST_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com'])

const POST_ID_RE = /^\d{1,20}$/
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/

/**
 * The post id and, when the address carries one, the handle. Null for
 * anything that is not an X status address.
 *
 * Strips a trailing `/photo/<n>` or `/video/<n>` before matching, so the
 * media-tab links X hands out fold to the same post as the plain one. The
 * handle keeps its case: `normalisePostUrl` is the one that throws it away.
 */
export function parsePostUrl(raw: string): { postId: string; handle: string | null } | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (!POST_HOSTS.has(host)) return null

  const segments = parsed.pathname.split('/').filter((segment) => segment !== '')
  const last = segments[segments.length - 1]
  const secondLast = segments[segments.length - 2]
  if (secondLast !== undefined && /^(photo|video)$/.test(secondLast) && /^\d+$/.test(last ?? '')) {
    segments.length -= 2
  }

  if (
    segments.length === 4 &&
    segments[0] === 'i' &&
    segments[1] === 'web' &&
    segments[2] === 'status'
  ) {
    const postId = segments[3] ?? ''
    return POST_ID_RE.test(postId) ? { postId, handle: null } : null
  }
  if (segments.length === 3 && segments[0] === 'i' && segments[1] === 'status') {
    const postId = segments[2] ?? ''
    return POST_ID_RE.test(postId) ? { postId, handle: null } : null
  }
  if (segments.length === 3 && segments[1] === 'status') {
    const handle = segments[0] ?? ''
    const postId = segments[2] ?? ''
    if (handle === 'i' || !HANDLE_RE.test(handle) || !POST_ID_RE.test(postId)) return null
    return { postId, handle }
  }
  return null
}

/** `https://x.com/i/status/<id>` or null. */
export function normalisePostUrl(raw: string): string | null {
  const parsed = parsePostUrl(raw)
  return parsed === null ? null : `https://x.com/i/status/${parsed.postId}`
}

/** `https://x.com/<handle>/status/<id>`, or the `/i/status/` form when the handle is unknown. */
export function postPublicUrl(record: Pick<SocialPostRecord, 'handle' | 'postId'>): string {
  return record.handle === null
    ? `https://x.com/i/status/${record.postId}`
    : `https://x.com/${record.handle}/status/${record.postId}`
}

// ---------------------------------------------------------------------------
// What the card needs
// ---------------------------------------------------------------------------

/** In the card's words: 'the name', 'the handle', 'the text', 'the date'. */
export function missingPostFields(
  record: Pick<SocialPostRecord, 'authorName' | 'handle' | 'text' | 'postedAt'>,
): string[] {
  return [
    record.authorName === null ? 'the name' : null,
    record.handle === null ? 'the handle' : null,
    record.text === null ? 'the text' : null,
    record.postedAt === null ? 'the date' : null,
  ].filter((field): field is string => field !== null)
}

export function postIsRenderable(record: SocialPostRecord): boolean {
  return missingPostFields(record).length === 0
}

/** True when the claim's sourceUrl is an X post address, whatever its sourceType. */
export function claimCarriesPost(claim: { sourceUrl?: string | null } | undefined): boolean {
  if (!claim) return false
  if (typeof claim.sourceUrl !== 'string' || claim.sourceUrl.trim() === '') return false
  return normalisePostUrl(claim.sourceUrl) !== null
}

// ---------------------------------------------------------------------------
// The card's text
// ---------------------------------------------------------------------------

/** Whitespace as the renderer sees it: any run of blanks is one space. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** First letters of the first two words, upper case, at most 3 characters; '?' for an empty name. */
export function postInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3)
}

/** Whitespace-collapsed substring test, the rule `emphasisFits` uses. */
export function phraseIn(text: string, phrase: string): boolean {
  const collapsedPhrase = collapse(phrase)
  if (collapsedPhrase === '') return false
  return collapse(text).includes(collapsedPhrase)
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u

/**
 * Where a word-for-word excerpt sits in the text, whitespace collapsed.
 * Null when the excerpt is not in the text, or only in it cut through a
 * word: "ever resign" is inside "I will never resign" as letters, but a card
 * showing it would put words in the author's mouth. So the excerpt must
 * start at the text's start or after whitespace, and end at the text's end
 * or before anything that is not a letter or digit (a trailing comma or full
 * stop is fine). The highlight keeps `phraseIn`'s plain substring test.
 */
export function excerptPlacement(
  text: string,
  excerpt: string,
): { cutBefore: boolean; cutAfter: boolean } | null {
  const collapsedText = collapse(text)
  const phrase = collapse(excerpt)
  if (phrase === '') return null
  for (
    let at = collapsedText.indexOf(phrase);
    at !== -1;
    at = collapsedText.indexOf(phrase, at + 1)
  ) {
    const end = at + phrase.length
    const before = collapsedText[at - 1]
    const after = collapsedText[end]
    const startsOnWord = before === undefined || /\s/.test(before)
    const endsOnWord = after === undefined || !WORD_CHARACTER.test(after)
    if (startsOnWord && endsOnWord) {
      return { cutBefore: at > 0, cutAfter: end < collapsedText.length }
    }
  }
  return null
}

export const NOT_A_POST_ERROR =
  'That is not a link to a post. Paste the address of the post itself (x.com/…/status/…).'
export const POST_MEDIA_ONLY_REASON =
  'This post has no words, only its image. Type what it says, or choose another shot.'
