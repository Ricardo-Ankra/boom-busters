import { ValidationError } from '@boom-busters/schemas'
import type { StabilityTier, WordTiming } from '@boom-busters/schemas'
import { z } from 'zod'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { NARRATION_SAMPLE_RATE, pcmDurationMs } from './audio'
import { applyPronunciations } from './phonemes'
import type {
  KnownVoice,
  TTSCallOptions,
  TTSProvider,
  TTSRequest,
  TTSResult,
  VoiceListOptions,
} from './types'

/**
 * ElevenLabs — the narrator (spec section 6; sole vendor by decision,
 * 2026-08-14).
 *
 * The model is **Eleven v3**, which is what made it worth deleting the other
 * two vendors for: the direction channel is *inline*. Anything bracketed in
 * the text is a stage direction rather than words — `[pause]`, `[whispers]`,
 * `[sighs]`, free-form `[grave, measured]` — so the script itself carries the
 * performance, a re-read reproduces it, and there is no side-channel prompt
 * whose effect on the audio would have to be fingerprinted separately.
 *
 * What v3 does *not* take, and how each gap is handled:
 *
 *  - **No speed parameter.** Pace is steered with pause tags, punctuation and
 *    sentence structure. (The old pacing slider died with Chirp.)
 *  - **No phoneme markup.** Respellings are substituted into the text by
 *    `applyPronunciations`; IPA hints are dropped and reported.
 *  - **No request stitching.** Continuity between paragraphs comes from the
 *    voice itself and the stability setting, which is a discrete three-way
 *    on v3 — exposed in Settings as Creative / Natural / Robust.
 *
 * PCM output at 24 kHz keeps the WAV writer above this adapter with one job.
 * PRICES ARE PROVISIONAL. Confirm before the first live run.
 */

const BASE = 'https://api.elevenlabs.io/v1'

/**
 * The expressive model. Not configurable: offering a model choice would be
 * rebuilding the multi-vendor capability matrix inside one vendor, and the
 * whole reason ElevenLabs is the narrator is what this model does with tags.
 */
export const ELEVENLABS_MODEL = 'eleven_v3'

/**
 * v3 accepts exactly these three stability values — it is a switch, not a
 * dial. The tier names are ElevenLabs' own: Creative performs hardest and
 * follows tags most eagerly, Robust holds the delivery steadiest across
 * paragraphs and takes, Natural sits between and is the default.
 */
export const ELEVEN_V3_STABILITY: Record<StabilityTier, number> = {
  creative: 0.0,
  natural: 0.5,
  robust: 1.0,
}

/**
 * `pcm_24000` matches `NARRATION_SAMPLE_RATE`, so takes concatenate at
 * assembly without a resample.
 */
const OUTPUT_FORMAT = 'pcm_24000'

/**
 * The `/with-timestamps` response: audio as base64 plus a per-character
 * alignment. `normalized_alignment` maps the text as spoken (numbers
 * expanded, abbreviations read out); `alignment` maps the input text. The
 * input-text one is preferred — its words are the script's words, which is
 * what the snap step aligns against.
 */
const AlignmentSchema = z.object({
  characters: z.array(z.string()),
  character_start_times_seconds: z.array(z.number()),
  character_end_times_seconds: z.array(z.number()),
})

const WithTimestampsResponseSchema = z.object({
  // No min-length: an empty body must reach the adapter's own empty-audio
  // check, which throws the ValidationError the caller knows how to show.
  audio_base64: z.string(),
  alignment: AlignmentSchema.nullish(),
  normalized_alignment: AlignmentSchema.nullish(),
})

/** Bracketed spans are direction, never spoken — no timing is real for them. */
const TAG_WORD = /^\[[^\]]+\]$/

/**
 * Collapse a character alignment into word timings: split on whitespace,
 * a word's start is its first character's start and its end its last
 * character's end. Exported for tests.
 */
export function wordTimingsFromAlignment(alignment: z.infer<typeof AlignmentSchema>): WordTiming[] {
  const words: WordTiming[] = []
  let current = ''
  let startSec = 0
  let endSec = 0

  const flush = () => {
    if (current.length > 0 && !TAG_WORD.test(current)) {
      words.push({
        text: current,
        startMs: Math.round(startSec * 1000),
        endMs: Math.round(endSec * 1000),
      })
    }
    current = ''
  }

  alignment.characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      flush()
      return
    }
    if (current === '') startSec = alignment.character_start_times_seconds[index] ?? 0
    current += character
    endSec = alignment.character_end_times_seconds[index] ?? startSec
  })
  flush()

  return words
}

interface ElevenLabsVoicesResponse {
  voices?: { voice_id?: string; name?: string; labels?: Record<string, string> }[]
}

/** The account's own voices, described from whatever labels each carries. */
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

  async synthesise(request: TTSRequest, options: TTSCallOptions): Promise<TTSResult> {
    const doFetch = options.fetchImpl ?? fetch

    const { text, dropped } = applyPronunciations(request.text, request.phonemeHints)

    let response: Response
    try {
      // `/with-timestamps` costs the same as the plain endpoint and returns a
      // character alignment beside the audio — free word timings, which is
      // what makes assembly's alignment step free for ElevenLabs takes.
      response = await doFetch(
        `${BASE}/text-to-speech/${encodeURIComponent(request.voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'xi-api-key': options.apiKey },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_MODEL,
            voice_settings: {
              stability: ELEVEN_V3_STABILITY[request.stability ?? 'natural'],
            },
          }),
          ...(options.signal ? { signal: options.signal } : {}),
        },
      )
    } catch (cause) {
      throw mapNetworkError('elevenlabs', cause)
    }

    if (!response.ok) await throwForResponse('elevenlabs', response)

    const parsed = WithTimestampsResponseSchema.parse(await response.json())
    const audioBuffer = Buffer.from(parsed.audio_base64, 'base64')

    if (audioBuffer.length === 0) {
      throw new ValidationError(
        'ElevenLabs returned an empty audio body. Nothing was spoken, so there is nothing to store.',
      )
    }

    const alignment = parsed.alignment ?? parsed.normalized_alignment
    const wordTimings = alignment ? wordTimingsFromAlignment(alignment) : []

    return {
      audioBuffer,
      sampleRate: NARRATION_SAMPLE_RATE,
      durationMs: pcmDurationMs(audioBuffer.length, NARRATION_SAMPLE_RATE),
      estimatedCostUsd: (request.text.length / 1000) * elevenlabsTts.pricePerKChar,
      provider: 'elevenlabs',
      voiceId: request.voiceId,
      ...(wordTimings.length > 0 ? { wordTimings } : {}),
      ...(dropped.length > 0 ? { droppedPronunciations: dropped } : {}),
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
