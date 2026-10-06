import { LLM_PROVIDERS, LLM_TASKS, STILL_PROVIDERS } from '@boom-busters/schemas'
import type { LlmProvider, ModelPrices, ModelRouting, StillProvider } from '@boom-busters/schemas'
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
 * Settings → Models dropdown shows (decision 288).
 *
 * The catalogue always comes first, in its own order; live-only models
 * follow, priced ones before those needing a price and unsendable ones last
 * (fal lists about two hundred endpoints), non-previews before previews,
 * alphabetically within each group. A saved route no list holds any more
 * comes last, so the select always shows what the route really is.
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
  /**
   * Present only because a saved route holds a model no list does any more:
   * shown in that route's own row, never offered to the others.
   */
  routedOnly?: boolean
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

const DATED = /-\d{8}$/

/**
 * Whether a live id is a catalogued id under another name: the same id, its
 * `-YYYYMMDD` snapshot, or, for a catalogued snapshot, its undated alias.
 * Anthropic may list only one of the two, and a catalogued default must not
 * read as no longer offered because the list chose the other spelling.
 */
function sameModel(catalogued: string, live: string): boolean {
  if (catalogued === live) return true
  if (DATED.test(live) && live.replace(DATED, '') === catalogued) return true
  return DATED.test(catalogued) && catalogued.replace(DATED, '') === live
}

const listedAs = (catalogued: string, liveIds: readonly string[]) =>
  liveIds.some((live) => sameModel(catalogued, live))

/**
 * A catalogued model's status. The owner's price wins over "retired": the
 * tab must keep showing that price with its Edit and Clear buttons, and a
 * run still tries the model (spec section 9).
 */
function catalogueStatus(source: PriceSource, listed: boolean): OptionStatus {
  if (source === 'override') return 'override'
  return listed ? statusFor(source) : 'retired'
}

/** Priced first, then those needing a price, then the unsendable. */
const STATUS_RANK: Record<OptionStatus, number> = {
  catalogue: 0,
  override: 0,
  estimated: 0,
  retired: 0,
  'needs-price': 1,
  incompatible: 2,
}

/** Live-only options after the catalogue. */
const byPriceThenPreviewThenLabel = (a: ModelOption, b: ModelOption) =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
  Number(a.preview) - Number(b.preview) ||
  a.label.localeCompare(b.label)

/** Each routed id a provider's options do not already hold, once. */
function missingRoutes(
  options: readonly ModelOption[],
  routes: readonly ({ provider: string; model: string } | null)[],
  provider: string,
): string[] {
  const ids = routes
    .filter((route): route is { provider: string; model: string } => route?.provider === provider)
    .map((route) => route.model)
  return [...new Set(ids)].filter((id) => !options.some((option) => sameModel(option.id, id)))
}

function llmOptions(
  provider: LlmProvider,
  listed: readonly ListedModel[],
  hasLive: boolean,
  prices: ModelPrices | undefined,
  routing: ModelRouting | undefined,
): ModelOption[] {
  const rows = listed.filter((m) => m.provider === provider && m.kind === 'llm')
  const liveIds = rows.map((m) => m.id)
  const catalogue = LLM_MODELS[provider]
  const knownIds = catalogue.map((m) => m.id)

  const fromCatalogue = catalogue.map((model): ModelOption => {
    const resolved = resolveLlmModel(provider, model.id, prices)!
    return {
      id: model.id,
      label: model.label,
      status: catalogueStatus(resolved.source, !hasLive || listedAs(model.id, liveIds)),
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
    .filter((row) => !knownIds.some((id) => sameModel(id, row.id)))
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
    .sort(byPriceThenPreviewThenLabel)

  const shown = [...fromCatalogue, ...liveOnly]
  const routes = routing ? LLM_TASKS.map((task) => routing[task]) : []
  const vanished = missingRoutes(shown, routes, provider).map((id): ModelOption => {
    const resolved = resolveLlmModel(provider, id, prices)
    const family = llmFamily(provider, id)
    const representative = family
      ? catalogue.find((m) => m.id === family.representative)
      : undefined
    return {
      id,
      label: id,
      // A run still tries it, at the price settings give it (spec section 9).
      status: resolved ? catalogueStatus(resolved.source, false) : 'needs-price',
      preview: false,
      selectable: true,
      price: resolved ? llmPrice(resolved.model) : null,
      pricedAs: resolved?.source === 'family' ? (representative?.label ?? null) : null,
      reason: null,
      catalogued: false,
      fallsBackTo: representative ? 'family' : null,
      routedOnly: true,
    }
  })
  return [...shown, ...vanished]
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
  routing: ModelRouting | undefined,
): ModelOption[] {
  const rows = listed.filter((m) => m.provider === provider && m.kind === 'image')
  const liveIds = rows.map((m) => m.id)
  const catalogue = IMAGE_CATALOGUES[provider]
  const knownIds = catalogue.map((m) => m.id)

  const fromCatalogue = catalogue.map((model): ModelOption => {
    const resolved = resolveImageModel(provider, model.id, prices)!
    return {
      id: model.id,
      label: model.label,
      status: catalogueStatus(resolved.source, !hasLive || listedAs(model.id, liveIds)),
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
    .filter((row) => !knownIds.some((id) => sameModel(id, row.id)))
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
    .sort(byPriceThenPreviewThenLabel)

  const shown = [...fromCatalogue, ...liveOnly]
  const routes = routing ? [routing.stills, routing.stillsLikeness, routing.setSheet] : []
  const vanished = missingRoutes(shown, routes, provider).map((id): ModelOption => {
    if (provider === 'fal') {
      // A fal endpoint's request shape comes from its listed schema; with
      // the listing gone, nothing can be sent to it.
      return {
        id,
        label: id,
        status: 'incompatible',
        preview: false,
        selectable: false,
        price: null,
        pricedAs: null,
        reason: 'fal no longer lists this endpoint, so this app cannot tell what request it takes.',
        catalogued: false,
        fallsBackTo: null,
        routedOnly: true,
      }
    }
    const resolved = resolveImageModel(provider, id, prices)
    const family = geminiImageFamily(id)
    const representative = family
      ? catalogue.find((m) => m.id === family.representative)
      : undefined
    return {
      id,
      label: id,
      status: resolved ? catalogueStatus(resolved.source, false) : 'needs-price',
      preview: false,
      selectable: true,
      price: resolved ? imagePrice(resolved.model) : null,
      pricedAs: resolved?.source === 'family' ? (representative?.label ?? null) : null,
      reason: null,
      catalogued: false,
      fallsBackTo: representative ? 'family' : null,
      routedOnly: true,
    }
  })
  return [...shown, ...vanished]
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
  /** Saved routes, so a model no list holds any more still shows as itself. */
  routing?: ModelRouting
}): ModelOptions {
  const hasLive = (provider: CatalogueProvider) =>
    input.refresh.some((r) => r.provider === provider && r.lastSuccessAt !== null)
  const keyed = (provider: CatalogueProvider) => input.mock || input.keys[provider]

  const llm = Object.fromEntries(
    LLM_PROVIDERS.map((p) => [
      p,
      llmOptions(p, input.listed, hasLive(p), input.prices, input.routing),
    ]),
  ) as Record<LlmProvider, ModelOption[]>
  const image = Object.fromEntries(
    STILL_PROVIDERS.map((p) => [
      p,
      imageOptions(p, input.listed, hasLive(p), input.prices, input.routing),
    ]),
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
