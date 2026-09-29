import 'server-only'

import { getSocialPost, recordSocialPost } from '@boom-busters/db'
import {
  normalisePostUrl,
  NOT_A_POST_ERROR,
  parsePostUrl,
  postPublicUrl,
  SocialPostRecordSchema,
} from '@boom-busters/schemas'
import type { PostField, PostProvenance, SocialPostRecord } from '@boom-busters/schemas'
import { socialProvider } from '@boom-busters/providers'
import type { ParsedXPost } from '@boom-busters/providers'
import { db } from '@/lib/db'

/**
 * Getting a post's words, once (decision 284), `article-source.ts`'s twin
 * for a real X post shown on a card.
 *
 * Read-through cache over `social_posts`: a row that has been read, or that
 * the owner has corrected, is the answer. Nothing here re-opens the post,
 * because what X's own reader gives up for a post does not change and the
 * read is the only part that can fail.
 *
 * A failure is an answer too, on a FIRST read. It is stored with its reason
 * so the board can say why rather than reading the same unreachable post on
 * every page load. A re-read of a post that already has an answer is a
 * different case: it must never let a failure erase words that were already
 * there, so it leaves the stored row untouched and hands the reason back.
 */

type Parsed = { postId: string; handle: string | null }

/** Which fields the reader actually answered, each marked `'oembed'`. */
function readerProvenance(found: ParsedXPost): Partial<Record<PostField, PostProvenance>> {
  const provenance: Partial<Record<PostField, PostProvenance>> = {}
  if (found.authorName !== null) provenance.authorName = 'oembed'
  if (found.handle !== null) provenance.handle = 'oembed'
  if (found.text !== null) provenance.text = 'oembed'
  if (found.postedAt !== null) provenance.postedAt = 'oembed'
  return provenance
}

/** Read the post and store what it said. Throws (never stores) when the reader refuses. */
async function readAndRecord(url: string, parsed: Parsed): Promise<SocialPostRecord> {
  const found = await socialProvider().fetchPost(postPublicUrl(parsed))
  return recordSocialPost(
    db,
    SocialPostRecordSchema.parse({
      url,
      platform: 'x',
      postId: parsed.postId,
      // The reader's own answer wins; the address's handle (when the link
      // carried one) survives a reader that could not confirm it.
      handle: found.handle ?? parsed.handle,
      authorName: found.authorName,
      text: found.text,
      postedAt: found.postedAt,
      endedWithMediaLink: found.endedWithMediaLink,
      provenance: readerProvenance(found),
      status: 'fetched',
      failureReason: null,
    }),
  )
}

/** A FIRST read that failed: the address is all there is to go on. */
async function storeFailure(
  url: string,
  parsed: Parsed,
  error: unknown,
): Promise<SocialPostRecord> {
  const reason = error instanceof Error ? error.message : 'The post could not be read'
  return recordSocialPost(
    db,
    SocialPostRecordSchema.parse({
      url,
      platform: 'x',
      postId: parsed.postId,
      handle: parsed.handle,
      authorName: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
      provenance: {},
      status: 'failed',
      failureReason: reason.slice(0, 400),
    }),
  )
}

/**
 * Cached read-through: a stored row wins; otherwise read, store (a failure
 * too), return. Null only for an address that is not a post.
 */
export async function postForUrl(rawUrl: string): Promise<SocialPostRecord | null> {
  const parsed = parsePostUrl(rawUrl)
  if (parsed === null) return null
  const url = normalisePostUrl(rawUrl)
  if (url === null) return null

  const stored = await getSocialPost(db, url)
  if (stored) return stored

  try {
    return await readAndRecord(url, parsed)
  } catch (error) {
    return await storeFailure(url, parsed, error)
  }
}

/**
 * The board's "Read again" button. Always reads; manual fields survive
 * (`recordSocialPost` keeps them). A row that already exists is never wiped
 * by a failed re-read: the failure is thrown instead of stored.
 */
export async function refetchPost(rawUrl: string): Promise<SocialPostRecord> {
  const parsed = parsePostUrl(rawUrl)
  if (parsed === null) throw new Error(NOT_A_POST_ERROR)
  const url = normalisePostUrl(rawUrl)
  if (url === null) throw new Error(NOT_A_POST_ERROR)

  const existing = await getSocialPost(db, url)
  try {
    return await readAndRecord(url, parsed)
  } catch (error) {
    if (existing) throw error
    return await storeFailure(url, parsed, error)
  }
}
