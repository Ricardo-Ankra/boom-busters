import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockListedModels } from './mock-listing'
import { buildModelOptions, isStale } from './options'
import type { CatalogueProvider, ListedModel } from './types'

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

describe('buildModelOptions (decision 288)', () => {
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

describe('saved routes the lists no longer hold (decision 288 follow-up)', () => {
  const routing = (overrides: Record<string, { provider: string; model: string } | null>) =>
    ({ ...DEFAULT_SETTINGS.modelRouting, ...overrides }) as typeof DEFAULT_SETTINGS.modelRouting

  it('keeps a routed model priced by its family, labelled no longer offered', () => {
    const anthropic = options({
      routing: routing({ research: { provider: 'anthropic', model: 'claude-opus-6' } }),
    }).llm.anthropic
    expect(anthropic.find((o) => o.id === 'claude-opus-6')).toMatchObject({
      status: 'retired',
      selectable: true,
      price: { inputPerMTok: 5, outputPerMTok: 25 },
      fallsBackTo: 'family',
      // Shown in the row that routes to it, never offered to the others.
      routedOnly: true,
    })
    expect(anthropic.filter((o) => o.routedOnly).map((o) => o.id)).toEqual(['claude-opus-6'])
  })

  it('keeps a routed model nothing can price, asking for a price', () => {
    const anthropic = options({
      routing: routing({ research: { provider: 'anthropic', model: 'claude-mythos-5-1' } }),
    }).llm.anthropic
    expect(anthropic.find((o) => o.id === 'claude-mythos-5-1')).toMatchObject({
      status: 'needs-price',
      price: null,
    })
  })

  it('keeps a routed Gemini image model by its family, and lists it once', () => {
    const google = options({
      routing: routing({
        stills: { provider: 'google', model: 'gemini-8-pro-image' },
        setSheet: { provider: 'google', model: 'gemini-8-pro-image' },
      }),
    }).image.google
    expect(google.filter((o) => o.id === 'gemini-8-pro-image')).toEqual([
      expect.objectContaining({
        status: 'retired',
        price: expect.objectContaining({ pricePerImage: 0.15 }),
      }),
    ])
  })

  it('shows a fal endpoint fal no longer lists as not sendable, with the reason', () => {
    const fal = options({
      routing: routing({ stills: { provider: 'fal', model: 'fal-ai/gone' } }),
    }).image.fal
    expect(fal.find((o) => o.id === 'fal-ai/gone')).toMatchObject({
      status: 'incompatible',
      selectable: false,
      reason: 'fal no longer lists this endpoint, so this app cannot tell what request it takes.',
    })
  })

  it('adds nothing for a route the lists already hold', () => {
    const plain = options()
    const routed = options({ routing: DEFAULT_SETTINGS.modelRouting })
    expect(routed.llm.anthropic.map((o) => o.id)).toEqual(plain.llm.anthropic.map((o) => o.id))
    expect(routed.image.google.map((o) => o.id)).toEqual(plain.image.google.map((o) => o.id))
  })
})

describe('order of a long list (decision 288 follow-up)', () => {
  it('puts priced live models before ones needing a price, and unsendable ones last', () => {
    const fal = (id: string, over: Partial<ListedModel>): ListedModel => ({
      ...mockListedModels('fal')[0]!,
      id,
      label: id,
      ...over,
    })
    const listed = [
      fal('fal-ai/aa-unsendable', { dialect: null, pricePerImage: null }),
      fal('fal-ai/bb-unpriced', { dialect: 'flux', pricePerImage: null }),
      fal('fal-ai/cc-priced', { dialect: 'flux', pricePerImage: 0.02 }),
    ]
    const ids = options({ listed }).image.fal.map((o) => o.id)
    expect(ids.slice(-3)).toEqual([
      'fal-ai/cc-priced',
      'fal-ai/bb-unpriced',
      'fal-ai/aa-unsendable',
    ])
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
