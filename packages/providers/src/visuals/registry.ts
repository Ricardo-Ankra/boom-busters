import { mockProvidersEnabled } from '../llm/registry'
import { falImageGen } from './fal'
import { geminiImageGen } from './gemini'
import { createMockStock, mockImageGen } from './mock'
import { pexelsStock } from './pexels'
import { pixabayStock } from './pixabay'
import type { ImageGenProvider, ImageGenProviderId, StockProvider, StockProviderId } from './types'
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
