import { ValidationError } from '@boom-busters/schemas'
import type { PhonemeHint } from '@boom-busters/schemas'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { NARRATION_SAMPLE_RATE, pcmDurationMs } from './audio'
import { isIpa, matchedHints } from './phonemes'
import type {
  KnownVoice,
  TTSCallOptions,
  TTSProvider,
  TTSRequest,
  TTSResult,
  VoiceListOptions,
} from './types'

/**
 * Google Cloud Text-to-Speech — Chirp 3 HD (chosen 2026-08-13).
 *
 * A different product from Gemini TTS despite both being Google's, and chosen
 * over it deliberately. Gemini TTS is a language model performing a line: you
 * steer it in prose and it varies run to run. Cloud TTS is a speech service:
 * the same text in the same voice comes back the same, delivery is set by
 * parameters rather than persuasion, and Chirp 3 HD is GA rather than preview.
 *
 * For a channel that is one narrator reading measured prose across fifteen
 * minutes, that trade is the right way round — consistency and control matter
 * more than expressive range, and every Gemini TTS model on offer today is a
 * `-preview` id of exactly the kind that was withdrawn under us this week.
 *
 * PRICES ARE PROVISIONAL, on the same terms as every other adapter.
 */

const BASE = 'https://texttospeech.googleapis.com/v1'

/**
 * The voice families worth offering.
 *
 * Chirp 3 HD is the current top tier; Chirp HD is its predecessor and is kept
 * because an account may have one and not the other. Everything older
 * (Standard, WaveNet, Neural2, Studio) is filtered out rather than listed: an
 * audition panel with two hundred voices in it is not a choice, it is a wall.
 */
const OFFERED_FAMILIES = /-(?:Chirp3-HD|Chirp-HD)-/

/** The leading `en-GB-Chirp3-HD-` of a voice id, so a picker can show "Achernar". */
const VOICE_PREFIX = /^[a-z]{2,3}-[A-Z]{2}-(?:Chirp3-HD|Chirp-HD)-/

/** Narration is English; the language code is part of every Cloud TTS call. */
export const DEFAULT_LANGUAGE_CODE = 'en-GB'

interface CloudVoice {
  name?: string
  languageCodes?: string[]
  ssmlGender?: string
  naturalSampleRateHertz?: number
}

interface VoicesResponse {
  voices?: CloudVoice[]
}

interface SynthesizeResponse {
  audioContent?: string
}

/**
 * Strip a RIFF/WAVE header if the vendor sent one.
 *
 * Cloud TTS returns `LINEAR16` **inside a WAV container**, unlike Gemini and
 * ElevenLabs which return bare PCM. Everything above the adapters assumes raw
 * samples — `pcmDurationMs` divides by the byte count and `waveformPeaks` reads
 * `Int16LE` from offset zero — so a header left in place would put 44 bytes of
 * ASCII at the front of the waveform and add a millisecond to every duration.
 * Worse, `encodeWav` would then wrap a WAV in a second WAV.
 *
 * Detected rather than assumed, so that a future encoding change cannot
 * silently corrupt every take: if the bytes do not begin `RIFF....WAVE`, they
 * are passed through untouched.
 */
export function stripWavHeader(buffer: Buffer): Buffer {
  if (buffer.length < 44) return buffer
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return buffer
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return buffer

  // Walk the chunk list rather than assuming 44: a `LIST`/`INFO` chunk before
  // `data` is legal and would otherwise be read as audio.
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    if (id === 'data') return buffer.subarray(offset + 8, offset + 8 + size)
    offset += 8 + size + (size % 2)
  }

  return buffer
}

/**
 * Pronunciation, as Chirp 3 HD actually takes it.
 *
 * **Not SSML.** The Chirp families accept plain text only — the `<phoneme>` tag
 * that the older WaveNet and Neural2 voices support is not available on them,
 * which is worth stating plainly because SSML was part of the reason this
 * provider was chosen. What Chirp 3 HD does take is `customPronunciations`, a
 * structured field on the request carrying a phrase and its IPA or X-SAMPA
 * form, and that is what an IPA hint becomes here.
 *
 * A hint written as a plain respelling ("VEER-card") is not a phonetic alphabet
 * and cannot go in that field, so it is substituted into the text instead —
 * the same fallback the ElevenLabs adapter uses, for the same reason.
 */
export function customPronunciations(
  text: string,
  hints: readonly PhonemeHint[],
): { phrase: string; phoneticEncoding: 'PHONETIC_ENCODING_IPA'; pronunciation: string }[] {
  return matchedHints(text, hints)
    .filter((hint) => isIpa(hint.hint))
    .map((hint) => ({
      phrase: hint.term,
      phoneticEncoding: 'PHONETIC_ENCODING_IPA' as const,
      pronunciation: hint.hint.trim().replace(/^\/|\/$/g, ''),
    }))
}

/** Respellings applied in the text, since they cannot be a phonetic encoding. */
export function applyRespellings(text: string, hints: readonly PhonemeHint[]): string {
  let out = text

  for (const hint of matchedHints(text, hints)) {
    if (isIpa(hint.hint)) continue
    out = out.replace(
      new RegExp(
        `(?<![\\p{L}\\p{N}])${hint.term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
        'giu',
      ),
      hint.hint,
    )
  }

  return out
}

/** The language a voice id declares, so the request agrees with the voice. */
export function languageOfVoice(voiceId: string): string {
  const match = /^([a-z]{2,3}-[A-Z]{2})-/.exec(voiceId)
  return match?.[1] ?? DEFAULT_LANGUAGE_CODE
}

export const googleCloudTts: TTSProvider = {
  id: 'google-cloud-tts',
  // Chirp 3 HD is billed per character at the top voice tier. PROVISIONAL.
  pricePerKChar: 0.03,
  sampleRate: NARRATION_SAMPLE_RATE,

  async synthesise(request: TTSRequest, options: TTSCallOptions): Promise<TTSResult> {
    const doFetch = options.fetchImpl ?? fetch
    const pronunciations = customPronunciations(request.text, request.phonemeHints)

    let response: Response
    try {
      response = await doFetch(`${BASE}/text:synthesize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': options.apiKey },
        body: JSON.stringify({
          input: {
            // Plain text, never SSML: the Chirp families do not accept it.
            text: applyRespellings(request.text, request.phonemeHints),
            ...(pronunciations.length > 0 ? { customPronunciations: { pronunciations } } : {}),
          },
          voice: {
            languageCode: languageOfVoice(request.voiceId),
            name: request.voiceId,
          },
          audioConfig: {
            audioEncoding: 'LINEAR16',
            sampleRateHertz: NARRATION_SAMPLE_RATE,
            // Cloud TTS centres speaking rate on 1, as our pacing does.
            speakingRate: request.pacing ?? 1,
          },
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('google-cloud-tts', cause)
    }

    if (!response.ok) await throwForResponse('google-cloud-tts', response)

    const body = (await response.json()) as SynthesizeResponse
    if (!body.audioContent) {
      throw new ValidationError(
        'Cloud Text-to-Speech returned no audio. Nothing was spoken, so there is nothing to store.',
      )
    }

    const audioBuffer = stripWavHeader(Buffer.from(body.audioContent, 'base64'))

    return {
      audioBuffer,
      sampleRate: NARRATION_SAMPLE_RATE,
      durationMs: pcmDurationMs(audioBuffer.length, NARRATION_SAMPLE_RATE),
      estimatedCostUsd: (request.text.length / 1000) * googleCloudTts.pricePerKChar,
      provider: 'google-cloud-tts',
      voiceId: request.voiceId,
    }
  },

  /**
   * Queried, never shipped.
   *
   * The lesson of the Gemini model ids, applied before it can happen again: a
   * hand-written list of voice names is a list of assumptions, and this API has
   * an endpoint that answers the question for free.
   */
  async voices(options: VoiceListOptions): Promise<KnownVoice[]> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(`${BASE}/voices?languageCode=${DEFAULT_LANGUAGE_CODE}`, {
        headers: { 'x-goog-api-key': options.apiKey },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('google-cloud-tts', cause)
    }

    if (!response.ok) await throwForResponse('google-cloud-tts', response)

    const body = (await response.json()) as VoicesResponse

    return (body.voices ?? [])
      .filter((voice): voice is CloudVoice & { name: string } => typeof voice.name === 'string')
      .filter((voice) => OFFERED_FAMILIES.test(voice.name))
      .map((voice) => {
        const family = voice.name.includes('Chirp3-HD') ? 'Chirp 3 HD' : 'Chirp HD'
        const gender = voice.ssmlGender?.toLowerCase()
        return {
          id: voice.name,
          // "Achernar" reads better in a picker than the full id. Stripped by
          // the family prefix rather than by counting hyphens: the families
          // have different hyphen counts (`Chirp3-HD` versus `Chirp-HD`), so a
          // fixed `slice` left "HD-" on the front of half of them.
          label: voice.name.replace(VOICE_PREFIX, '') || voice.name,
          description: [family, gender].filter(Boolean).join(' · '),
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))
  },

  async verifyKey(apiKey: string, options: Omit<VoiceListOptions, 'apiKey'> = {}): Promise<void> {
    // Listing voices is free and is the same call the audition panel makes.
    await googleCloudTts.voices({ apiKey, ...options })
  },
}
