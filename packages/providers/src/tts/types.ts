import type { PhonemeHint, StabilityTier, TtsProvider, WordTiming } from '@boom-busters/schemas'

/**
 * The shape of a narration call (build spec section 6), sized to the one
 * vendor that remains.
 *
 * Until 2026-08-14 this interface abstracted over three vendors, and carried
 * the capability flags (`rereadCanDiffer`, `promptSteered`) and per-vendor
 * fields (`stylePrompt`, `pacing`, `direction`) that let the app ask which
 * narrator it was talking to. The Google narrators are gone — Chirp could not
 * vary a reading, Gemini could not hold one steady — and with them went the
 * flags: ElevenLabs samples, so a second take always differs; nothing is
 * prompt-steered, so direction lives *in the text* as audio tags rather than
 * in a side channel.
 *
 * Two deliberate carry-overs from the multi-vendor era, both about where a
 * decision belongs:
 *
 * **Adapters return raw PCM, not a container** — 16-bit signed little-endian
 * mono samples. Wrapping into a WAV is done once, above the adapter, so one
 * piece of code decides the container, computes the duration from the byte
 * count, and derives the waveform.
 *
 * **`estimatedCostUsd` is priced from the text, not from the response.** No
 * TTS vendor returns a per-request charge, so the honest word is "estimated"
 * and the ledger settles on characters synthesised.
 */

export interface TTSRequest {
  /**
   * The narration text, verbatim from the script — including narration tags.
   * On Eleven v3 anything bracketed is direction, never spoken, so the tags
   * ride along rather than being stripped or translated.
   */
  text: string
  voiceId: string
  /** Terms this narrator cannot be trusted to say (spec section 6). */
  phonemeHints: readonly PhonemeHint[]
  /** `hash(projectId, chapterId, paragraphIndex, textHash, voiceId, …)`. */
  idempotencyKey: string
  /** `settings.tts.stability` — Eleven v3's three-way delivery control. */
  stability?: StabilityTier
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
   * Word-level timings from the vendor's character alignment, when the
   * endpoint returns one. Stored on the take so assembly aligns for free;
   * absent means the take will need Whisper at assembly time.
   */
  wordTimings?: WordTiming[]
  /**
   * Pronunciation hints the vendor cannot honour, and which were therefore
   * dropped.
   *
   * On Eleven v3 that is every IPA hint: the model takes no phoneme markup,
   * only respellings substituted into the text. The take is still good — the
   * words were spoken, just with the narrator's own idea of how to say them.
   * Reported rather than swallowed because spec principle 6 allows degrading
   * and forbids doing it quietly.
   */
  droppedPronunciations?: string[]
}

/**
 * A voice as the audition panel needs to show it.
 *
 * Referenced, never stored (spec section 10.1): the app persists a voice id,
 * and the vendor owns the audio model behind it.
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
  synthesise(request: TTSRequest, options: TTSCallOptions): Promise<TTSResult>
  /** The voices on offer — whatever the account holds, so it is a call. */
  voices(options: VoiceListOptions): Promise<KnownVoice[]>
  /** The cheapest call that proves a key works, for Settings → Connections. */
  verifyKey(apiKey: string, options?: Omit<VoiceListOptions, 'apiKey'>): Promise<void>
}

/** USD for a synthesis, from the adapter's own price. */
export function ttsPrice(provider: TTSProvider, text: string): number {
  return (text.length / 1000) * provider.pricePerKChar
}
