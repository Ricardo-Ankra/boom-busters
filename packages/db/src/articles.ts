import { inArray, sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { ArticleMetadata } from '@boom-busters/schemas'
import type { Database } from './client'
import { articleSources } from './schema'
import type { ArticleSourceRow } from './schema'

/**
 * The article metadata store (decision 257).
 *
 * One row per cited article, keyed by its normalised URL. Two rules live here
 * rather than in the caller, because both are about not losing information:
 *
 *  - **A fetch never overwrites a correction.** A row the owner has typed is
 *    `manual`, and `recordArticleSource` leaves it alone. Automation fills
 *    blanks; it does not argue with a human. Same instinct as
 *    `setMusicBedDuration`, for a bigger reason: the manual value is usually
 *    the one that got typed because the page refused to say.
 *  - **A failure is stored, not discarded.** A paywall is a fact about the
 *    article, and keeping it means the board can say what went wrong instead
 *    of re-fetching on every page load.
 */

export async function getArticleSource(
  db: Database,
  url: string,
): Promise<ArticleSourceRow | undefined> {
  const [row] = await db.select().from(articleSources).where(eq(articleSources.url, url)).limit(1)
  return row
}

export async function getArticleSources(
  db: Database,
  urls: readonly string[],
): Promise<ArticleSourceRow[]> {
  if (urls.length === 0) return []
  return db
    .select()
    .from(articleSources)
    .where(inArray(articleSources.url, [...urls]))
}

/**
 * Store what a fetch found. A row the owner has corrected keeps its values:
 * the update is skipped rather than merged, because a half-manual row would
 * leave nobody able to say which fields were checked.
 */
export async function recordArticleSource(
  db: Database,
  meta: ArticleMetadata,
): Promise<ArticleSourceRow> {
  const values = {
    url: meta.url,
    outlet: meta.outlet,
    headline: meta.headline,
    author: meta.author,
    publishedAt: meta.publishedAt,
    description: meta.description,
    provenance: meta.provenance as Record<string, string>,
    status: meta.status,
    failureReason: meta.failureReason,
    fetchedAt: new Date(),
  }

  const [row] = await db
    .insert(articleSources)
    .values(values)
    .onConflictDoUpdate({
      target: articleSources.url,
      set: { ...values, updatedAt: new Date() },
      // The one row a fetch may not touch.
      setWhere: sql`${articleSources.status} <> 'manual'`,
    })
    .returning()

  // `setWhere` skipped the update, so nothing came back: the stored manual
  // row is the answer, and the caller wanted the current state either way.
  return row ?? ((await getArticleSource(db, meta.url)) as ArticleSourceRow)
}

/**
 * The owner's corrections, which are final. Writing any field flips the row to
 * `manual`, marks the fields written as manually provenanced, and clears the
 * failure: a record somebody has checked is not a failed fetch any more.
 */
export async function setArticleSourceManual(
  db: Database,
  url: string,
  fields: {
    outlet?: string | null
    headline?: string | null
    author?: string | null
    publishedAt?: string | null
    description?: string | null
  },
): Promise<ArticleSourceRow> {
  const existing = await getArticleSource(db, url)
  const provenance = { ...(existing?.provenance ?? {}) }
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (value === null) delete provenance[key]
    else provenance[key] = 'manual'
  }

  /** An absent field is untouched; an explicit null CLEARS it. */
  const written = <K extends keyof typeof fields>(key: K): string | null =>
    fields[key] === undefined ? (existing?.[key] ?? null) : fields[key]

  const values = {
    url,
    outlet: written('outlet'),
    headline: written('headline'),
    author: written('author'),
    publishedAt: written('publishedAt'),
    description: written('description'),
    provenance,
    status: 'manual' as const,
    failureReason: null,
  }

  const [row] = await db
    .insert(articleSources)
    .values(values)
    .onConflictDoUpdate({
      target: articleSources.url,
      set: { ...values, updatedAt: new Date() },
    })
    .returning()
  return row as ArticleSourceRow
}
