import { EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockListedModels } from './mock-listing'
import { buildModelOptions, isStale } from './options'
import type { CatalogueProvider } from './types'

const allKeys = (value: boolean): Record<CatalogueProvider, boolean> => ({
  anthropic: value,
  openai: value,
  google: value,
  fal: value,
})

const live = (provider: CatalogueProvider) => ({
  provider,
  lastAttemptAt: '2026-10-01T09:00:00.000Z',
  lastSuccessAt: '2026-10-01T09:00:00.000Z',
  lastError: null,
})

function options(overrides: Partial<Parameters<typeof buildModelOptions>[0]> = {}) {
  return buildModelOptions({
    listed: (['anthropic', 'openai', 'google', 'fal'] as const).flatMap(mockListedModels),
    refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map(live),
    keys: allKeys(true),
    prices: EMPTY_MODEL_PRICES,
    mock: false,
    ...overrides,
  })
}

describe('buildModelOptions (decision 287)', () => {
  it('lists the catalogue first, then live-only models with their labels', () => {
    const anthropic = options().llm.anthropic
    expect(anthropic[0]).toMatchObject({ id: 'claude-opus-5', status: 'catalogue' })
    expect(anthropic.find((o) => o.id === 'claude-opus-mock-9')).toMatchObject({
      status: 'estimated',
      pricedAs: 'Opus 5',
      price: { kind: 'llm', inputPerMTok: 5, outputPerMTok: 25 },
      selectable: true,
    })
    expect(anthropic.find((o) => o.id === 'claude-mock-unpriced')).toMatchObject({
      status: 'needs-price',
      price: null,
    })
  })

  it('marks the owner’s price, and says what would price the model without it', () => {
    const prices = {
      ...EMPTY_MODEL_PRICES,
      llm: {
        'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 },
        'anthropic:claude-opus-mock-9': { inputPerMTok: 4, outputPerMTok: 20 },
      },
    }
    const anthropic = options({ prices }).llm.anthropic
    expect(anthropic.find((o) => o.id === 'claude-mock-unpriced')).toMatchObject({
      status: 'override',
      price: { inputPerMTok: 7, outputPerMTok: 30 },
      catalogued: false,
      fallsBackTo: null,
    })
    expect(anthropic.find((o) => o.id === 'claude-opus-mock-9')?.fallsBackTo).toBe('family')
    expect(anthropic.find((o) => o.id === 'claude-opus-5')).toMatchObject({
      catalogued: true,
      fallsBackTo: 'catalogue',
    })
    expect(options().image.fal.find((o) => o.id === 'fal-ai/mock-flux')?.fallsBackTo).toBe(
      'provider',
    )
  })

  it('marks a catalogued model the live list no longer holds, only once a list has loaded', () => {
    const listed = mockListedModels('anthropic').filter((m) => m.id !== 'claude-sonnet-5')
    expect(options({ listed }).llm.anthropic.find((o) => o.id === 'claude-sonnet-5')?.status).toBe(
      'retired',
    )
    expect(
      options({ listed, refresh: [] }).llm.anthropic.find((o) => o.id === 'claude-sonnet-5')
        ?.status,
    ).toBe('catalogue')
  })

  it('counts a dated snapshot of a catalogued alias as listed, and does not list it twice', () => {
    const listed = mockListedModels('anthropic').map((m) =>
      m.id === 'claude-opus-5' ? { ...m, id: 'claude-opus-5-20260401' } : m,
    )
    const anthropic = options({ listed }).llm.anthropic
    expect(anthropic.find((o) => o.id === 'claude-opus-5')?.status).toBe('catalogue')
    expect(anthropic.some((o) => o.id === 'claude-opus-5-20260401')).toBe(false)
  })

  it('counts the undated alias of a catalogued snapshot as listed, and does not list it twice', () => {
    const listed = mockListedModels('anthropic').map((m) =>
      m.id === 'claude-haiku-4-5-20251001' ? { ...m, id: 'claude-haiku-4-5' } : m,
    )
    const anthropic = options({ listed }).llm.anthropic
    expect(anthropic.find((o) => o.id === 'claude-haiku-4-5-20251001')?.status).toBe('catalogue')
    expect(anthropic.some((o) => o.id === 'claude-haiku-4-5')).toBe(false)
  })

  it('counts a dated snapshot of a catalogued image model as listed', () => {
    const listed = mockListedModels('google').map((m) =>
      m.id === 'gemini-3-pro-image' ? { ...m, id: 'gemini-3-pro-image-20260401' } : m,
    )
    const google = options({ listed }).image.google
    expect(google.find((o) => o.id === 'gemini-3-pro-image')?.status).toBe('catalogue')
    expect(google.some((o) => o.id === 'gemini-3-pro-image-20260401')).toBe(false)
  })

  it('keeps the owner’s price on a catalogued model the live list no longer holds', () => {
    const prices = {
      ...EMPTY_MODEL_PRICES,
      llm: { 'anthropic:claude-sonnet-5': { inputPerMTok: 2, outputPerMTok: 10 } },
      image: { 'google:gemini-3-pro-image': { pricePerImage: 0.1 } },
    }
    const listed = [
      ...mockListedModels('anthropic').filter((m) => m.id !== 'claude-sonnet-5'),
      ...mockListedModels('google').filter((m) => m.id !== 'gemini-3-pro-image'),
    ]
    const built = options({ listed, prices })
    expect(built.llm.anthropic.find((o) => o.id === 'claude-sonnet-5')).toMatchObject({
      status: 'override',
      price: { inputPerMTok: 2, outputPerMTok: 10 },
    })
    expect(built.image.google.find((o) => o.id === 'gemini-3-pro-image')).toMatchObject({
      status: 'override',
      price: { pricePerImage: 0.1 },
    })
  })

  it('splits Google into LLM and image options and groups previews last', () => {
    const listed = [
      ...mockListedModels('google'),
      {
        ...mockListedModels('google')[0]!,
        id: 'gemini-9-pro-preview',
        label: 'Gemini 9 Pro Preview',
        preview: true,
      },
    ]
    const google = options({ listed }).llm.google
    expect(google.at(-1)).toMatchObject({ id: 'gemini-9-pro-preview', preview: true })
    expect(options().image.google.find((o) => o.id === 'gemini-9-flash-image')?.status).toBe(
      'estimated',
    )
  })

  it('shows a fal endpoint it cannot send as incompatible', () => {
    const listed = [
      ...mockListedModels('fal'),
      {
        ...mockListedModels('fal')[0]!,
        id: 'fal-ai/one-at-a-time',
        label: 'One at a time',
        dialect: null,
      },
    ]
    expect(
      options({ listed }).image.fal.find((o) => o.id === 'fal-ai/one-at-a-time'),
    ).toMatchObject({
      status: 'incompatible',
      selectable: false,
      reason: 'Makes one image per request, or takes an input this app cannot send.',
    })
    expect(options().image.fal.find((o) => o.id === 'fal-ai/mock-flux')).toMatchObject({
      status: 'catalogue',
      price: { kind: 'image', pricePerImage: 0.02 },
    })
  })

  it('says why each provider shows what it shows', () => {
    const status = options({
      keys: { ...allKeys(true), openai: false },
      refresh: [
        live('anthropic'),
        {
          provider: 'google',
          lastAttemptAt: '2026-10-01T10:00:00.000Z',
          lastSuccessAt: '2026-10-01T09:00:00.000Z',
          lastError: 'key rejected',
        },
      ],
    }).status
    expect(status.anthropic.kind).toBe('live')
    expect(status.openai.kind).toBe('no-key')
    expect(status.google).toMatchObject({ kind: 'failed', error: 'key rejected' })
    expect(status.fal.kind).toBe('never')
  })

  it('cannot refresh with no keys outside mock mode', () => {
    expect(options({ keys: allKeys(false) }).canRefresh).toBe(false)
    expect(options({ keys: allKeys(false), mock: true }).canRefresh).toBe(true)
  })
})

describe('isStale', () => {
  it('is stale with no refresh, or one older than a day', () => {
    const now = Date.parse('2026-10-02T10:00:00.000Z')
    expect(isStale(null, now)).toBe(true)
    expect(isStale('2026-10-01T09:00:00.000Z', now)).toBe(true)
    expect(isStale('2026-10-02T09:00:00.000Z', now)).toBe(false)
  })
})
