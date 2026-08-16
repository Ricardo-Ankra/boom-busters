import { mockProvidersEnabled } from '../llm/registry'
import { falImageGen } from './fal'
import { createMockStock, mockImageGen } from './mock'
import { pexelsStock } from './pexels'
import { pixabayStock } from './pixabay'
import type { ImageGenProvider, StockProvider, StockProviderId } from './types'
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

export function imageGenAdapter(
  env: Record<string, string | undefined> = process.env,
): ImageGenProvider {
  return mockProvidersEnabled(env) ? mockImageGen : falImageGen
}

/**
 * USD per generated image — the figure `packages/cost` derives the fal price
 * from. Always the live figure, even in mock mode, for the reason every
 * price table here is.
 */
export const FAL_PRICE_PER_IMAGE = falImageGen.pricePerImage
