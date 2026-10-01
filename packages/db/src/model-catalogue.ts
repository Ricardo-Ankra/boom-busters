import { and, asc, eq, notInArray } from 'drizzle-orm'
import type { Database } from './client'
import { modelCatalogue, modelCatalogueRefresh } from './schema'

/** One model as the cache stores it (decision 287). */
export interface CatalogueModelInput {
  modelId: string
  kind: 'llm' | 'image'
  label: string
  preview: boolean
  contextTokens: number | null
  maxOutputTokens: number | null
  dialect: string | null
  pricePerImage: number | null
}

export interface CatalogueModelRow extends CatalogueModelInput {
  provider: string
  fetchedAt: Date
}

export interface CatalogueRefreshRow {
  provider: string
  lastAttemptAt: Date
  lastSuccessAt: Date | null
  lastError: string | null
}

export async function listCatalogueModels(db: Database): Promise<CatalogueModelRow[]> {
  const rows = await db
    .select()
    .from(modelCatalogue)
    .orderBy(asc(modelCatalogue.provider), asc(modelCatalogue.label))
  return rows.map((row) => ({
    provider: row.provider,
    modelId: row.modelId,
    kind: row.kind === 'image' ? 'image' : 'llm',
    label: row.label,
    preview: row.preview,
    contextTokens: row.contextTokens,
    maxOutputTokens: row.maxOutputTokens,
    dialect: row.dialect,
    pricePerImage: row.pricePerImage === null ? null : Number(row.pricePerImage),
    fetchedAt: row.fetchedAt,
  }))
}

export async function listCatalogueRefresh(db: Database): Promise<CatalogueRefreshRow[]> {
  return db
    .select({
      provider: modelCatalogueRefresh.provider,
      lastAttemptAt: modelCatalogueRefresh.lastAttemptAt,
      lastSuccessAt: modelCatalogueRefresh.lastSuccessAt,
      lastError: modelCatalogueRefresh.lastError,
    })
    .from(modelCatalogueRefresh)
    .orderBy(asc(modelCatalogueRefresh.provider))
}

/**
 * A successful refresh: upsert every listed model, drop the provider's rows
 * the list no longer holds, and stamp the refresh, in one transaction.
 * Upserting rather than delete-then-insert lets two refreshes of the same
 * provider land at once without a unique-constraint failure.
 */
export async function replaceCatalogue(
  db: Database,
  provider: string,
  models: readonly CatalogueModelInput[],
  at: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const model of models) {
      const values = {
        kind: model.kind,
        label: model.label,
        preview: model.preview,
        contextTokens: model.contextTokens,
        maxOutputTokens: model.maxOutputTokens,
        dialect: model.dialect,
        pricePerImage: model.pricePerImage === null ? null : String(model.pricePerImage),
        fetchedAt: at,
      }
      await tx
        .insert(modelCatalogue)
        .values({ provider, modelId: model.modelId, ...values })
        .onConflictDoUpdate({
          target: [modelCatalogue.provider, modelCatalogue.modelId],
          set: { ...values, updatedAt: new Date() },
        })
    }
    const kept = models.map((model) => model.modelId)
    await tx
      .delete(modelCatalogue)
      .where(
        kept.length > 0
          ? and(eq(modelCatalogue.provider, provider), notInArray(modelCatalogue.modelId, kept))
          : eq(modelCatalogue.provider, provider),
      )
    await tx
      .insert(modelCatalogueRefresh)
      .values({ provider, lastAttemptAt: at, lastSuccessAt: at, lastError: null })
      .onConflictDoUpdate({
        target: modelCatalogueRefresh.provider,
        set: { lastAttemptAt: at, lastSuccessAt: at, lastError: null, updatedAt: new Date() },
      })
  })
}

/** A failed refresh: the cached rows stay; only the attempt and its error are recorded. */
export async function recordCatalogueFailure(
  db: Database,
  provider: string,
  error: string,
  at: Date,
): Promise<void> {
  await db
    .insert(modelCatalogueRefresh)
    .values({ provider, lastAttemptAt: at, lastSuccessAt: null, lastError: error })
    .onConflictDoUpdate({
      target: modelCatalogueRefresh.provider,
      set: { lastAttemptAt: at, lastError: error, updatedAt: new Date() },
    })
}
