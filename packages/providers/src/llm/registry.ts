import type { LlmProvider } from '@boom-busters/schemas'
import { anthropic } from './anthropic'
import { google } from './google'
import { createMockLLM } from './mock'
import { openai } from './openai'
import type { KnownModel, LLMProvider } from './types'

/**
 * Which set of adapters the app talks to.
 *
 * `MOCK_PROVIDERS=1` swaps all three for deterministic mocks. It is the same
 * switch M1 uses for the Credentials auth provider, and the same rule applies:
 * the mock must never be reachable in a production deployment by accident, so
 * the flag has to be set explicitly and is never defaulted on.
 */

export const LIVE_ADAPTERS: Record<LlmProvider, LLMProvider> = {
  anthropic,
  openai,
  google,
}

export function mockAdapters(): Record<LlmProvider, LLMProvider> {
  return {
    anthropic: createMockLLM({}, 'anthropic'),
    openai: createMockLLM({}, 'openai'),
    google: createMockLLM({}, 'google'),
  }
}

export function useMockProviders(env: Record<string, string | undefined> = process.env): boolean {
  return env['MOCK_PROVIDERS'] === '1'
}

export function llmAdapters(
  env: Record<string, string | undefined> = process.env,
): Record<LlmProvider, LLMProvider> {
  return useMockProviders(env) ? mockAdapters() : LIVE_ADAPTERS
}

/**
 * Every model the app will accept, by provider — the list Settings → Models
 * fills its dropdowns from.
 *
 * Build spec section 6 puts this on the adapters, replacing the provisional
 * `KNOWN_MODELS` table that lived in `packages/schemas` through M1 and M2.
 * It is always the live line-up even in mock mode: the routing matrix is
 * configuration that outlives a test run, and offering "mock-large" as a
 * choice in Settings would write nonsense into the settings row.
 */
export const LLM_MODELS: Record<LlmProvider, readonly KnownModel[]> = {
  anthropic: anthropic.models,
  openai: openai.models,
  google: google.models,
}

export function knownModel(provider: LlmProvider, modelId: string): KnownModel | undefined {
  return LLM_MODELS[provider].find((m) => m.id === modelId)
}

/** The most capable model a provider offers — the sane default for a task. */
export function topModel(provider: LlmProvider): KnownModel {
  const best = [...LLM_MODELS[provider]].sort((a, b) => a.tier - b.tier)[0]
  if (!best) throw new Error(`${provider} has no models listed`)
  return best
}
