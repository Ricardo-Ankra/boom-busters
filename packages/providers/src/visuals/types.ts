import type { SlotCandidate } from '@boom-busters/schemas'

/**
 * The visual-asset providers (build spec section 6): stock search, archival
 * search, and image generation, behind the same rules as `LLMProvider` and
 * `TTSProvider` — pure async functions over an API key, no database, no cost
 * recording, no retry policy of their own.
 */

/** The stock-search call, exactly as spec section 6 names it. */
export interface StockQuery {
  /** The literal search terms. */
  query: string
  /** The full creative brief text, for adapters that can use it (none can yet — the scoring pass does). */
  brief: string
  rejectionCriteria: readonly string[]
  /** How many candidates to fetch (before scoring narrows to the shown 4). */
  count: number
}

export interface StockCallOptions {
  /** Absent only for providers that need none (Wikimedia Commons). */
  apiKey?: string
  signal?: AbortSignal
  /** Overridden by tests and by the mock adapters; adapters never call fetch directly. */
  fetchImpl?: typeof fetch
}

export type StockProviderId = 'pexels' | 'pixabay' | 'wikimedia'

/**
 * One search source. `search` returns plain candidates — no scores; scoring
 * is a separate pass owned by the runner, so a provider swap never changes
 * how candidates are judged.
 */
export interface StockProvider {
  readonly id: StockProviderId
  /** Wikimedia Commons is keyless; the other two are keyed but free. */
  readonly requiresKey: boolean
  search(query: StockQuery, options: StockCallOptions): Promise<SlotCandidate[]>
  /** The cheapest call that proves a key works, for Settings → Connections. */
  verifyKey(apiKey: string, options?: Omit<StockCallOptions, 'apiKey'>): Promise<void>
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

export interface ImageGenRequest {
  prompt: string
  negativePrompt?: string
  /** How many variants to buy in this one call. */
  count: number
}

export interface GeneratedImage {
  /**
   * Where the bytes are RIGHT NOW. fal's output URLs expire, so the caller
   * must pull these into R2 immediately — a generated image whose only home
   * is this URL is an image the board will lose. Mock adapters return
   * `data:` URLs, which need no download at all.
   */
  url: string
  width: number
  height: number
}

export interface ImageGenResult {
  images: GeneratedImage[]
  estimatedCostUsd: number
}

export interface ImageGenProvider {
  readonly id: 'fal'
  /** USD per generated image. Owned here, like every provider price. */
  readonly pricePerImage: number
  generate(request: ImageGenRequest, options: StockCallOptions): Promise<ImageGenResult>
  verifyKey(apiKey: string, options?: Omit<StockCallOptions, 'apiKey'>): Promise<void>
}

/** USD for a generation call, from the adapter's own price. */
export function imageGenPrice(provider: ImageGenProvider, count: number): number {
  return provider.pricePerImage * count
}
