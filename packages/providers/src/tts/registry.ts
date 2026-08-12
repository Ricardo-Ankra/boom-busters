import type { TtsProvider } from '@boom-busters/schemas'
import { mockProvidersEnabled } from '../llm/registry'
import { elevenlabsTts } from './elevenlabs'
import { geminiTts, GEMINI_VOICES } from './gemini'
import { createMockTTS } from './mock'
import type { KnownVoice, TTSProvider } from './types'

/**
 * Which set of TTS adapters the app talks to — the same switch, and the same
 * rule, as `llmAdapters`: `MOCK_PROVIDERS=1` swaps both vendors for
 * deterministic mocks, and the flag is never defaulted on.
 */

export const LIVE_TTS_ADAPTERS: Record<TtsProvider, TTSProvider> = {
  gemini: geminiTts,
  elevenlabs: elevenlabsTts,
}

export function mockTtsAdapters(): Record<TtsProvider, TTSProvider> {
  return {
    gemini: createMockTTS({}, 'gemini'),
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
 * USD per 1,000 characters, by provider — the table `packages/cost` derives its
 * TTS prices from.
 *
 * Always the live figures, even in mock mode, for the reason `LLM_MODELS` is:
 * a budget cap is configuration that outlives a test run, and estimating spend
 * from a mock's price would make every cap in the app hold or break for the
 * wrong reason.
 */
export const TTS_PRICES_PER_KCHAR: Record<TtsProvider, number> = {
  gemini: geminiTts.pricePerKChar,
  elevenlabs: elevenlabsTts.pricePerKChar,
}

/**
 * The voices that can be offered without a key.
 *
 * Gemini's are a property of the model, so they are always available; the
 * ElevenLabs list is the account's and needs a call, so the audition panel asks
 * for it separately and shows why when it cannot.
 */
export const STATIC_VOICES: Partial<Record<TtsProvider, readonly KnownVoice[]>> = {
  gemini: GEMINI_VOICES,
}
