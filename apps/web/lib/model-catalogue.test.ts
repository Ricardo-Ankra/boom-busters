// @vitest-environment node

import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  listCatalogueModels: vi.fn(async () => [] as unknown[]),
  listCatalogueRefresh: vi.fn(async () => [] as unknown[]),
  replaceCatalogue: vi.fn(async () => {}),
  recordCatalogueFailure: vi.fn(async () => {}),
  llmCredentials: vi.fn(async () => ({}) as Record<string, string>),
  visualCredentials: vi.fn(async () => ({}) as Record<string, string>),
}))
vi.mock('@boom-busters/db', () => db)
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/env', () => ({ env: { SECRETS_ENCRYPTION_KEY: 'k' } }))
vi.mock('server-only', () => ({}))

import { loadModelOptions, refreshModelCatalogue, stillCatalogue } from './model-catalogue'

const fetchSpy = vi.spyOn(globalThis, 'fetch')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NODE_ENV', 'test')
})
afterEach(() => vi.unstubAllEnvs())

describe('refreshModelCatalogue (decision 288)', () => {
  it('refreshes every provider from fixtures in mock mode, with no key and no network', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    const results = await refreshModelCatalogue()
    expect(results.map((r) => [r.provider, r.ok])).toEqual([
      ['anthropic', true],
      ['openai', true],
      ['google', true],
      ['fal', true],
    ])
    expect(db.replaceCatalogue).toHaveBeenCalledTimes(4)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('skips a provider with no key and touches none of its rows', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    const results = await refreshModelCatalogue()
    expect(results.every((r) => r.skipped)).toBe(true)
    expect(db.replaceCatalogue).not.toHaveBeenCalled()
    expect(db.recordCatalogueFailure).not.toHaveBeenCalled()
  })

  it('records a failed provider and keeps refreshing the others', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    // Once: `clearAllMocks` keeps implementations, and a key left behind
    // here would turn the later no-key case into a keyed one.
    db.llmCredentials.mockResolvedValueOnce({ anthropic: 'a', openai: 'o' })
    fetchSpy.mockImplementation(async (input) =>
      String(input).includes('anthropic')
        ? new Response('{"error":{"message":"bad key"}}', { status: 401 })
        : new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 }),
    )
    const results = await refreshModelCatalogue()
    expect(results.find((r) => r.provider === 'anthropic')).toMatchObject({ ok: false })
    expect(results.find((r) => r.provider === 'openai')).toMatchObject({ ok: true })
    expect(db.recordCatalogueFailure).toHaveBeenCalledWith(
      expect.anything(),
      'anthropic',
      expect.any(String),
      expect.any(Date),
    )
  })

  it('still reports the failure when recording it also fails', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    db.llmCredentials.mockResolvedValueOnce({ anthropic: 'a' })
    fetchSpy.mockImplementation(
      async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }),
    )
    db.recordCatalogueFailure.mockRejectedValueOnce(new Error('db is down'))

    const results = await refreshModelCatalogue()

    const anthropic = results.find((r) => r.provider === 'anthropic')
    expect(anthropic?.ok).toBe(false)
    expect(anthropic?.skipped).toBe(false)
    expect(typeof anthropic?.error).toBe('string')
  })
})

describe('stillCatalogue', () => {
  it('builds each image adapter over the catalogue plus choosable cached models', async () => {
    db.listCatalogueModels.mockResolvedValueOnce([
      {
        provider: 'fal',
        modelId: 'fal-ai/mock-flux',
        kind: 'image',
        label: 'Mock FLUX',
        preview: false,
        contextTokens: null,
        maxOutputTokens: null,
        dialect: 'flux',
        pricePerImage: 0.02,
        fetchedAt: new Date(),
      },
    ])
    const catalogue = await stillCatalogue(DEFAULT_SETTINGS)
    expect(catalogue.fal.models.map((m) => m.id)).toContain('fal-ai/mock-flux')
    expect(catalogue.google.models.map((m) => m.id)).toContain('gemini-3-pro-image')
  })
})

describe('loadModelOptions', () => {
  it('reports no-key status lines and cannot refresh with no keys', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '0')
    const options = await loadModelOptions(DEFAULT_SETTINGS)
    expect(options.status.anthropic.kind).toBe('no-key')
    expect(options.canRefresh).toBe(false)
  })
})
