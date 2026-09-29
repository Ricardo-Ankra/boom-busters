import { ValidationError } from '@boom-busters/schemas'
import { USER_AGENT } from '../article/fetch'
import { parseXOembed } from './parse'
import type { ParsedXPost } from './parse'

/**
 * Reading one X post through its public oEmbed endpoint (decision 284).
 *
 * Mirrors the article fetcher (decision 257): the fetch is injected so tests
 * never reach the network, one retry covers a provider having a bad minute,
 * and an answer (404, 403) is never retried because retrying would not
 * change it.
 */

export const X_OEMBED_ENDPOINT = 'https://publish.x.com/oembed'
export const X_POST_MISSING = 'X says this post does not exist or is not public.'
export const X_UNREACHABLE = 'X did not answer. Try Read again, or type the details.'
export const X_UNREADABLE =
  'X answered, but not with a post this app can read. Try Read again later, or type the details.'

const TIMEOUT_MS = 10_000
const RETRY_AFTER_MS = 1_000

export interface SocialFetchOptions {
  /** Injected by tests and by the mock; nothing here calls global fetch directly. */
  fetchImpl?: typeof fetch
  signal?: AbortSignal
}

export interface SocialProvider {
  /** Throws ValidationError whose message is the owner-facing reason. */
  fetchPost(publicUrl: string, options?: SocialFetchOptions): Promise<ParsedXPost>
}

function refuse(message: string): never {
  throw new ValidationError(message, { field: 'social.postUrl' })
}

async function getOembed(publicUrl: string, options: SocialFetchOptions): Promise<ParsedXPost> {
  const call = options.fetchImpl ?? fetch
  const endpoint = `${X_OEMBED_ENDPOINT}?url=${encodeURIComponent(publicUrl)}&omit_script=1&dnt=true`

  const response = await call(endpoint, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: options.signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })

  // Deleted, protected or suspended: X answered, and asking again will not
  // change what it says.
  if (response.status === 404 || response.status === 403) refuse(X_POST_MISSING)
  if (!response.ok) throw new Error(`X returned ${response.status}`)

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('X answered with something other than JSON')
  }

  // A 200 this app cannot read a name or any words from is a refusal, not a
  // post with every field blank: stored as fetched, all nulls would wipe the
  // fields of a post that was read well before (spec 7.3). A media-only post
  // still has its name, so it is not caught here.
  const parsed = parseXOembed(body)
  if (parsed.authorName === null && parsed.text === null) refuse(X_UNREADABLE)
  return parsed
}

/** Retried once, and only for the failures that are about the network. */
async function getOembedWithRetry(
  publicUrl: string,
  options: SocialFetchOptions,
): Promise<ParsedXPost> {
  try {
    return await getOembed(publicUrl, options)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS))
    try {
      return await getOembed(publicUrl, options)
    } catch {
      refuse(X_UNREACHABLE)
    }
  }
}

export const liveSocialProvider: SocialProvider = {
  fetchPost(publicUrl, options = {}) {
    return getOembedWithRetry(publicUrl, options)
  },
}
