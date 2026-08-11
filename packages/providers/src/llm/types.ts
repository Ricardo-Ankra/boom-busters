import type { LlmProvider, LlmTask } from '@boom-busters/schemas'

/**
 * The provider-independent shape of an LLM call (build spec section 6).
 *
 * Every adapter takes this and normalises its own API's message format, batch
 * mode and prompt-caching mechanics behind it. Nothing above this layer knows
 * which vendor answered — that is what makes the router's fallback possible.
 */

export interface Msg {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMTaskRequest {
  task: LlmTask
  system: string
  messages: Msg[]
  maxTokens: number
  /**
   * Route through the provider's batch API where it has one. Batch work is
   * cheaper and slower, so the caller decides; adapters that have no batch
   * mode ignore this rather than failing.
   */
  useBatch?: boolean
  /**
   * Marks the prefix that is stable across calls in a stage (the style bible,
   * the approved outline) so adapters can apply prompt caching. Counted in
   * messages from the start; adapters without caching ignore it.
   */
  cacheablePrefixMessages?: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  /** Input tokens served from the provider's prompt cache, where reported. */
  cachedInputTokens?: number
}

export interface LLMResult {
  text: string
  usage: TokenUsage
  /** What actually answered — not what was asked for. The router may differ. */
  provider: LlmProvider
  model: string
  /** True when the provider returned a truncated answer at `maxTokens`. */
  truncated: boolean
}

/**
 * A model as the adapter knows it: the id sent on the wire, its price, and
 * where it sits in the provider's own capability order.
 *
 * `tier` is what makes the router's "one model tier down within the same
 * provider" concrete: 0 is the provider's most capable model, and the router
 * downgrades to the next tier up in number.
 */
export interface KnownModel {
  /** The id the settings matrix stores and the adapter sends. */
  id: string
  /** Shown in the Settings → Models dropdown. */
  label: string
  tier: number
  /** USD per million input tokens. */
  inputPerMTok: number
  /** USD per million output tokens. */
  outputPerMTok: number
  /** USD per million tokens read from the prompt cache, where offered. */
  cachedInputPerMTok?: number
  /** Whether `useBatch` does anything for this model. */
  supportsBatch: boolean
}

/**
 * One vendor. Adapters are pure async functions over an API key: no database,
 * no cost recording, no retry policy of their own (spec section 3 — "adapters
 * are pure; the caller records costs"). Their single job is to make the call
 * and to translate the vendor's failures into the shared error taxonomy.
 */
export interface LLMProvider {
  readonly id: LlmProvider
  /** Every model this adapter will accept, most capable first. */
  readonly models: readonly KnownModel[]
  /**
   * Make the call. Throws `TransientProviderError`/`RateLimitError` for
   * anything worth retrying, `ContentPolicyError` for a refusal, and
   * `ValidationError` for a request this adapter will not send.
   */
  complete(request: LLMTaskRequest, options: CallOptions): Promise<LLMResult>
  /**
   * The cheapest call that proves a key works, for Settings → Connections.
   * Resolves on success and throws the same taxonomy on failure.
   *
   * `fetchImpl` is not optional decoration: without it this method can only be
   * exercised by calling the vendor for real, which is exactly what CLAUDE.md
   * rule 6 forbids during development. Every call out of this package has to
   * be interceptable.
   */
  verifyKey(apiKey: string, options?: VerifyOptions): Promise<void>
}

export interface VerifyOptions {
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

export interface CallOptions {
  apiKey: string
  model: string
  signal?: AbortSignal
  /** Overridden by tests and by the mock adapter; adapters never call fetch directly. */
  fetchImpl?: typeof fetch
}

/** Look up a model on an adapter, or explain why it is not there. */
export function findModel(provider: LLMProvider, modelId: string): KnownModel | undefined {
  return provider.models.find((m) => m.id === modelId)
}

/**
 * The next model down within a provider, or `undefined` at the bottom.
 *
 * Ordering is by `tier` rather than by array position so that adding a model
 * in the middle of a provider's line-up cannot silently reorder the fallback
 * path.
 */
export function nextTierDown(provider: LLMProvider, modelId: string): KnownModel | undefined {
  const current = findModel(provider, modelId)
  if (!current) return undefined

  return provider.models.filter((m) => m.tier > current.tier).sort((a, b) => a.tier - b.tier)[0]
}

/** USD for a completed call, from the model's own price row. */
export function priceOf(model: KnownModel, usage: TokenUsage): number {
  const cached = usage.cachedInputTokens ?? 0
  const freshInput = Math.max(0, usage.inputTokens - cached)
  const cachedRate = model.cachedInputPerMTok ?? model.inputPerMTok

  const usd =
    (freshInput / 1_000_000) * model.inputPerMTok +
    (cached / 1_000_000) * cachedRate +
    (usage.outputTokens / 1_000_000) * model.outputPerMTok

  // The ledger column is numeric(12,4); rounding here keeps the estimate and
  // the settled figure comparable rather than differing in the sixth decimal.
  return Math.round(usd * 10_000) / 10_000
}

/**
 * Room for the model to think *and* answer.
 *
 * `max_tokens` is one budget covering reasoning and the reply, so a figure
 * sized from the expected answer alone can be spent entirely on thinking —
 * the call returns at full price with no text block at all. That is exactly
 * how the first live `Suggest cases` failed: 1,300 tokens, all consumed,
 * nothing written, and an error blaming the JSON parser.
 *
 * So every prompt asks for what it needs for the answer and this adds the
 * headroom. Over-asking is close to free: `max_tokens` is a ceiling, and the
 * ledger settles on tokens actually produced. Under-asking costs the whole
 * call.
 */
export const THINKING_HEADROOM_TOKENS = 4000
export const MAX_OUTPUT_TOKENS = 32_000

export function outputBudget(answerTokens: number): number {
  return Math.min(
    MAX_OUTPUT_TOKENS,
    Math.max(1, Math.round(answerTokens)) + THINKING_HEADROOM_TOKENS,
  )
}
