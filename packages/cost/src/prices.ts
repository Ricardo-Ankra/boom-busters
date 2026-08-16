import { FAL_PRICE_PER_IMAGE, LLM_MODELS, TTS_PRICES_PER_KCHAR } from '@boom-busters/providers'
import { ValidationError } from '@boom-busters/schemas'
import type { LlmProvider, TtsProvider } from '@boom-busters/schemas'

/**
 * Price tables for the budget guard.
 *
 * LLM prices are no longer written here. Build spec section 6 puts the
 * per-model price table on each `LLMProvider` adapter, and M3 delivered it, so
 * this module now derives from `LLM_MODELS` rather than keeping a second copy.
 * Two hand-maintained tables would eventually disagree, and the one the guard
 * happened to read would decide whether a cap held.
 *
 * The adapters' figures are themselves PROVISIONAL — see the note in
 * `packages/providers/src/llm/anthropic.ts`. Confirm them against the vendors'
 * current price lists before the first live run.
 *
 * The one rule that is not provisional: an unpriced model is an error, never
 * a free one. A silent $0 estimate would make every cap in the app pass, which
 * is precisely the failure the guard exists to prevent.
 */

export interface LlmPrice {
  /** USD per million input tokens. */
  inputPerMTok: number
  /** USD per million output tokens. */
  outputPerMTok: number
}

function pricesFromAdapters(): Record<LlmProvider, Record<string, LlmPrice>> {
  const table = {} as Record<LlmProvider, Record<string, LlmPrice>>

  for (const [provider, models] of Object.entries(LLM_MODELS) as [
    LlmProvider,
    (typeof LLM_MODELS)[LlmProvider],
  ][]) {
    table[provider] = Object.fromEntries(
      models.map((model) => [
        model.id,
        { inputPerMTok: model.inputPerMTok, outputPerMTok: model.outputPerMTok },
      ]),
    )
  }

  return table
}

export const LLM_PRICES: Record<LlmProvider, Record<string, LlmPrice>> = pricesFromAdapters()

/**
 * USD per 1,000 characters of synthesised narration.
 *
 * Derived from the TTS adapters for the same reason `LLM_PRICES` is: decision
 * 23 puts the price table on the adapter that knows what it is buying, and two
 * hand-maintained tables would eventually disagree — with the one the guard
 * happened to read deciding whether a cap held. Also provisional.
 */
export const TTS_PRICES: Record<TtsProvider, number> = TTS_PRICES_PER_KCHAR

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export function llmPrice(provider: LlmProvider, model: string): LlmPrice {
  const price = LLM_PRICES[provider][model]
  if (!price) {
    throw new ValidationError(
      `No price for ${provider}/${model}. Add it to packages/cost before routing a task at it — ` +
        `an unpriced model would estimate $0 and walk straight through every budget cap.`,
      { field: 'modelRouting' },
    )
  }
  return price
}

export function estimateLlmUsd(args: {
  provider: LlmProvider
  model: string
  inputTokens: number
  outputTokens: number
}): number {
  const price = llmPrice(args.provider, args.model)
  return (
    (args.inputTokens / 1_000_000) * price.inputPerMTok +
    (args.outputTokens / 1_000_000) * price.outputPerMTok
  )
}

export function estimateTtsUsd(args: { provider: TtsProvider; characters: number }): number {
  const per1k = TTS_PRICES[args.provider]
  if (per1k === undefined) {
    throw new ValidationError(`No price for TTS provider ${args.provider}.`, { field: 'tts' })
  }
  return (args.characters / 1000) * per1k
}

/**
 * USD for a still-generation call. Derived from the fal adapter's own price,
 * same rule as every table above. Stock and archival searches have no entry
 * here on purpose: the APIs are free, and their ledger rows record $0 actual
 * rather than passing through an invented estimate.
 */
export function estimateImageGenUsd(count: number): number {
  return FAL_PRICE_PER_IMAGE * count
}

/**
 * Rough output-token budget for a chapter of narration. Scripting steps draft
 * 2-3k words each (spec section 7), and the guard needs a number *before* the
 * call, so this deliberately errs high: an estimate that is too low is the one
 * that lets a run blow through a cap.
 */
export function estimateChapterTokens(targetWords: number): number {
  return Math.ceil(targetWords * 1.5)
}

/** Every model offered in Settings must have a price. Asserted by a test. */
export function unpricedKnownModels(): string[] {
  const missing: string[] = []
  for (const [provider, models] of Object.entries(LLM_MODELS)) {
    for (const model of models) {
      if (!LLM_PRICES[provider as LlmProvider][model.id]) missing.push(`${provider}/${model.id}`)
    }
  }
  return missing
}
