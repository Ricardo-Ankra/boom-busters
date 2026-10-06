import { EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import type { ModelPrices } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import type { ListedModel } from './types'
import { effectiveImageModels, resolveImageModel, resolveLlmModel } from './resolve'

const priced = (prices: Partial<ModelPrices>): ModelPrices => ({ ...EMPTY_MODEL_PRICES, ...prices })

const falListed = (over: Partial<ListedModel>): ListedModel => ({
  provider: 'fal',
  id: 'fal-ai/new-model',
  label: 'New model',
  kind: 'image',
  preview: false,
  contextTokens: null,
  maxOutputTokens: null,
  dialect: 'flux',
  pricePerImage: 0.02,
  ...over,
})

describe('resolveLlmModel (decision 288)', () => {
  it('prices a catalogued model from the catalogue', () => {
    const resolved = resolveLlmModel('anthropic', 'claude-opus-5', EMPTY_MODEL_PRICES)
    expect(resolved?.source).toBe('catalogue')
    expect(resolved?.model.outputPerMTok).toBe(25)
  })

  it('prices a live family member at its representative, at the same tier', () => {
    // A hypothetical next Opus: Opus 5.5 is catalogued since 2026-10-06.
    const resolved = resolveLlmModel('anthropic', 'claude-opus-6', EMPTY_MODEL_PRICES)
    expect(resolved?.source).toBe('family')
    expect(resolved?.model).toMatchObject({ id: 'claude-opus-6', tier: 0, inputPerMTok: 5 })
  })

  it('lets the owner override a catalogued price and keeps its tier', () => {
    const prices = priced({
      llm: { 'anthropic:claude-opus-5': { inputPerMTok: 4, outputPerMTok: 20 } },
    })
    const resolved = resolveLlmModel('anthropic', 'claude-opus-5', prices)
    expect(resolved).toMatchObject({ source: 'override', model: { tier: 0, outputPerMTok: 20 } })
  })

  it('refuses a family-less model with no override, and takes tier -1 once priced', () => {
    // Mythos 5.1 has no family and no catalogue row (limited availability).
    expect(resolveLlmModel('anthropic', 'claude-mythos-5-1', EMPTY_MODEL_PRICES)).toBeUndefined()
    const prices = priced({
      llm: { 'anthropic:claude-mythos-5-1': { inputPerMTok: 10, outputPerMTok: 50 } },
    })
    expect(resolveLlmModel('anthropic', 'claude-mythos-5-1', prices)?.model.tier).toBe(-1)
  })

  it('folds a legacy id forward before resolving', () => {
    expect(resolveLlmModel('anthropic', 'opus', EMPTY_MODEL_PRICES)?.model.id).toBe('claude-opus-5')
  })

  it('treats missing prices as no overrides', () => {
    expect(resolveLlmModel('openai', 'gpt-5.5', undefined)?.source).toBe('family')
  })
})

describe('resolveImageModel', () => {
  it('prices a live Gemini image model by family, sizes included', () => {
    const resolved = resolveImageModel('google', 'gemini-9-pro-image', EMPTY_MODEL_PRICES)
    expect(resolved).toMatchObject({ source: 'family', model: { pricesBySize: { '4K': 0.24 } } })
  })

  it('uses fal’s own published price and the cached dialect', () => {
    const resolved = resolveImageModel('fal', 'fal-ai/new-model', EMPTY_MODEL_PRICES, falListed({}))
    expect(resolved).toMatchObject({
      source: 'provider',
      model: { pricePerImage: 0.02, dialect: 'flux', label: 'New model' },
    })
  })

  it('refuses a fal model with no dialect even when it is priced', () => {
    const cached = falListed({ dialect: null })
    const prices = priced({ image: { 'fal:fal-ai/new-model': { pricePerImage: 0.1 } } })
    expect(resolveImageModel('fal', 'fal-ai/new-model', prices, cached)).toBeUndefined()
  })

  it('refuses a fal model with a dialect but no price until the owner sets one', () => {
    const cached = falListed({ pricePerImage: null })
    expect(resolveImageModel('fal', 'fal-ai/new-model', EMPTY_MODEL_PRICES, cached)).toBeUndefined()
    const prices = priced({ image: { 'fal:fal-ai/new-model': { pricePerImage: 0.1 } } })
    expect(resolveImageModel('fal', 'fal-ai/new-model', prices, cached)?.source).toBe('override')
  })
})

describe('effectiveImageModels', () => {
  it('lists the catalogue, repriced, then every choosable live model', () => {
    const prices = priced({ image: { 'fal:fal-ai/flux/dev': { pricePerImage: 0.025 } } })
    const models = effectiveImageModels('fal', prices, [
      falListed({}),
      falListed({ id: 'fal-ai/one-at-a-time', dialect: null }),
      falListed({ id: 'fal-ai/flux/dev', label: 'FLUX.1 dev (live)' }),
    ])
    expect(models.find((m) => m.id === 'fal-ai/flux/dev')?.pricePerImage).toBe(0.025)
    expect(models.map((m) => m.id)).toContain('fal-ai/new-model')
    expect(models.map((m) => m.id)).not.toContain('fal-ai/one-at-a-time')
    expect(models.filter((m) => m.id === 'fal-ai/flux/dev')).toHaveLength(1)
  })

  it('folds a live row carrying a legacy alias onto its catalogued id, adding nothing', () => {
    const row: ListedModel = {
      provider: 'google',
      id: 'gemini-3-pro-image-preview',
      label: 'Gemini 3 Pro Image (preview)',
      kind: 'image',
      preview: true,
      contextTokens: null,
      maxOutputTokens: null,
      dialect: null,
      pricePerImage: null,
    }
    const models = effectiveImageModels('google', EMPTY_MODEL_PRICES, [row])
    expect(models.filter((m) => m.id === 'gemini-3-pro-image')).toHaveLength(1)
  })
})
