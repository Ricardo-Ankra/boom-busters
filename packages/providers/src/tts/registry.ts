import type { TtsProvider } from '@boom-busters/schemas'
import { mockProvidersEnabled } from '../llm/registry'
import { elevenlabsTts } from './elevenlabs'
import { createMockTTS } from './mock'
import type { TTSProvider } from './types'

/**
 * Which TTS adapter the app talks to — the same switch, and the same rule, as
 * `llmAdapters`: `MOCK_PROVIDERS=1` swaps the vendor for a deterministic mock,
 * and the flag is never defaulted on.
 *
 * A registry of one, kept as a registry: every caller resolves the adapter by
 * provider id rather than importing `elevenlabsTts` directly, so the mock
 * switch has one place to act and the call sites did not have to change when
 * the vendor count went from three to one.
 */

export const LIVE_TTS_ADAPTERS: Record<TtsProvider, TTSProvider> = {
  elevenlabs: elevenlabsTts,
}

export function mockTtsAdapters(): Record<TtsProvider, TTSProvider> {
  return {
    elevenlabs: createMockTTS({}, 'elevenlabs'),
  }
}

export function ttsAdapters(
  env: Record<string, string | undefined> = process.env,
): Record<TtsProvider, TTSProvider> {
  return mockProvidersEnabled(env) ? mockTtsAdapters() : LIVE_TTS_ADAPTERS
}

export function ttsAdapter(
  provider: TtsProvider,
  env: Record<string, string | undefined> = process.env,
): TTSProvider {
  return ttsAdapters(env)[provider]
}

/**
 * USD per 1,000 characters, by provider — the table `packages/cost` derives
 * its TTS prices from.
 *
 * Always the live figure, even in mock mode, for the reason `LLM_MODELS` is:
 * a budget cap is configuration that outlives a test run, and estimating spend
 * from a mock's price would make every cap in the app hold or break for the
 * wrong reason.
 */
export const TTS_PRICES_PER_KCHAR: Record<TtsProvider, number> = {
  elevenlabs: elevenlabsTts.pricePerKChar,
}
