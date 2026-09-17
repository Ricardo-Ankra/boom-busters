import 'server-only'

import { getArticleSource, getClaim, recordArticleSource } from '@boom-busters/db'
import type { ArticleSourceRow } from '@boom-busters/db'
import { ArticleMetadataSchema, normaliseArticleUrl } from '@boom-busters/schemas'
import type { ArticleMetadata } from '@boom-busters/schemas'
import { articleProvider } from '@boom-busters/providers'
import { db } from '@/lib/db'

/**
 * Getting an article's metadata, once (decision 257).
 *
 * Read-through cache over `article_sources`: a row that has been fetched, or
 * that the owner has corrected, is the answer. Nothing else re-opens the page,
 * because a published article's byline and date do not change and the fetch is
 * the only part that can fail.
 *
 * A failure is an answer too. It is stored with its reason so the board can
 * say "the publisher returned 403, type these in" rather than retrying on
 * every page load and showing a spinner for a page that will never answer.
 */

/** The DB row as the rest of the app wants it. */
export function articleFromRow(row: ArticleSourceRow): ArticleMetadata {
  return ArticleMetadataSchema.parse({
    url: row.url,
    outlet: row.outlet,
    headline: row.headline,
    author: row.author,
    publishedAt: row.publishedAt,
    description: row.description,
    provenance: row.provenance,
    status: row.status,
    failureReason: row.failureReason,
  })
}

/** Read the page and store what it said, or store why it would not say. */
async function fetchAndStore(url: string): Promise<ArticleMetadata> {
  try {
    const found = await articleProvider().fetchMetadata(url)
    return articleFromRow(
      await recordArticleSource(db, {
        url,
        outlet: found.outlet,
        headline: found.headline,
        author: found.author,
        publishedAt: found.publishedAt,
        description: found.description,
        provenance: found.provenance,
        status: 'fetched',
        failureReason: null,
      }),
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The article could not be read'
    return articleFromRow(
      await recordArticleSource(db, {
        url,
        outlet: null,
        headline: null,
        author: null,
        publishedAt: null,
        description: null,
        provenance: {},
        status: 'failed',
        failureReason: reason.slice(0, 400),
      }),
    )
  }
}

/**
 * The article a headline slot shows, by the claim it cites. Null when the
 * claim is gone or its source URL is not one (both of which the plan-time
 * rules already refuse, so both mean the dossier changed underneath).
 */
export async function articleForClaim(claimId: string): Promise<ArticleMetadata | null> {
  const claim = await getClaim(db, claimId)
  if (!claim?.sourceUrl) return null

  const url = normaliseArticleUrl(claim.sourceUrl)
  if (url === null) return null

  const stored = await getArticleSource(db, url)
  // A failed row is retried: a paywall is permanent, but a timeout is not, and
  // the difference is not worth storing. Re-fetching one page when a slot is
  // resolved again is cheap, and "Re-fetch" on the board is the same path.
  if (stored && stored.status !== 'failed') return articleFromRow(stored)

  return await fetchAndStore(url)
}

/**
 * The board's "Re-fetch" button. Refuses a record the owner has corrected: it
 * would throw away the one version of these facts that somebody checked.
 */
export async function refetchArticle(rawUrl: string): Promise<ArticleMetadata> {
  const url = normaliseArticleUrl(rawUrl)
  if (url === null) throw new Error('That is not a web address')

  const stored = await getArticleSource(db, url)
  if (stored?.status === 'manual') return articleFromRow(stored)

  return await fetchAndStore(url)
}
