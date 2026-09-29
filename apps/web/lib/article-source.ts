import 'server-only'

import { getArticleSource, getClaim, recordArticleSource } from '@boom-busters/db'
import type { ArticleSourceRow } from '@boom-busters/db'
import {
  ArticleMetadataSchema,
  FRONT_PAGE_REASON,
  isFrontPage,
  normaliseArticleUrl,
} from '@boom-busters/schemas'
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
  // A front page has no headline to read (decision 280): its title is the
  // site's tagline, which a card would quote as if an outlet had published it.
  if (isFrontPage(url)) return storeFailure(url, FRONT_PAGE_REASON)
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
    return storeFailure(url, reason)
  }
}

async function storeFailure(url: string, reason: string): Promise<ArticleMetadata> {
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
  // A front page read before decision 280 kept its tagline as a headline; it
  // is answered again now, as the failure it always was.
  if (stored && stored.status !== 'failed' && !(stored.status === 'fetched' && isFrontPage(url))) {
    return articleFromRow(stored)
  }

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
