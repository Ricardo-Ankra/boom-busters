import { createHash } from 'node:crypto'
import { estimateRuntimeSec } from '@boom-busters/schemas'
import type { TtsProvider } from '@boom-busters/schemas'
import { NARRATION_SAMPLE_RATE, pcmDurationMs } from './audio'
import type {
  KnownVoice,
  TTSCallOptions,
  TTSProvider,
  TTSRequest,
  TTSResult,
  VoiceListOptions,
} from './types'

/**
 * The TTS adapter every test and every `MOCK_PROVIDERS=1` run talks to.
 *
 * Same contract as the LLM mock: it implements `TTSProvider` and is chosen by
 * the same registry, so the code path under test in CI is the code path that
 * runs in production, minus the vendor. And the same determinism rule — output
 * is a pure function of the request, with no `Math.random()` and no `Date.now()`
 * anywhere in this file.
 *
 * There is one extra requirement the LLM mock does not have: **the audio has to
 * be real.** A voice review screen whose rows will not play is a screen nobody
 * can test — not the waveform, not the coverage bar, not the flag-and-retake
 * loop, and not the continuous listen-through that is the whole reason the
 * screen is laid out the way it is. So this produces genuine, playable PCM of
 * a plausible length.
 *
 * It produces an obviously synthetic *tone*, though, following the rule the LLM
 * mock's filler follows: nobody must ever mistake mock output for the real
 * thing. Two seconds of a buzzing two-harmonic drone cannot be confused with
 * narration, while still giving the strip a shape and the player something to
 * scrub through.
 */

export interface MockTTSScript {
  /** Fail the first N calls, for the runner's partial-failure tests. */
  failFirst?: { times: number; error: () => Error }
  /** Fail synthesis of any paragraph whose text matches, however many times. */
  failWhen?: (request: TTSRequest) => Error | undefined
  /** Reject every key except these, for pre-flight tests. */
  validKeys?: readonly string[]
  voices?: readonly KnownVoice[]
}

export interface MockTTS extends TTSProvider {
  readonly calls: TTSRequest[]
  reset(): void
}

export const MOCK_VOICES: readonly KnownVoice[] = [
  { id: 'mock-narrator', label: 'Mock Narrator', description: 'A tone. Obviously not a person.' },
  { id: 'mock-alt', label: 'Mock Alternate', description: 'A different tone, for A/B tests.' },
]

/** Stable pseudo-randomness: same text in, same waveform out, forever. */
function digest(input: string): number {
  return parseInt(createHash('sha256').update(input).digest('hex').slice(0, 8), 16)
}

/**
 * The seed that makes one synthesis distinguishable from another.
 *
 * Not the text alone. A retake is the *same paragraph in the same voice*, and if
 * both takes produced identical audio the A/B toggle on the review row would
 * compare a recording against itself — which looks exactly like a working A/B
 * toggle right up until it matters. The idempotency key is per-synthesis, so
 * seeding on it gives every take its own sound.
 */
export function mockTakeSeed(voiceId: string, idempotencyKey: string): string {
  return `${voiceId}\n${idempotencyKey}`
}

/**
 * Narration-shaped PCM: one burst per word, with gaps between them.
 *
 * The shape matters more than it might seem. A flat tone would draw a
 * featureless block in every waveform strip, so a review screen bug that drew
 * every take identically would look exactly like correct output. Bursts and
 * gaps mean a strip that does not match its paragraph is visibly wrong.
 *
 * **Exported, because the audio route regenerates it.** In mock mode nothing is
 * ever written to R2 — CI has no bucket — so the route that serves a take
 * re-derives the bytes from the take's own text and seed. Determinism is what
 * makes that possible, and it is the reason there is no `Math.random()` here.
 */
export function mockNarrationPcm(text: string, seed: string): Buffer {
  // Real narration at 150 wpm, floored so a one-word paragraph is still
  // scrubbable rather than a click.
  const durationMs = Math.max(800, estimateRuntimeSec(text) * 1000)
  const totalSamples = Math.floor((durationMs / 1000) * NARRATION_SAMPLE_RATE)
  const pcm = Buffer.alloc(totalSamples * 2)

  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || totalSamples === 0) return pcm

  const noise = digest(`${seed}\n${text}`)
  // 90-150 Hz: a speaking fundamental, so the length reads as speech-like even
  // though the timbre plainly does not.
  const baseHz = 90 + (noise % 60)

  const weights = words.map((word) => word.length + 1)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

  let cursor = 0
  for (const [index, weight] of weights.entries()) {
    const span = Math.floor((totalSamples * weight) / totalWeight)
    // 85% voiced, 15% gap — the pause between words that gives the strip its
    // shape.
    const voiced = Math.floor(span * 0.85)
    // A little pitch movement per word, so it is not a single held note.
    const hz = baseHz * (1 + (((noise >> (index % 16)) & 7) - 3.5) / 60)

    for (let i = 0; i < voiced && cursor + i < totalSamples; i += 1) {
      const t = i / NARRATION_SAMPLE_RATE
      // A raised-sine envelope: no click at either end of a burst.
      const envelope = Math.sin((Math.PI * i) / voiced)
      const wave = Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * hz * 2 * t)
      pcm.writeInt16LE(Math.round(envelope * wave * 7_000), (cursor + i) * 2)
    }

    cursor += span
  }

  return pcm
}

export function createMockTTS(script: MockTTSScript = {}, id: TtsProvider = 'gemini'): MockTTS {
  const calls: TTSRequest[] = []
  let failuresLeft = script.failFirst?.times ?? 0

  return {
    id,
    // Deliberately not zero. A free mock would let every budget-guard test
    // pass by accident, and the guard is the thing those tests exist for.
    pricePerKChar: 0.015,
    sampleRate: NARRATION_SAMPLE_RATE,
    calls,

    reset() {
      calls.length = 0
      failuresLeft = script.failFirst?.times ?? 0
    },

    async synthesise(request: TTSRequest, options: TTSCallOptions): Promise<TTSResult> {
      calls.push(request)

      if (script.validKeys && !script.validKeys.includes(options.apiKey)) {
        throw new Error(`mock ${id}: key rejected`)
      }

      const scripted = script.failWhen?.(request)
      if (scripted) throw scripted

      if (failuresLeft > 0 && script.failFirst) {
        failuresLeft -= 1
        throw script.failFirst.error()
      }

      const audioBuffer = mockNarrationPcm(
        request.text,
        mockTakeSeed(request.voiceId, request.idempotencyKey),
      )

      return {
        audioBuffer,
        sampleRate: NARRATION_SAMPLE_RATE,
        durationMs: pcmDurationMs(audioBuffer.length, NARRATION_SAMPLE_RATE),
        estimatedCostUsd: (request.text.length / 1000) * 0.015,
        provider: id,
        voiceId: request.voiceId,
      }
    },

    async voices(_options: VoiceListOptions): Promise<KnownVoice[]> {
      return [...(script.voices ?? MOCK_VOICES)]
    },

    async verifyKey(apiKey: string): Promise<void> {
      if (script.validKeys && !script.validKeys.includes(apiKey)) {
        throw new Error(`mock ${id}: key rejected`)
      }
    },
  }
}
