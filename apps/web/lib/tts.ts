import 'server-only'

import { estimateTtsUsd, withCost } from '@boom-busters/cost'
import { getSettings, ttsCredential } from '@boom-busters/db'
import { encodeWav, ttsAdapter, waveformPeaks, withRateLimitPatience } from '@boom-busters/providers'
import type { TTSRequest, TTSResult } from '@boom-busters/providers'
import { TTS_CREDENTIAL_PROVIDER, ValidationError } from '@boom-busters/schemas'
import type { Settings, TtsProvider } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * The one way this app buys narration — `lib/llm.ts` for the voice stage.
 *
 * Same three non-optional things bound together, for the same reason:
 *
 *  1. **Configuration** comes from the settings row, read fresh: which
 *     provider, which voice, what pacing, which pronunciations.
 *  2. **The budget guard** wraps it, so a paragraph that would cross a monthly
 *     cap raises `BudgetExceededError` before a vendor is contacted. Narration
 *     is the first stage that fans out over dozens of paid calls in a few
 *     seconds, which makes it the first stage that can empty a cap faster than
 *     a human can watch it happen.
 *  3. **Pre-flight fails at the key, not mid-pipeline** (spec section 6). A
 *     voice stage that discovers on paragraph forty that there is no
 *     ElevenLabs key has already bought thirty-nine paragraphs it cannot
 *     finish the chapter with.
 *
 * There is no unguarded escape hatch, for the reason `lib/llm.ts` gives: a
 * second path to the vendors would eventually be the one that spends outside
 * the cap.
 */

export interface SynthesisInput {
  text: string
  idempotencyKey: string
  /** Attributes the spend to a project on the Costs screen. */
  projectId?: string
  /** Overrides the configured voice — the audition panel's whole purpose. */
  voiceOverride?: { provider: TtsProvider; voiceId: string }
  /** One-take direction from a retake form or flag note. See `TTSRequest.direction`. */
  direction?: string
  signal?: AbortSignal
}

/** What a stored take needs, which is more than the vendor hands back. */
export interface Narration {
  /** A complete WAV file: header plus the vendor's PCM. */
  wav: Buffer
  durationMs: number
  costUsd: number
  waveform: number[]
  provider: TtsProvider
  voiceId: string
  /**
   * Pronunciation hints the vendor refused and the adapter therefore dropped.
   *
   * The take is still good — the words were spoken, just the narrator's own way
   * — but principle 6 forbids degrading silently, so this travels up to be
   * recorded on the run and shown beside the hint that caused it.
   */
  droppedPronunciations?: string[]
}

/**
 * Fail before spending when a provider has no usable key.
 *
 * Exported so the runner can call it once at the top of a stage rather than
 * discovering it on the first paragraph — the error names the screen that fixes
 * it, which is the difference between a failure a human can act on and one they
 * have to investigate.
 */
export async function requireTtsKey(provider: TtsProvider): Promise<string> {
  const key = await ttsCredential(db, provider, env.SECRETS_ENCRYPTION_KEY)

  if (!key || key.trim() === '') {
    const account = TTS_CREDENTIAL_PROVIDER[provider]
    throw new ValidationError(
      `No working API key for ${provider}. Add the ${account} key in Settings → Connections ` +
        'before running the voice stage.',
      { field: `connections.${account}` },
    )
  }

  return key
}

export async function synthesise(
  input: SynthesisInput,
  settingsOverride?: Settings,
): Promise<Narration> {
  const settings = settingsOverride ?? (await getSettings(db))
  const voice = settings.tts

  const provider = input.voiceOverride?.provider ?? voice.provider
  const voiceId = input.voiceOverride?.voiceId ?? voice.voiceId

  if (voiceId.trim() === '') {
    throw new ValidationError(
      'No narration voice has been chosen. Pick one in Settings → Voice audition first.',
      { field: 'tts.voiceId' },
    )
  }

  const apiKey = await requireTtsKey(provider)
  const adapter = ttsAdapter(provider)

  const request: TTSRequest = {
    text: input.text,
    voiceId,
    stylePrompt: voice.stylePrompt,
    phonemeHints: voice.phonemeHints,
    idempotencyKey: input.idempotencyKey,
    pacing: voice.pacing,
    ...(input.direction && input.direction.trim() !== ''
      ? { direction: input.direction.trim() }
      : {}),
  }

  /**
   * The whole guarded call sits inside the rate-limit patience, not just the
   * vendor request: each retry re-reserves against the ceiling and settles or
   * releases on its own, so a wait can never hold a reservation open. Gemini's
   * preview TTS models carry single-digit RPM caps, which makes 429s the
   * *normal* weather of a sixty-paragraph fan-out — before this, each one was
   * counted as a permanently failed paragraph and a full-script run died on
   * the 15% tolerance while the vendor behaved exactly as documented.
   */
  const result = await withRateLimitPatience(() =>
    withCost(
      db,
      {
        // The account the key belongs to, not the model line — see
        // `TTS_CREDENTIAL_PROVIDER`. One key, one bill, one cap.
        provider: TTS_CREDENTIAL_PROVIDER[provider],
        operation: `tts.${provider}`,
        ...(input.projectId ? { projectId: input.projectId } : {}),
        estimateUsd: estimateTtsUsd({ provider, characters: input.text.length }),
        meta: { voiceId, characters: input.text.length },
      },
      async (): Promise<{ result: TTSResult; actualUsd: number }> => {
        const synthesised = await adapter.synthesise(request, {
          apiKey,
          ...(input.signal ? { signal: input.signal } : {}),
        })
        // Characters are what both vendors bill on, so the estimate and the
        // settlement come from the same number — but the adapter's figure is
        // authoritative in case a vendor's rate differs from ours.
        return { result: synthesised, actualUsd: synthesised.estimatedCostUsd }
      },
      { settings },
    ),
  )

  return {
    wav: encodeWav(result.audioBuffer, { sampleRate: result.sampleRate }),
    durationMs: result.durationMs,
    costUsd: result.estimatedCostUsd,
    waveform: waveformPeaks(result.audioBuffer),
    provider: result.provider,
    voiceId: result.voiceId,
    ...(result.droppedPronunciations && result.droppedPronunciations.length > 0
      ? { droppedPronunciations: result.droppedPronunciations }
      : {}),
  }
}
