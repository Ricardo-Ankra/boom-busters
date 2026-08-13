import type { PhonemeHint, TtsProvider } from '@boom-busters/schemas'

/**
 * The provider-independent shape of a narration call (build spec section 6).
 *
 * Two deliberate differences from the spec's sketch, both about where a
 * decision belongs:
 *
 * **Adapters return raw PCM, not a container.** The spec's `TTSResult` says
 * `audioBuffer`, and this is it — 16-bit signed little-endian mono samples,
 * exactly as both vendors will emit them when asked. Wrapping those into a WAV
 * is done once, above the adapters, so that one piece of code decides the
 * container, computes the duration from the byte count, and derives the
 * waveform. Two adapters each writing their own header is two chances to
 * disagree about how long a paragraph is.
 *
 * **`estimatedCostUsd` is priced from the text, not from the response.** No TTS
 * vendor returns a per-request charge, so the honest word is "estimated" and
 * the ledger settles on characters synthesised — which is what both vendors
 * bill on anyway.
 */

export interface TTSRequest {
  text: string
  voiceId: string
  /** Free-text direction: "measured, documentary, no theatrics". */
  stylePrompt?: string
  /** Terms this narrator cannot be trusted to say (spec section 6). */
  phonemeHints: readonly PhonemeHint[]
  /** `hash(projectId, chapterId, paragraphIndex, textHash, voiceId)`. */
  idempotencyKey: string
  /** `settings.tts.pacing`, 0.25–2. Adapters without a speed control ignore it. */
  pacing?: number
  /**
   * Direction for *this take only*: "slower on the dates", "less cheerful".
   *
   * Distinct from `stylePrompt`, which is the channel's standing voice. This
   * one comes from a retake form or a flag note and applies to one purchase.
   * Only a prompt-steered narrator (Gemini) can honour it; the parameterised
   * vendors have nowhere to put a sentence of English and ignore it — which is
   * why the UI only offers a direction field where `rereadCanDiffer`.
   */
  direction?: string
}

export interface TTSResult {
  /** 16-bit signed little-endian mono PCM. */
  audioBuffer: Buffer
  sampleRate: number
  durationMs: number
  estimatedCostUsd: number
  /** What actually spoke, for the ledger and the take row. */
  provider: TtsProvider
  voiceId: string
  /**
   * Pronunciation hints the vendor refused, and which were therefore dropped.
   *
   * The take is still good — the words were spoken, just with the narrator's
   * own idea of how to say them. Reported rather than swallowed because spec
   * principle 6 allows degrading and forbids doing it quietly: something
   * auto-substituted must be visibly flagged.
   */
  droppedPronunciations?: string[]
}

/**
 * A voice as the audition panel needs to show it.
 *
 * Referenced, never stored (spec section 10.1): the app persists a provider and
 * a voice id, and the vendor owns the audio model behind it.
 */
export interface KnownVoice {
  id: string
  label: string
  /** One line for the audition card — accent, register, what it suits. */
  description?: string
}

export interface TTSCallOptions {
  apiKey: string
  signal?: AbortSignal
  /** Overridden by tests and by the mock adapter; adapters never call fetch directly. */
  fetchImpl?: typeof fetch
}

export interface VoiceListOptions {
  apiKey: string
  signal?: AbortSignal
  fetchImpl?: typeof fetch
}

/**
 * One TTS vendor. Pure async functions over an API key, on the same terms as
 * `LLMProvider`: no database, no cost recording, no retry policy of their own.
 */
export interface TTSProvider {
  readonly id: TtsProvider
  /** USD per 1,000 characters of text. Owned here, per decision 23. */
  readonly pricePerKChar: number
  /**
   * Sample rate this adapter asks the vendor for. Fixed per adapter rather
   * than negotiated: narration is mono speech, and one rate per provider keeps
   * the duration arithmetic honest.
   */
  readonly sampleRate: number
  /**
   * Whether reading the same text again can produce a different performance.
   *
   * A property of the vendor, so it belongs beside its price rather than being
   * guessed at by the UI. It decides whether "try again" is a button worth
   * offering: on a provider that cannot vary, pressing it buys audio identical
   * to what was just rejected, and the honest screen is one that says so and
   * points at the words instead.
   *
   * True for ElevenLabs, which samples at `stability: 0.38` with no seed, and
   * for Gemini, which is an LLM taking a written style prompt. False for Cloud
   * Text-to-Speech, which exposes no sampling control — no temperature, no
   * seed, no style field — so the same request returns the same reading.
   *
   * Not the same as "cannot be directed". Chirp 3 HD takes pause markup and
   * custom pronunciations and responds to punctuation; all of those change the
   * *input*, which is why they belong to the re-read and not to this flag.
   */
  readonly rereadCanDiffer: boolean
  synthesise(request: TTSRequest, options: TTSCallOptions): Promise<TTSResult>
  /**
   * The voices on offer. Gemini's list is static and ships with the adapter;
   * ElevenLabs' is whatever the account holds, so it is a call.
   */
  voices(options: VoiceListOptions): Promise<KnownVoice[]>
  /** The cheapest call that proves a key works, for Settings → Connections. */
  verifyKey(apiKey: string, options?: Omit<VoiceListOptions, 'apiKey'>): Promise<void>
}

/** USD for a synthesis, from the adapter's own price. */
export function ttsPrice(provider: TTSProvider, text: string): number {
  return (text.length / 1000) * provider.pricePerKChar
}
