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

/** A fresh download for a known asset — what `StockProvider.refetch` returns. */
export interface StockRefetch {
  sourceUrl: string
  /** The small variant for the browser preview, when the provider offers one. */
  previewSourceUrl?: string
  width?: number
  height?: number
  durationMs?: number
}

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
  /**
   * A fresh `sourceUrl` for an asset this provider already returned, looked
   * up by the candidate's provider-scoped id. Exists because a download URL
   * can expire while the id stays permanent — Pixabay's image URLs are
   * session-signed and die within a day — and ingestion needs a live URL to
   * pull bytes from. Null means the asset is gone from the provider. Absent
   * on providers whose URLs are stable (Wikimedia).
   */
  refetch?(
    input: { id: string; kind: 'image' | 'video' },
    options: StockCallOptions,
  ): Promise<StockRefetch | null>
  /** The cheapest call that proves a key works, for Settings → Connections. */
  verifyKey(apiKey: string, options?: Omit<StockCallOptions, 'apiKey'>): Promise<void>
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

/** Output size for models that take one (decision 275). */
export type ImageSize = '1K' | '2K' | '4K'

/**
 * A reference photograph of a real person the still must resemble (decision
 * 253). Base64 bytes for adapters that take images inline (Gemini); fal's
 * identity endpoints want URLs, which travel separately as `referenceUrls`.
 */
export interface ImageReference {
  /** The person's full name, for the prompt. */
  name: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  /** Base64 bytes. Absent when the caller only has URLs for a URL-taking endpoint. */
  data?: string
  /**
   * Which budget this spends (decision 264). Google documents the two
   * separately and by different amounts: a face the model must keep is a
   * character, a room or a prop it must reproduce is an object.
   */
  kind: 'character' | 'object'
  /** For a set plate: the direction it faces, named in the image's label (decision 275). */
  facing?: 'north' | 'east' | 'south' | 'west' | 'detail'
}

export interface ImageGenRequest {
  prompt: string
  negativePrompt?: string
  /** Reference photos, one per depicted cast member. Absent for a text-only still. */
  references?: ImageReference[]
  /** Presigned GET URLs for the same photos, in the same order, for URL-taking endpoints. */
  referenceUrls?: string[]
  /** How many variants to buy in this one call. */
  count: number
  /**
   * Which of the adapter's models to use — `settings.modelRouting.stills`
   * (decision 208). Absent means the adapter's first listed model. An id the
   * adapter does not list is refused before any money is spent.
   */
  model?: string
  /** Honoured by the Gemini 3 models; ignored elsewhere. */
  size?: ImageSize
}

export interface GeneratedImage {
  /**
   * Where the bytes are RIGHT NOW. fal's output URLs expire, so the caller
   * must pull these into R2 immediately — a generated image whose only home
   * is this URL is an image the board will lose. Gemini returns its bytes
   * inline, surfaced here as `data:` URLs the caller decodes rather than
   * fetches; the mock adapter's `data:` thumbnails need no download at all.
   */
  url: string
  width: number
  height: number
}

export interface ImageGenResult {
  images: GeneratedImage[]
  estimatedCostUsd: number
}

/**
 * `google` is Gemini's image model riding the same key the LLM/TTS adapters
 * already use, which is why it is the default still generator: it costs the
 * user no extra account. `fal` (FLUX) is the alternative when no Google key
 * is stored.
 */
export type ImageGenProviderId = 'fal' | 'google'

/** One model an image adapter offers — id, label, and its own price. */
export interface ImageGenModel {
  readonly id: string
  /** Human-readable — licence lines say "Generated (<label>)". */
  readonly label: string
  /** USD per generated image. Owned here, like every provider price. */
  readonly pricePerImage: number
  /** USD per generated image, by output size, for models whose price varies with it (decision 275). */
  readonly pricesBySize?: Partial<Record<ImageSize, number>>
}

/** What one call may carry, per model (decision 264). */
export interface ReferenceLimits {
  characters: number
  objects: number
}

export interface ImageGenProvider {
  readonly id: ImageGenProviderId
  /** The provider, human-readable — the model labels name the models. */
  readonly label: string
  /**
   * Every model this adapter will accept, the default first — the same shape
   * as `LLMProvider.models` (decision 208). The Settings → Models dropdown is
   * rendered from this list, and `generate` refuses an id that is not on it.
   */
  readonly models: readonly ImageGenModel[]
  generate(request: ImageGenRequest, options: StockCallOptions): Promise<ImageGenResult>
  /**
   * How many references of each kind this model takes. The caller spends the
   * budget before building the request, because a refusal after the money is
   * committed is a refusal that cost something, and because "some of the
   * cast" is not an answer the producer asked for.
   */
  referenceLimits(modelId?: string): ReferenceLimits
  /**
   * The endpoint that will actually run when this many reference photographs
   * are attached, when it is not the routed model itself (decision 253,
   * amended). No text-to-image endpoint accepts a photograph, so fal leaves
   * the routed model for a reference endpoint in the same family, at a
   * different price; Gemini takes its references inline on the same model and
   * implements nothing here.
   *
   * The caller needs this BEFORE the call: the ledger reserves against an
   * estimate, and an estimate for the wrong endpoint under-reserves by two to
   * four times. Null means the routed model runs as itself.
   */
  referenceRoute?(modelId: string | undefined, referenceCount: number): ImageGenModel | null
  verifyKey(apiKey: string, options?: Omit<StockCallOptions, 'apiKey'>): Promise<void>
}

/**
 * The model a request resolves to: the named one, or the adapter's first.
 * Throws on an id the adapter does not list — the caller is about to spend
 * money on it, and a typo'd routing must fail before the purchase, naming
 * the setting that holds it.
 */
export function imageGenModel(provider: ImageGenProvider, modelId?: string): ImageGenModel {
  if (modelId === undefined) return provider.models[0]!
  const model = provider.models.find((candidate) => candidate.id === modelId)
  if (!model) {
    throw new Error(
      `${provider.id} does not offer the image model "${modelId}" — ` +
        `fix modelRouting.stills in Settings → Models.`,
    )
  }
  return model
}

/** USD for a generation call, from the adapter's own price for that model and size. */
export function imageGenPrice(
  provider: ImageGenProvider,
  count: number,
  modelId?: string,
  size?: ImageSize,
): number {
  const model = imageGenModel(provider, modelId)
  return ((size ? model.pricesBySize?.[size] : undefined) ?? model.pricePerImage) * count
}
