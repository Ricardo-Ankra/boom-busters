import { ValidationError } from '@boom-busters/schemas'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { NARRATION_SAMPLE_RATE, pcmDurationMs } from './audio'
import { markUpPhonemes } from './phonemes'
import type {
  KnownVoice,
  TTSCallOptions,
  TTSProvider,
  TTSRequest,
  TTSResult,
  VoiceListOptions,
} from './types'

/**
 * ElevenLabs — the alternative narrator (spec section 6).
 *
 * Three settings are the spec's, not preferences:
 *
 *  - **`stability ≈ 0.38`**, verbatim from section 6. Low enough that the
 *    delivery varies with the sentence rather than droning; high enough that a
 *    retake of the same paragraph is recognisably the same performance.
 *  - **PCM output**, so this adapter and the Gemini one hand back the same kind
 *    of bytes and the WAV writer above them has one job.
 *  - **Pronunciation inline**, not via the dictionary endpoint. Section 6 names
 *    that endpoint, and it is a deliberate deviation: a pronunciation dictionary
 *    is an account-level resource that has to be created, versioned and
 *    referenced by id, which is three round trips and a piece of vendor state to
 *    keep in step with a settings list that a human edits. Inline markup says
 *    the same thing per request, needs nothing stored anywhere, and is a pure
 *    string function this package can actually test. Revisit if a hint list ever
 *    grows large enough to matter per request.
 *
 * There is a second reason to keep this adapter working even while Gemini is the
 * default: section 2 makes ElevenLabs' `with-timestamps` response the free path
 * to alignment in M6, skipping Whisper entirely.
 *
 * PRICES ARE PROVISIONAL. Confirm before the first live run.
 */

const BASE = 'https://api.elevenlabs.io/v1'

/** Spec section 6, verbatim. */
export const ELEVENLABS_STABILITY = 0.38

/**
 * `pcm_24000` matches `NARRATION_SAMPLE_RATE`, so takes from either provider
 * concatenate at assembly without a resample.
 */
const OUTPUT_FORMAT = 'pcm_24000'

/** Multilingual v2 handles the European names this subject matter is full of. */
export const ELEVENLABS_MODEL = 'eleven_multilingual_v2'

interface ElevenLabsVoicesResponse {
  voices?: { voice_id?: string; name?: string; labels?: Record<string, string> }[]
}

/** The account's own voices, described from whatever labels it carries. */
export function describeVoice(labels: Record<string, string> | undefined): string | undefined {
  const parts = ['accent', 'age', 'gender', 'description', 'use_case']
    .map((key) => labels?.[key])
    .filter((value): value is string => typeof value === 'string' && value.length > 0)

  return parts.length > 0 ? parts.join(' · ') : undefined
}

export const elevenlabsTts: TTSProvider = {
  id: 'elevenlabs',
  pricePerKChar: 0.18,
  sampleRate: NARRATION_SAMPLE_RATE,
  // `stability: 0.38` with no seed — a second read is a genuine second take.
  rereadCanDiffer: true,
  // Samples, but takes no prompt: text and voice settings only.
  promptSteered: false,

  async synthesise(request: TTSRequest, options: TTSCallOptions): Promise<TTSResult> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(
        `${BASE}/text-to-speech/${encodeURIComponent(request.voiceId)}?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'xi-api-key': options.apiKey },
          body: JSON.stringify({
            text: markUpPhonemes(request.text, request.phonemeHints),
            model_id: ELEVENLABS_MODEL,
            voice_settings: {
              stability: ELEVENLABS_STABILITY,
              similarity_boost: 0.75,
              // ElevenLabs' speed control is centred on 1 like ours, so pacing
              // passes straight through rather than being described in words.
              speed: request.pacing ?? 1,
            },
          }),
          ...(options.signal ? { signal: options.signal } : {}),
        },
      )
    } catch (cause) {
      throw mapNetworkError('elevenlabs', cause)
    }

    if (!response.ok) await throwForResponse('elevenlabs', response)

    const audioBuffer = Buffer.from(await response.arrayBuffer())

    if (audioBuffer.length === 0) {
      throw new ValidationError(
        'ElevenLabs returned an empty audio body. Nothing was spoken, so there is nothing to store.',
      )
    }

    return {
      audioBuffer,
      sampleRate: NARRATION_SAMPLE_RATE,
      durationMs: pcmDurationMs(audioBuffer.length, NARRATION_SAMPLE_RATE),
      estimatedCostUsd: (request.text.length / 1000) * elevenlabsTts.pricePerKChar,
      provider: 'elevenlabs',
      voiceId: request.voiceId,
    }
  },

  /** Queried, not shipped: these are whatever the account holds (spec §10.1). */
  async voices(options: VoiceListOptions): Promise<KnownVoice[]> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(`${BASE}/voices`, {
        headers: { 'xi-api-key': options.apiKey },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('elevenlabs', cause)
    }

    if (!response.ok) await throwForResponse('elevenlabs', response)

    const body = (await response.json()) as ElevenLabsVoicesResponse

    return (body.voices ?? [])
      .filter((voice) => typeof voice.voice_id === 'string' && voice.voice_id.length > 0)
      .map((voice) => {
        const description = describeVoice(voice.labels)
        return {
          id: voice.voice_id as string,
          label: voice.name ?? (voice.voice_id as string),
          ...(description ? { description } : {}),
        }
      })
  },

  async verifyKey(apiKey: string, options: Omit<VoiceListOptions, 'apiKey'> = {}): Promise<void> {
    // Listing voices is free and is the same call the audition panel makes.
    await elevenlabsTts.voices({ apiKey, ...options })
  },
}
