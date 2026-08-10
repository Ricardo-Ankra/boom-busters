import { KNOWN_MODELS, ValidationError } from '@boom-busters/schemas'
import type { LlmProvider, Provider, TtsProvider } from '@boom-busters/schemas'

/**
 * Price tables for the budget guard.
 *
 * PROVISIONAL. Build spec section 6 makes the per-model price table part of
 * each `LLMProvider` adapter, which lands in M3. Until then the guard needs
 * *some* table, and this is it: list prices in USD, reviewed when the adapters
 * arrive and then deleted in favour of the adapters' own.
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

export const LLM_PRICES: Record<LlmProvider, Record<string, LlmPrice>> = {
  anthropic: {
    opus: { inputPerMTok: 15, outputPerMTok: 75 },
    sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
    haiku: { inputPerMTok: 1, outputPerMTok: 5 },
  },
  openai: {
    'gpt-5': { inputPerMTok: 10, outputPerMTok: 30 },
    'gpt-5-mini': { inputPerMTok: 1, outputPerMTok: 4 },
  },
  google: {
    'gemini-3-pro': { inputPerMTok: 5, outputPerMTok: 15 },
    'gemini-3-flash': { inputPerMTok: 0.5, outputPerMTok: 2 },
  },
}

/** USD per 1,000 characters of synthesised narration. Also provisional. */
export const TTS_PRICES: Record<TtsProvider, number> = {
  gemini: 0.015,
  elevenlabs: 0.18,
}

/**
 * Providers whose free tiers we stay inside. Listed explicitly rather than
 * defaulted, so a provider that starts charging shows up as an unpriced error
 * instead of quietly estimating zero.
 */
export const FREE_PROVIDERS: readonly Provider[] = ['pexels', 'pixabay']

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
  for (const [provider, models] of Object.entries(KNOWN_MODELS)) {
    for (const model of models) {
      if (!LLM_PRICES[provider as LlmProvider][model]) missing.push(`${provider}/${model}`)
    }
  }
  return missing
}
