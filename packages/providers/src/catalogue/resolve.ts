import {
  EMPTY_MODEL_PRICES,
  canonicalModelId,
  canonicalStillModelId,
  modelPriceKey,
} from '@boom-busters/schemas'
import type {
  ImagePriceOverride,
  LlmPriceOverride,
  LlmProvider,
  ModelPrices,
  StillProvider,
} from '@boom-busters/schemas'
import { LLM_MODELS } from '../llm/registry'
import type { KnownModel } from '../llm/types'
import { FAL_MODELS } from '../visuals/fal'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import type { ImageGenModel } from '../visuals/types'
import { geminiImageFamily, llmFamily } from './families'
import type { ListedModel, PriceSource } from './types'

/**
 * Any model id to a price and a tier, from settings alone (decision 287).
 *
 * The order is the owner's override, the hand-written catalogue, fal's own
 * published price, then the family. `undefined` means unpriced, which every
 * caller refuses: an unpriced model would estimate $0 and walk through every
 * budget cap. Nothing here reads the network, so a list endpoint being down
 * can never stop a run.
 */

export interface ResolvedLlmModel {
  model: KnownModel
  source: PriceSource
}

export interface ResolvedImageModel {
  model: ImageGenModel
  source: PriceSource
}

function llmPriceFields(override: LlmPriceOverride) {
  return {
    inputPerMTok: override.inputPerMTok,
    outputPerMTok: override.outputPerMTok,
    ...(override.cachedInputPerMTok !== undefined
      ? { cachedInputPerMTok: override.cachedInputPerMTok }
      : {}),
  }
}

function imagePriceFields(override: ImagePriceOverride) {
  return {
    pricePerImage: override.pricePerImage,
    ...(override.pricesBySize ? { pricesBySize: override.pricesBySize } : {}),
  }
}

export function resolveLlmModel(
  provider: LlmProvider,
  modelId: string,
  prices: ModelPrices | undefined,
): ResolvedLlmModel | undefined {
  const id = canonicalModelId(provider, modelId)
  const override = (prices ?? EMPTY_MODEL_PRICES).llm[modelPriceKey(provider, id)]
  const catalogue = LLM_MODELS[provider]
  const listed = catalogue.find((model) => model.id === id)

  if (listed) {
    return override
      ? { model: { ...listed, ...llmPriceFields(override) }, source: 'override' }
      : { model: listed, source: 'catalogue' }
  }

  const family = llmFamily(provider, id)
  const representative = family
    ? catalogue.find((model) => model.id === family.representative)
    : undefined

  if (override) {
    return {
      model: {
        id,
        label: id,
        // A priced model with no family steps down to the provider's top
        // catalogued model when it fails, rather than skipping it.
        tier: representative?.tier ?? -1,
        supportsBatch: false,
        ...llmPriceFields(override),
      },
      source: 'override',
    }
  }

  if (!representative) return undefined
  return {
    model: {
      id,
      label: id,
      tier: representative.tier,
      inputPerMTok: representative.inputPerMTok,
      outputPerMTok: representative.outputPerMTok,
      ...(representative.cachedInputPerMTok !== undefined
        ? { cachedInputPerMTok: representative.cachedInputPerMTok }
        : {}),
      supportsBatch: false,
    },
    source: 'family',
  }
}

const IMAGE_CATALOGUES: Record<StillProvider, readonly ImageGenModel[]> = {
  google: GEMINI_IMAGE_MODELS,
  fal: FAL_MODELS,
}

export function resolveImageModel(
  provider: StillProvider,
  modelId: string,
  prices: ModelPrices | undefined,
  cached?: ListedModel,
): ResolvedImageModel | undefined {
  const id = canonicalStillModelId(modelId)
  const override = (prices ?? EMPTY_MODEL_PRICES).image[modelPriceKey(provider, id)]
  const listed = IMAGE_CATALOGUES[provider].find((model) => model.id === id)

  if (listed) {
    return override
      ? { model: { ...listed, ...imagePriceFields(override) }, source: 'override' }
      : { model: listed, source: 'catalogue' }
  }

  const label = cached?.label ?? id

  if (provider === 'fal') {
    // No dialect means a request shape this app cannot send: never choosable,
    // whatever its price.
    const dialect = cached?.dialect ?? null
    if (!dialect) return undefined
    if (override)
      return { model: { id, label, dialect, ...imagePriceFields(override) }, source: 'override' }
    if (cached?.pricePerImage != null) {
      return {
        model: { id, label, dialect, pricePerImage: cached.pricePerImage },
        source: 'provider',
      }
    }
    return undefined
  }

  if (override) return { model: { id, label, ...imagePriceFields(override) }, source: 'override' }
  const family = geminiImageFamily(id)
  const representative = family
    ? GEMINI_IMAGE_MODELS.find((model) => model.id === family.representative)
    : undefined
  if (!representative) return undefined
  return {
    model: {
      id,
      label,
      pricePerImage: representative.pricePerImage,
      ...(representative.pricesBySize ? { pricesBySize: representative.pricesBySize } : {}),
    },
    source: 'family',
  }
}

/**
 * Every image model a run may use on this provider: the catalogue (repriced
 * by any override), then each cached live model that resolves. The adapters
 * from `liveImageGenWith` are built over this list.
 */
export function effectiveImageModels(
  provider: StillProvider,
  prices: ModelPrices | undefined,
  listed: readonly ListedModel[],
): ImageGenModel[] {
  const catalogue = IMAGE_CATALOGUES[provider]
  const known = new Set(catalogue.map((model) => model.id))
  const models = catalogue.map(
    (model) => resolveImageModel(provider, model.id, prices)?.model ?? model,
  )
  for (const row of listed) {
    if (row.kind !== 'image' || row.provider !== provider || known.has(row.id)) continue
    const resolved = resolveImageModel(provider, row.id, prices, row)
    if (resolved) {
      models.push(resolved.model)
      known.add(row.id)
    }
  }
  return models
}
