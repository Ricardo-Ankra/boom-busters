import { mockProvidersEnabled } from '../llm/registry'
import { createFalImageGen, falImageGen } from './fal'
import { createGeminiImageGen, geminiImageGen } from './gemini'
import { createMockStock, mockImageGen, mockImageGenWith } from './mock'
import { pexelsStock } from './pexels'
import { pixabayStock } from './pixabay'
import type {
  ImageGenModel,
  ImageGenProvider,
  ImageGenProviderId,
  StockProvider,
  StockProviderId,
} from './types'
import { wikimediaStock } from './wikimedia'

/**
 * The visual-provider registries — the same switch, and the same rule, as
 * `llmAdapters` and `ttsAdapters`: `MOCK_PROVIDERS=1` swaps every vendor for
 * a deterministic mock, and the flag is never defaulted on.
 */

export const LIVE_STOCK_ADAPTERS: Record<StockProviderId, StockProvider> = {
  pexels: pexelsStock,
  pixabay: pixabayStock,
  wikimedia: wikimediaStock,
}

export function mockStockAdapters(): Record<StockProviderId, StockProvider> {
  return {
    pexels: createMockStock('pexels'),
    pixabay: createMockStock('pixabay'),
    wikimedia: createMockStock('wikimedia'),
  }
}

export function stockAdapters(
  env: Record<string, string | undefined> = process.env,
): Record<StockProviderId, StockProvider> {
  return mockProvidersEnabled(env) ? mockStockAdapters() : LIVE_STOCK_ADAPTERS
}

export function stockAdapter(
  provider: StockProviderId,
  env: Record<string, string | undefined> = process.env,
): StockProvider {
  return stockAdapters(env)[provider]
}

export const LIVE_IMAGE_GEN_ADAPTERS: Record<ImageGenProviderId, ImageGenProvider> = {
  fal: falImageGen,
  google: geminiImageGen,
}

export function imageGenAdapter(
  provider: ImageGenProviderId,
  env: Record<string, string | undefined> = process.env,
): ImageGenProvider {
  return mockProvidersEnabled(env) ? mockImageGen : LIVE_IMAGE_GEN_ADAPTERS[provider]
}

/** A live adapter over the given model list (decision 287). */
export function liveImageGenWith(
  provider: ImageGenProviderId,
  models: readonly ImageGenModel[],
): ImageGenProvider {
  return provider === 'google' ? createGeminiImageGen(models) : createFalImageGen(models)
}

/** `imageGenAdapter` over a given model list: the mock in mock mode, else live. */
export function imageGenAdapterWith(
  provider: ImageGenProviderId,
  models: readonly ImageGenModel[],
  env: Record<string, string | undefined> = process.env,
): ImageGenProvider {
  return mockProvidersEnabled(env) ? mockImageGenWith(models) : liveImageGenWith(provider, models)
}
