import type { TtsProvider } from '@boom-busters/schemas'
import { mockProvidersEnabled } from '../llm/registry'
import { elevenlabsTts } from './elevenlabs'
import { geminiTts, GEMINI_VOICES } from './gemini'
import { googleCloudTts } from './google-cloud'
import { createMockTTS } from './mock'
import type { KnownVoice, TTSProvider } from './types'

/**
 * Which set of TTS adapters the app talks to — the same switch, and the same
 * rule, as `llmAdapters`: `MOCK_PROVIDERS=1` swaps both vendors for
 * deterministic mocks, and the flag is never defaulted on.
 */

export const LIVE_TTS_ADAPTERS: Record<TtsProvider, TTSProvider> = {
  gemini: geminiTts,
  'google-cloud-tts': googleCloudTts,
  elevenlabs: elevenlabsTts,
}

export function mockTtsAdapters(): Record<TtsProvider, TTSProvider> {
  return {
    gemini: createMockTTS({}, 'gemini'),
    'google-cloud-tts': createMockTTS({}, 'google-cloud-tts'),
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
 * Whether asking this narrator to read the same words again can produce a
 * different performance — the fact behind offering "try again" or not.
 *
 * Resolved through `ttsAdapters` rather than the live table, so that in mock
 * mode the answer is the mock's: it seeds on the take number and genuinely does
 * vary, which is what lets an E2E prove the A/B toggle compares two things.
 */
export function rereadCanDiffer(
  provider: TtsProvider,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return ttsAdapter(provider, env).rereadCanDiffer
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
  'google-cloud-tts': googleCloudTts.pricePerKChar,
  elevenlabs: elevenlabsTts.pricePerKChar,
}

/**
 * The voices that can be offered without a key.
 *
 * Gemini's are a property of the model, so they are always available. The
 * ElevenLabs and Cloud TTS lists belong to the account and need a call, so the
 * audition panel asks for them separately and shows why when it cannot.
 *
 * **`GEMINI_VOICES` is the one unverified list left in this package.** It was
 * written from assumption, exactly as the Gemini model ids were, and it has not
 * been proved against a live key: Google checks billing before it validates a
 * voice name, so a bogus voice returns 429 rather than 400. Treat it with
 * suspicion until a funded key says otherwise.
 */
export const STATIC_VOICES: Partial<Record<TtsProvider, readonly KnownVoice[]>> = {
  gemini: GEMINI_VOICES,
}
