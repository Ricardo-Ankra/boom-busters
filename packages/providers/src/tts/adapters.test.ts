import { RateLimitError, TransientProviderError, ValidationError } from '@boom-busters/schemas'
import type { PhonemeHint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { NARRATION_SAMPLE_RATE, pcmDurationMs } from './audio'
import { describeVoice, elevenlabsTts, ELEVENLABS_STABILITY } from './elevenlabs'
import { buildGeminiPrompt, geminiTts, GEMINI_VOICES, sampleRateFromMimeType } from './gemini'
import { googleCloudTts } from './google-cloud'
import { createMockTTS, mockNarrationPcm, mockTakeSeed } from './mock'
import { ttsAdapter, ttsAdapters, TTS_PRICES_PER_KCHAR } from './registry'
import { ttsPrice } from './types'
import type { TTSRequest } from './types'

/**
 * Adapters are tested against recorded response bodies (spec section 13), never
 * against the live APIs — a suite that needed network access would cost money
 * to run and would go red whenever a vendor had an outage.
 */

const hints: PhonemeHint[] = [{ term: 'Wirecard', hint: '/ˈvaɪɐkart/' }]

const request: TTSRequest = {
  text: 'Wirecard filed for insolvency in June 2020.',
  voiceId: 'Charon',
  stylePrompt: 'Measured and dry.',
  phonemeHints: hints,
  idempotencyKey: 'abc123',
}

/** One second of quiet PCM, base64 for Gemini's inline shape. */
const ONE_SECOND = Buffer.alloc(NARRATION_SAMPLE_RATE * 2, 0)

function respondWith(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })) as unknown as typeof fetch
}

/** Captures the outgoing request so the body can be asserted on. */
function capture(body: unknown): {
  fetchImpl: typeof fetch
  seen: { url?: string; init?: RequestInit }
} {
  const seen: { url?: string; init?: RequestInit } = {}
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.url = url
    seen.init = init
    return new Response(
      typeof body === 'string' || body instanceof Buffer ? body : JSON.stringify(body),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof fetch

  return { fetchImpl, seen }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

describe('gemini TTS adapter', () => {
  const FIXTURE = {
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                mimeType: 'audio/L16;codec=pcm;rate=24000',
                data: ONE_SECOND.toString('base64'),
              },
            },
          ],
        },
        finishReason: 'STOP',
      },
    ],
  }

  it('decodes inline PCM and derives the duration from it', async () => {
    const result = await geminiTts.synthesise(request, {
      apiKey: 'k',
      fetchImpl: respondWith(FIXTURE),
    })

    expect(result.audioBuffer.length).toBe(ONE_SECOND.length)
    expect(result.sampleRate).toBe(24_000)
    expect(result.durationMs).toBe(1000)
    expect(result.provider).toBe('gemini')
  })

  it('prices from the text, because no TTS vendor returns a charge', async () => {
    const result = await geminiTts.synthesise(request, {
      apiKey: 'k',
      fetchImpl: respondWith(FIXTURE),
    })
    expect(result.estimatedCostUsd).toBeCloseTo((request.text.length / 1000) * 0.015, 10)
  })

  it('sends the key in a header, never in the URL', async () => {
    const { fetchImpl, seen } = capture(FIXTURE)
    await geminiTts.synthesise(request, { apiKey: 'secret-key', fetchImpl })

    expect(seen.url).not.toContain('secret-key')
    expect((seen.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
  })

  it('asks for audio, and names the voice', async () => {
    const { fetchImpl, seen } = capture(FIXTURE)
    await geminiTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as Record<string, never>
    expect(body).toMatchObject({
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
      },
    })
  })

  it('refuses a response with no audio rather than storing an empty take', async () => {
    await expect(
      geminiTts.synthesise(request, {
        apiKey: 'k',
        fetchImpl: respondWith({ candidates: [{ finishReason: 'SAFETY' }] }),
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('maps a 429 into the retriable taxonomy', async () => {
    await expect(
      geminiTts.synthesise(request, {
        apiKey: 'k',
        fetchImpl: respondWith('slow down', { status: 429 }),
      }),
    ).rejects.toThrow(RateLimitError)
  })

  it('maps a 5xx as transient', async () => {
    await expect(
      geminiTts.synthesise(request, {
        apiKey: 'k',
        fetchImpl: respondWith('boom', { status: 503 }),
      }),
    ).rejects.toThrow(TransientProviderError)
  })

  it('verifies a key by listing models, which costs nothing', async () => {
    const { fetchImpl, seen } = capture({ models: [] })
    await geminiTts.verifyKey('k', { fetchImpl })
    expect(seen.url).toContain('/models')
    expect(seen.init?.method).toBeUndefined()
  })

  it('ships its voices without a call', async () => {
    await expect(geminiTts.voices({ apiKey: '' })).resolves.toEqual([...GEMINI_VOICES])
  })
})

describe('sampleRateFromMimeType', () => {
  it('reads the declared rate', () => {
    expect(sampleRateFromMimeType('audio/L16;codec=pcm;rate=16000')).toBe(16_000)
  })

  /**
   * Falling back rather than throwing, but only because the fallback is the
   * rate we asked for. An assumed rate that was wrong would make every duration
   * in the app wrong by a constant factor with nothing to indicate why.
   */
  it('falls back to the requested rate when the header says nothing', () => {
    expect(sampleRateFromMimeType(undefined)).toBe(NARRATION_SAMPLE_RATE)
    expect(sampleRateFromMimeType('audio/L16')).toBe(NARRATION_SAMPLE_RATE)
  })
})

describe('buildGeminiPrompt', () => {
  it('puts the direction before the words, separated by a colon', () => {
    expect(buildGeminiPrompt({ ...request, phonemeHints: [] })).toBe(
      `Measured and dry.:\n${request.text}`,
    )
  })

  it('folds matched pronunciation into the direction', () => {
    expect(buildGeminiPrompt(request)).toContain('"Wirecard" is pronounced ˈvaɪɐkart (IPA)')
  })

  it('describes pacing in words, since Gemini has no speed parameter', () => {
    expect(buildGeminiPrompt({ ...request, phonemeHints: [], pacing: 1.4 })).toContain(
      'Read briskly.',
    )
    expect(buildGeminiPrompt({ ...request, phonemeHints: [], pacing: 0.7 })).toContain(
      'Read slowly and deliberately.',
    )
  })

  it('sends the text alone when there is no direction at all', () => {
    expect(buildGeminiPrompt({ ...request, stylePrompt: '', phonemeHints: [], pacing: 1 })).toBe(
      request.text,
    )
  })
})

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------

describe('elevenlabs TTS adapter', () => {
  it('returns the PCM body and its duration', async () => {
    const result = await elevenlabsTts.synthesise(request, {
      apiKey: 'k',
      fetchImpl: respondWith(ONE_SECOND),
    })

    expect(result.durationMs).toBe(pcmDurationMs(ONE_SECOND.length, NARRATION_SAMPLE_RATE))
    expect(result.provider).toBe('elevenlabs')
  })

  it('asks for pcm_24000, so both providers hand back the same kind of bytes', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'k', fetchImpl })
    expect(seen.url).toContain('output_format=pcm_24000')
  })

  it('sets stability to the figure the spec names', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { voice_settings: { stability: number } }
    expect(body.voice_settings.stability).toBe(ELEVENLABS_STABILITY)
    expect(ELEVENLABS_STABILITY).toBe(0.38)
  })

  it('marks pronunciation up inline rather than sending the raw text', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { text: string }
    expect(body.text).toContain('<phoneme alphabet="ipa" ph="ˈvaɪɐkart">Wirecard</phoneme>')
  })

  it('passes pacing straight through, since its speed control is centred on 1', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise({ ...request, pacing: 1.15 }, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { voice_settings: { speed: number } }
    expect(body.voice_settings.speed).toBe(1.15)
  })

  it('escapes a voice id into the path', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise({ ...request, voiceId: 'a/b' }, { apiKey: 'k', fetchImpl })
    expect(seen.url).toContain('text-to-speech/a%2Fb')
  })

  it('refuses an empty body rather than storing a silent take', async () => {
    await expect(
      elevenlabsTts.synthesise(request, {
        apiKey: 'k',
        fetchImpl: respondWith(Buffer.alloc(0)),
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('reads the account voices, which are not shipped with the adapter', async () => {
    const voices = await elevenlabsTts.voices({
      apiKey: 'k',
      fetchImpl: respondWith({
        voices: [
          { voice_id: 'v1', name: 'Rachel', labels: { accent: 'american', age: 'young' } },
          { name: 'no id at all' },
        ],
      }),
    })

    expect(voices).toEqual([{ id: 'v1', label: 'Rachel', description: 'american · young' }])
  })

  it('verifies a key with the same free call', async () => {
    const { fetchImpl, seen } = capture({ voices: [] })
    await elevenlabsTts.verifyKey('k', { fetchImpl })
    expect(seen.url).toContain('/voices')
  })
})

describe('describeVoice', () => {
  it('joins whichever labels the account happens to carry', () => {
    expect(describeVoice({ gender: 'female', use_case: 'narration' })).toBe('female · narration')
  })

  it('is undefined rather than empty when there are no labels', () => {
    expect(describeVoice(undefined)).toBeUndefined()
    expect(describeVoice({})).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The mock, and the registry that chooses it
// ---------------------------------------------------------------------------

describe('mock TTS adapter', () => {
  it('produces genuinely playable audio of a plausible length', async () => {
    const mock = createMockTTS()
    const result = await mock.synthesise(request, { apiKey: 'k' })

    // Roughly 43 characters at 150 wpm is under a second, so the floor applies.
    expect(result.durationMs).toBeGreaterThanOrEqual(800)
    expect(result.audioBuffer.length).toBe(
      Math.floor((result.durationMs / 1000) * NARRATION_SAMPLE_RATE) * 2,
    )
  })

  it('is deterministic, which is what lets the audio route regenerate a take', () => {
    const seed = mockTakeSeed('Charon', 'abc123')
    expect(mockNarrationPcm('The auditors signed it off.', seed)).toEqual(
      mockNarrationPcm('The auditors signed it off.', seed),
    )
  })

  it('gives different text and different voices different audio', () => {
    const a = mockNarrationPcm('The auditors signed it off.', mockTakeSeed('Charon', 'k'))
    expect(mockNarrationPcm('The auditors did not.', mockTakeSeed('Charon', 'k'))).not.toEqual(a)
    expect(mockNarrationPcm('The auditors signed it off.', mockTakeSeed('Kore', 'k'))).not.toEqual(
      a,
    )
  })

  /**
   * A retake is the same paragraph in the same voice. If it sounded identical
   * the A/B toggle would be comparing a recording against itself, which looks
   * exactly like a working A/B toggle until it matters.
   */
  it('gives a retake of the same paragraph its own sound', async () => {
    const mock = createMockTTS()
    const first = await mock.synthesise({ ...request, idempotencyKey: 'para#1' }, { apiKey: 'k' })
    const second = await mock.synthesise({ ...request, idempotencyKey: 'para#2' }, { apiKey: 'k' })

    expect(second.audioBuffer).not.toEqual(first.audioBuffer)
    // Same words, so the same length: only the timbre differs.
    expect(second.durationMs).toBe(first.durationMs)
  })

  it('is not silent, so a waveform strip has something to draw', () => {
    const pcm = mockNarrationPcm('One two three four five.', mockTakeSeed('Charon', 'k'))
    let peak = 0
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)))
    expect(peak).toBeGreaterThan(1_000)
  })

  it('narrates an empty paragraph as silence rather than throwing', () => {
    expect(mockNarrationPcm('   ', mockTakeSeed('Charon', 'k')).every((b) => b === 0)).toBe(true)
  })

  it('records its calls and can fail on demand, for the runner tests', async () => {
    const mock = createMockTTS({ failFirst: { times: 1, error: () => new Error('nope') } })

    await expect(mock.synthesise(request, { apiKey: 'k' })).rejects.toThrow('nope')
    await expect(mock.synthesise(request, { apiKey: 'k' })).resolves.toBeDefined()
    expect(mock.calls).toHaveLength(2)

    mock.reset()
    expect(mock.calls).toHaveLength(0)
  })

  it('is not free, so a budget test cannot pass by accident', async () => {
    const result = await createMockTTS().synthesise(request, { apiKey: 'k' })
    expect(result.estimatedCostUsd).toBeGreaterThan(0)
  })
})

describe('tts registry', () => {
  it('swaps both vendors for mocks under MOCK_PROVIDERS=1', async () => {
    const adapters = ttsAdapters({ MOCK_PROVIDERS: '1' })
    const result = await adapters.elevenlabs.synthesise(request, { apiKey: 'k' })
    // The live adapter would have needed a fetch; the mock needs nothing.
    expect(result.audioBuffer.length).toBeGreaterThan(0)
  })

  it('returns the live adapters when the flag is absent', () => {
    expect(ttsAdapter('gemini', {})).toBe(geminiTts)
    expect(ttsAdapter('elevenlabs', {})).toBe(elevenlabsTts)
  })

  it('publishes the live prices even in mock mode, because caps outlive a test run', () => {
    expect(TTS_PRICES_PER_KCHAR).toEqual({
      gemini: geminiTts.pricePerKChar,
      'google-cloud-tts': googleCloudTts.pricePerKChar,
      elevenlabs: elevenlabsTts.pricePerKChar,
    })
  })
})

describe('ttsPrice', () => {
  it('is per thousand characters', () => {
    expect(ttsPrice(geminiTts, 'x'.repeat(2_000))).toBeCloseTo(0.03, 10)
  })

  it('is zero for nothing', () => {
    expect(ttsPrice(geminiTts, '')).toBe(0)
  })
})
