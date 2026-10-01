import { sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from './client'
import {
  listCatalogueModels,
  listCatalogueRefresh,
  recordCatalogueFailure,
  replaceCatalogue,
  type CatalogueModelInput,
} from './model-catalogue'
import { modelCatalogue, modelCatalogueRefresh } from './schema'
import { requireTestDatabase } from './test-database'

/** The live model cache (decision 287) against a real database. */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

const model = (id: string, over: Partial<CatalogueModelInput> = {}): CatalogueModelInput => ({
  modelId: id,
  kind: 'llm',
  label: id,
  preview: false,
  contextTokens: null,
  maxOutputTokens: null,
  dialect: null,
  pricePerImage: null,
  ...over,
})

suite('the model cache', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 4 })

  beforeEach(async () => {
    await db.execute(dsql`truncate table ${modelCatalogue}, ${modelCatalogueRefresh}`)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('replaces a provider’s rows on success and stamps the refresh', async () => {
    const first = new Date('2026-10-01T09:00:00Z')
    await replaceCatalogue(
      db,
      'anthropic',
      [model('claude-opus-5'), model('claude-opus-5-5')],
      first,
    )
    const second = new Date('2026-10-01T10:00:00Z')
    await replaceCatalogue(db, 'anthropic', [model('claude-opus-5-5')], second)

    expect((await listCatalogueModels(db)).map((row) => row.modelId)).toEqual(['claude-opus-5-5'])
    expect(await listCatalogueRefresh(db)).toEqual([
      expect.objectContaining({ provider: 'anthropic', lastSuccessAt: second, lastError: null }),
    ])
  })

  it('keeps the rows on failure and records the error', async () => {
    await replaceCatalogue(
      db,
      'fal',
      [model('fal-ai/x', { kind: 'image', pricePerImage: 0.02, dialect: 'flux' })],
      new Date('2026-10-01T09:00:00Z'),
    )
    const failedAt = new Date('2026-10-01T11:00:00Z')
    await recordCatalogueFailure(db, 'fal', 'key rejected', failedAt)

    const rows = await listCatalogueModels(db)
    expect(rows).toEqual([
      expect.objectContaining({ modelId: 'fal-ai/x', pricePerImage: 0.02, dialect: 'flux' }),
    ])
    expect(await listCatalogueRefresh(db)).toEqual([
      expect.objectContaining({
        provider: 'fal',
        lastAttemptAt: failedAt,
        lastError: 'key rejected',
      }),
    ])
  })

  it('survives two refreshes of one provider landing at once', async () => {
    const at = new Date('2026-10-01T12:00:00Z')
    await Promise.all([
      replaceCatalogue(db, 'openai', [model('gpt-5'), model('gpt-5.5')], at),
      replaceCatalogue(db, 'openai', [model('gpt-5'), model('gpt-5.5')], at),
    ])
    expect((await listCatalogueModels(db)).map((row) => row.modelId).sort()).toEqual([
      'gpt-5',
      'gpt-5.5',
    ])
    expect((await listCatalogueRefresh(db))[0]?.lastError).toBeNull()
  })
})
