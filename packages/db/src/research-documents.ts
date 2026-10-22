import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { Database } from './client'
import { dossierDocuments, researchDocuments } from './schema'
import type { NewResearchDocument, ResearchDocumentRow } from './schema'

/**
 * Research documents: the pages gathered for a dossier, shared across
 * projects by URL, and each project's link to its own corpus.
 */

export type ResearchDocumentInput = Omit<NewResearchDocument, 'id' | 'createdAt' | 'updatedAt'>

/**
 * Write a fetched page, replacing an earlier fetch of the same URL.
 *
 * The id and `createdAt` survive a refetch, because claim supports and corpus
 * links point at the id; every other column is the newer fetch's.
 */
export async function upsertResearchDocument(
  db: Database,
  input: ResearchDocumentInput,
): Promise<ResearchDocumentRow> {
  const [row] = await db
    .insert(researchDocuments)
    .values(input)
    .onConflictDoUpdate({
      target: researchDocuments.url,
      // Every column but `id` and `createdAt`, written explicitly: Drizzle drops
      // `undefined` keys, so a refetch that omits `failure` would keep a stale one.
      set: {
        url: input.url,
        finalUrl: input.finalUrl ?? null,
        httpStatus: input.httpStatus ?? null,
        fetchedAt: input.fetchedAt,
        contentType: input.contentType ?? null,
        kind: input.kind,
        tier: input.tier,
        title: input.title ?? null,
        publishedAt: input.publishedAt ?? null,
        text: input.text ?? '',
        textHash: input.textHash ?? null,
        tokens: input.tokens ?? 0,
        archivedUrl: input.archivedUrl ?? null,
        truncated: input.truncated ?? false,
        failure: input.failure ?? null,
        meta: input.meta ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()

  return row!
}

export async function getResearchDocuments(
  db: Database,
  ids: readonly string[],
): Promise<ResearchDocumentRow[]> {
  if (ids.length === 0) return []
  return db
    .select()
    .from(researchDocuments)
    .where(inArray(researchDocuments.id, [...ids]))
}

/** Documents already fetched for these URLs. Callers pass normalised URLs. */
export async function findResearchDocumentsByUrl(
  db: Database,
  urls: readonly string[],
): Promise<ResearchDocumentRow[]> {
  if (urls.length === 0) return []
  return db
    .select()
    .from(researchDocuments)
    .where(inArray(researchDocuments.url, [...urls]))
}

/**
 * Replace a project's corpus. A new gather is a new corpus, so the old links
 * go rather than merge; the documents themselves stay, shared by URL.
 */
export async function linkDossierDocuments(
  db: Database,
  projectId: string,
  links: readonly { documentId: string; rank: number | null; tier: number }[],
): Promise<void> {
  // One transaction, so a failed insert cannot leave the project with no corpus.
  await db.transaction(async (tx) => {
    await tx.delete(dossierDocuments).where(eq(dossierDocuments.projectId, projectId))

    if (links.length === 0) return

    await tx.insert(dossierDocuments).values(
      links.map((link) => ({
        projectId,
        documentId: link.documentId,
        rank: link.rank,
        tier: link.tier,
      })),
    )
  })
}

/** A corpus row without its text: what the review screen and the reviser's count need. */
export interface DossierDocumentSummary {
  id: string
  url: string
  title: string | null
  kind: ResearchDocumentRow['kind']
  rank: number | null
  tier: number
  failure: string | null
  archivedUrl: string | null
}

/**
 * A project's corpus in the order of `listDossierDocuments`, leaving out the
 * text: a corpus can run to megabytes, and the review page renders on every
 * request.
 */
export async function listDossierDocumentSummaries(
  db: Database,
  projectId: string,
): Promise<DossierDocumentSummary[]> {
  return db
    .select({
      id: researchDocuments.id,
      url: researchDocuments.url,
      title: researchDocuments.title,
      kind: researchDocuments.kind,
      rank: dossierDocuments.rank,
      tier: dossierDocuments.tier,
      failure: researchDocuments.failure,
      archivedUrl: researchDocuments.archivedUrl,
    })
    .from(dossierDocuments)
    .innerJoin(researchDocuments, eq(researchDocuments.id, dossierDocuments.documentId))
    .where(eq(dossierDocuments.projectId, projectId))
    .orderBy(sql`${dossierDocuments.rank} asc nulls last`, asc(dossierDocuments.createdAt))
}

/** A project's corpus, read documents first in rank order, unread ones last. */
export async function listDossierDocuments(
  db: Database,
  projectId: string,
): Promise<(ResearchDocumentRow & { rank: number | null; tier: number })[]> {
  const rows = await db
    .select({
      document: researchDocuments,
      rank: dossierDocuments.rank,
      tier: dossierDocuments.tier,
    })
    .from(dossierDocuments)
    .innerJoin(researchDocuments, eq(researchDocuments.id, dossierDocuments.documentId))
    .where(eq(dossierDocuments.projectId, projectId))
    .orderBy(sql`${dossierDocuments.rank} asc nulls last`, asc(dossierDocuments.createdAt))

  return rows.map((row) => ({ ...row.document, rank: row.rank, tier: row.tier }))
}

/**
 * The key a page is stored and looked up under: scheme and host in lower case,
 * no fragment, no `utm_*` tracking, and no trailing slash on a bare host.
 * A path keeps its own slash, since `/a/` and `/a` can be different pages.
 * Pure, so the gather can dedupe before it touches the database.
 */
export function normaliseDocumentUrl(raw: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return raw.trim()
  }

  parsed.hash = ''
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) parsed.searchParams.delete(key)
  }

  const path = parsed.pathname === '/' ? '' : parsed.pathname
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`
}
