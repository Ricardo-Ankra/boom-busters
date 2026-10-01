import { LLM_PROVIDERS, STILL_PROVIDERS } from '@boom-busters/schemas'
import type { LlmProvider, ModelPrices, StillProvider } from '@boom-busters/schemas'
import { LLM_MODELS } from '../llm/registry'
import { FAL_MODELS } from '../visuals/fal'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import type { ImageGenModel } from '../visuals/types'
import type { KnownModel } from '../llm/types'
import { geminiImageFamily, llmFamily } from './families'
import { resolveImageModel, resolveLlmModel } from './resolve'
import { CATALOGUE_PROVIDERS } from './types'
import type { CatalogueProvider, ListedModel, PriceSource } from './types'

/**
 * The live lists and the hand-written catalogue, merged into what each
 * Settings → Models dropdown shows (decision 287).
 *
 * The catalogue always comes first, in its own order; live-only models
 * follow, non-previews before previews, alphabetically within each group.
 * `status` and `fallsBackTo` tell the UI what it can offer: a `needs-price`
 * model is shown but only selectable once the owner sets a price for it, and
 * `incompatible` never becomes selectable at all.
 */

export type OptionStatus =
  'catalogue' | 'estimated' | 'override' | 'retired' | 'needs-price' | 'incompatible'

export type OptionPrice =
  | { kind: 'llm'; inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number }
  | {
      kind: 'image'
      pricePerImage: number
      pricesBySize?: Partial<Record<'1K' | '2K' | '4K', number>>
    }

export interface ModelOption {
  id: string
  label: string
  status: OptionStatus
  /** Google previews, grouped at the end. */
  preview: boolean
  /** False only for 'incompatible'. A 'needs-price' option is chosen through the price form. */
  selectable: boolean
  /** The price a run would be charged; for 'estimated', the family's; null when unpriced. */
  price: OptionPrice | null
  /** For 'estimated': the representative's label, "Opus 5". */
  pricedAs: string | null
  /** For 'incompatible': why. */
  reason: string | null
  /** True for a hand-written catalogue entry, false for a live-only model. */
  catalogued: boolean
  /**
   * What would price this model if the owner's override were cleared:
   * its catalogue row, fal's own published price, its family, or nothing.
   * Clearing a price is refused when this is null and a route uses the model.
   */
  fallsBackTo: 'catalogue' | 'provider' | 'family' | null
}

export interface RefreshState {
  provider: CatalogueProvider
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
}

export interface ProviderStatus {
  kind: 'live' | 'failed' | 'no-key' | 'never'
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  error: string | null
}

export interface ModelOptions {
  llm: Record<LlmProvider, ModelOption[]>
  image: Record<StillProvider, ModelOption[]>
  status: Record<CatalogueProvider, ProviderStatus>
  /** Newest attempt across providers, ISO, or null. */
  lastAttemptAt: string | null
  /** False when no provider has a key (and not mock mode): a refresh would do nothing. */
  canRefresh: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

export function isStale(lastAttemptAt: string | null, nowMs: number): boolean {
  return lastAttemptAt === null || nowMs - Date.parse(lastAttemptAt) > DAY_MS
}

const statusFor = (source: PriceSource): OptionStatus =>
  source === 'override' ? 'override' : source === 'family' ? 'estimated' : 'catalogue'

const llmPrice = (model: KnownModel): OptionPrice => ({
  kind: 'llm',
  inputPerMTok: model.inputPerMTok,
  outputPerMTok: model.outputPerMTok,
  ...(model.cachedInputPerMTok !== undefined
    ? { cachedInputPerMTok: model.cachedInputPerMTok }
    : {}),
})

const imagePrice = (model: ImageGenModel): OptionPrice => ({
  kind: 'image',
  pricePerImage: model.pricePerImage,
  ...(model.pricesBySize ? { pricesBySize: model.pricesBySize } : {}),
})

/** Live-only options after the catalogue: non-previews first, then by label. */
const byPreviewThenLabel = (a: ModelOption, b: ModelOption) =>
  Number(a.preview) - Number(b.preview) || a.label.localeCompare(b.label)

function llmOptions(
  provider: LlmProvider,
  listed: readonly ListedModel[],
  hasLive: boolean,
  prices: ModelPrices | undefined,
): ModelOption[] {
  const rows = listed.filter((m) => m.provider === provider && m.kind === 'llm')
  const liveIds = new Set(rows.map((m) => m.id))
  const catalogue = LLM_MODELS[provider]
  const known = new Set(catalogue.map((m) => m.id))

  const fromCatalogue = catalogue.map((model): ModelOption => {
    const resolved = resolveLlmModel(provider, model.id, prices)!
    const retired = hasLive && !liveIds.has(model.id)
    return {
      id: model.id,
      label: model.label,
      status: retired ? 'retired' : statusFor(resolved.source),
      preview: false,
      selectable: true,
      price: llmPrice(resolved.model),
      pricedAs: null,
      reason: null,
      catalogued: true,
      fallsBackTo: 'catalogue',
    }
  })

  const liveOnly = rows
    .filter((row) => !known.has(row.id))
    .map((row): ModelOption => {
      const resolved = resolveLlmModel(provider, row.id, prices)
      const family = llmFamily(provider, row.id)
      const representative = family
        ? catalogue.find((m) => m.id === family.representative)
        : undefined
      return {
        id: row.id,
        label: row.label,
        status: resolved ? statusFor(resolved.source) : 'needs-price',
        preview: row.preview,
        selectable: true,
        price: resolved ? llmPrice(resolved.model) : null,
        pricedAs: resolved?.source === 'family' ? (representative?.label ?? null) : null,
        reason: null,
        catalogued: false,
        fallsBackTo: representative ? 'family' : null,
      }
    })
    .sort(byPreviewThenLabel)

  return [...fromCatalogue, ...liveOnly]
}

const IMAGE_CATALOGUES: Record<StillProvider, readonly ImageGenModel[]> = {
  google: GEMINI_IMAGE_MODELS,
  fal: FAL_MODELS,
}

function imageOptions(
  provider: StillProvider,
  listed: readonly ListedModel[],
  hasLive: boolean,
  prices: ModelPrices | undefined,
): ModelOption[] {
  const rows = listed.filter((m) => m.provider === provider && m.kind === 'image')
  const liveIds = new Set(rows.map((m) => m.id))
  const catalogue = IMAGE_CATALOGUES[provider]
  const known = new Set(catalogue.map((m) => m.id))

  const fromCatalogue = catalogue.map((model): ModelOption => {
    const resolved = resolveImageModel(provider, model.id, prices)!
    return {
      id: model.id,
      label: model.label,
      status: hasLive && !liveIds.has(model.id) ? 'retired' : statusFor(resolved.source),
      preview: false,
      selectable: true,
      price: imagePrice(resolved.model),
      pricedAs: null,
      reason: null,
      catalogued: true,
      fallsBackTo: 'catalogue',
    }
  })

  const liveOnly = rows
    .filter((row) => !known.has(row.id))
    .map((row): ModelOption => {
      if (provider === 'fal' && row.dialect === null) {
        return {
          id: row.id,
          label: row.label,
          status: 'incompatible',
          preview: false,
          selectable: false,
          price: null,
          pricedAs: null,
          reason: 'Makes one image per request, or takes an input this app cannot send.',
          catalogued: false,
          fallsBackTo: null,
        }
      }
      const resolved = resolveImageModel(provider, row.id, prices, row)
      const family = provider === 'google' ? geminiImageFamily(row.id) : undefined
      const representative = family
        ? catalogue.find((m) => m.id === family.representative)
        : undefined
      return {
        id: row.id,
        label: row.label,
        status: resolved ? statusFor(resolved.source) : 'needs-price',
        preview: row.preview,
        selectable: true,
        price: resolved ? imagePrice(resolved.model) : null,
        pricedAs: resolved?.source === 'family' ? (representative?.label ?? null) : null,
        reason: null,
        catalogued: false,
        fallsBackTo:
          provider === 'fal'
            ? row.pricePerImage !== null
              ? 'provider'
              : null
            : representative
              ? 'family'
              : null,
      }
    })
    .sort(byPreviewThenLabel)

  return [...fromCatalogue, ...liveOnly]
}

function providerStatus(
  provider: CatalogueProvider,
  refresh: readonly RefreshState[],
  hasKey: boolean,
): ProviderStatus {
  const row = refresh.find((r) => r.provider === provider)
  const base = {
    lastAttemptAt: row?.lastAttemptAt ?? null,
    lastSuccessAt: row?.lastSuccessAt ?? null,
    error: row?.lastError ?? null,
  }
  if (!hasKey) return { kind: 'no-key', ...base }
  if (row?.lastError) return { kind: 'failed', ...base }
  if (row?.lastSuccessAt) return { kind: 'live', ...base }
  return { kind: 'never', ...base }
}

export function buildModelOptions(input: {
  listed: readonly ListedModel[]
  refresh: readonly RefreshState[]
  keys: Record<CatalogueProvider, boolean>
  prices: ModelPrices | undefined
  mock: boolean
}): ModelOptions {
  const hasLive = (provider: CatalogueProvider) =>
    input.refresh.some((r) => r.provider === provider && r.lastSuccessAt !== null)
  const keyed = (provider: CatalogueProvider) => input.mock || input.keys[provider]

  const llm = Object.fromEntries(
    LLM_PROVIDERS.map((p) => [p, llmOptions(p, input.listed, hasLive(p), input.prices)]),
  ) as Record<LlmProvider, ModelOption[]>
  const image = Object.fromEntries(
    STILL_PROVIDERS.map((p) => [p, imageOptions(p, input.listed, hasLive(p), input.prices)]),
  ) as Record<StillProvider, ModelOption[]>
  const status = Object.fromEntries(
    CATALOGUE_PROVIDERS.map((p) => [p, providerStatus(p, input.refresh, keyed(p))]),
  ) as Record<CatalogueProvider, ProviderStatus>

  const attempts = input.refresh
    .map((r) => r.lastAttemptAt)
    .filter((at): at is string => at !== null)
  return {
    llm,
    image,
    status,
    lastAttemptAt: attempts.length > 0 ? attempts.sort().at(-1)! : null,
    canRefresh: CATALOGUE_PROVIDERS.some(keyed),
  }
}
