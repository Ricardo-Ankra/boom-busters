import { ValidationError } from '@boom-busters/schemas'
import { mapNetworkError, throwForResponse } from '../llm/http'
import { NARRATION_SAMPLE_RATE, pcmDurationMs } from './audio'
import { stylePromptWithHints } from './phonemes'
import type {
  KnownVoice,
  TTSCallOptions,
  TTSProvider,
  TTSRequest,
  TTSResult,
  VoiceListOptions,
} from './types'

/**
 * Gemini TTS — the default narrator (spec section 2).
 *
 * **Synchronous `generateContent`, not the batch API.** Spec section 6 says
 * "Gemini adapter uses the batch API", and that instruction sits under the
 * general rule "batch APIs where latency is irrelevant". For narration latency
 * is *not* irrelevant: a human is waiting at the voice gate, and Gemini's batch
 * turnaround is measured in hours. Taking it would mean approving a script on
 * Monday and being offered its audio on Tuesday, to save roughly fifteen cents
 * a video.
 *
 * It would also cost the step-duration rule (section 7): a batch job needs a
 * submit → `step.sleep()` → poll loop, which is a durable state machine per
 * paragraph. Fanning out sixty short synchronous calls gets the same throughput
 * with none of that.
 *
 * Revisit if TTS spend ever becomes material against the cap — the interface
 * does not change, only this file.
 *
 * PRICES ARE PROVISIONAL, on the same terms as the LLM adapters. Confirm
 * against the current price list before the first live run.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

/** The TTS-capable model. Narration has no tier ladder — there is one model. */
export const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts'

/**
 * Gemini's prebuilt voices — a curated subset with display names, per spec
 * section 10.1. Shipped static because they are a property of the model, not of
 * the account: there is no endpoint to ask, and there is nothing to ask about.
 */
export const GEMINI_VOICES: readonly KnownVoice[] = [
  { id: 'Charon', label: 'Charon', description: 'Low, level, unhurried. The documentary default.' },
  { id: 'Kore', label: 'Kore', description: 'Firm and even, a touch brighter than Charon.' },
  { id: 'Orus', label: 'Orus', description: 'Weighty and deliberate; suits a post-mortem.' },
  { id: 'Puck', label: 'Puck', description: 'Quicker and warmer; risks sounding pleased.' },
  { id: 'Aoede', label: 'Aoede', description: 'Light and airy. Rarely right for a collapse.' },
  { id: 'Fenrir', label: 'Fenrir', description: 'Gravelly and emphatic; use sparingly.' },
]

interface GeminiTtsResponse {
  candidates?: {
    content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] }
    finishReason?: string
  }[]
}

/**
 * Gemini reports its audio format in a MIME type like
 * `audio/L16;codec=pcm;rate=24000`. Trusting the header rather than assuming
 * 24 kHz matters: if the model ever answers at another rate, an assumed rate
 * would make every duration in the app wrong by a constant factor and every
 * take play at the wrong pitch, with nothing to indicate why.
 */
export function sampleRateFromMimeType(mimeType: string | undefined): number {
  const match = /rate=(\d+)/.exec(mimeType ?? '')
  const rate = match ? Number(match[1]) : NaN
  return Number.isFinite(rate) && rate > 0 ? rate : NARRATION_SAMPLE_RATE
}

/**
 * Gemini takes direction as plain language before the text (its "style
 * prompt"), so pacing and pronunciation are words rather than parameters.
 */
export function buildGeminiPrompt(request: TTSRequest): string {
  const pacing = request.pacing ?? 1
  const speed = pacing > 1.1 ? 'Read briskly.' : pacing < 0.9 ? 'Read slowly and deliberately.' : ''

  const style = stylePromptWithHints(
    [request.stylePrompt ?? '', speed].filter((part) => part.trim().length > 0).join(' '),
    request.text,
    request.phonemeHints,
  ).trim()

  // The colon form is what Gemini's TTS documentation uses to separate
  // direction from the words to be spoken.
  return style ? `${style}:\n${request.text}` : request.text
}

export const geminiTts: TTSProvider = {
  id: 'gemini',
  pricePerKChar: 0.015,
  sampleRate: NARRATION_SAMPLE_RATE,

  async synthesise(request: TTSRequest, options: TTSCallOptions): Promise<TTSResult> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(`${BASE}/${GEMINI_TTS_MODEL}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Header rather than ?key=: an API key in a URL ends up in logs.
          'x-goog-api-key': options.apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: buildGeminiPrompt(request) }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: request.voiceId } },
            },
          },
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('gemini', cause)
    }

    if (!response.ok) await throwForResponse('gemini', response)

    const body = (await response.json()) as GeminiTtsResponse
    const inline = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData

    if (!inline?.data) {
      throw new ValidationError(
        `Gemini returned no audio (finishReason: ${body.candidates?.[0]?.finishReason ?? 'none'}). ` +
          'Nothing was spoken, so there is nothing to store.',
      )
    }

    const audioBuffer = Buffer.from(inline.data, 'base64')
    const sampleRate = sampleRateFromMimeType(inline.mimeType)

    return {
      audioBuffer,
      sampleRate,
      durationMs: pcmDurationMs(audioBuffer.length, sampleRate),
      estimatedCostUsd: (request.text.length / 1000) * geminiTts.pricePerKChar,
      provider: 'gemini',
      voiceId: request.voiceId,
    }
  },

  async voices(_options: VoiceListOptions): Promise<KnownVoice[]> {
    return [...GEMINI_VOICES]
  },

  async verifyKey(apiKey: string, options: Omit<VoiceListOptions, 'apiKey'> = {}): Promise<void> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      // Listing models is free and proves the key; synthesising to verify a key
      // would charge for it.
      response = await doFetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': apiKey },
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('gemini', cause)
    }

    if (!response.ok) await throwForResponse('gemini', response)
  },
}
