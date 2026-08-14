import { ValidationError } from '@boom-busters/schemas'
import type { PhonemeHint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { NARRATION_SAMPLE_RATE, pcmDurationMs } from './audio'
import { describeVoice, elevenlabsTts, ELEVENLABS_MODEL, ELEVEN_V3_STABILITY } from './elevenlabs'
import { createMockTTS, mockNarrationPcm, mockTakeSeed } from './mock'
import { ttsAdapter, ttsAdapters, TTS_PRICES_PER_KCHAR } from './registry'
import { ttsPrice } from './types'
import type { TTSRequest } from './types'

/**
 * The adapter is tested against recorded response bodies (spec section 13),
 * never against the live API — a suite that needed network access would cost
 * money to run and would go red whenever the vendor had an outage.
 */

const hints: PhonemeHint[] = [
  { term: 'Wirecard', hint: 'VEER-card' },
  { term: 'Marsalek', hint: '/ˈmɑːsələk/' },
]

const request: TTSRequest = {
  text: 'Wirecard filed for insolvency in June 2020.',
  voiceId: 'v-narrator',
  phonemeHints: hints,
  idempotencyKey: 'abc123',
}

/** One second of quiet PCM. */
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

  it('asks for pcm_24000, so the WAV writer above it has one job', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'k', fetchImpl })
    expect(seen.url).toContain('output_format=pcm_24000')
  })

  it('speaks through Eleven v3, whose bracketed tags are the direction channel', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { model_id: string }
    expect(body.model_id).toBe(ELEVENLABS_MODEL)
    expect(ELEVENLABS_MODEL).toBe('eleven_v3')
  })

  it('defaults stability to natural, the middle of the three-way switch', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { voice_settings: { stability: number } }
    expect(body.voice_settings.stability).toBe(0.5)
  })

  it('maps the stability tiers to the exact values v3 accepts — it is a switch, not a dial', async () => {
    expect(ELEVEN_V3_STABILITY).toEqual({ creative: 0.0, natural: 0.5, robust: 1.0 })

    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise({ ...request, stability: 'robust' }, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { voice_settings: { stability: number } }
    expect(body.voice_settings.stability).toBe(1.0)
  })

  it('substitutes respellings into the text — the one pronunciation channel v3 has', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { text: string }
    expect(body.text).toBe('VEER-card filed for insolvency in June 2020.')
  })

  it('reports an IPA hint as dropped rather than smuggling markup v3 does not take', async () => {
    const result = await elevenlabsTts.synthesise(
      { ...request, text: 'Jan Marsalek was already gone.' },
      { apiKey: 'k', fetchImpl: respondWith(ONE_SECOND) },
    )

    // Spec principle 6: degrade, but never quietly.
    expect(result.droppedPronunciations).toEqual(['Marsalek'])
  })

  it('leaves narration tags in the text verbatim — they are the direction', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(
      { ...request, phonemeHints: [], text: '[sighs] It was over. [long pause] Nobody said so.' },
      { apiKey: 'k', fetchImpl },
    )

    const body = JSON.parse(String(seen.init?.body)) as { text: string }
    expect(body.text).toBe('[sighs] It was over. [long pause] Nobody said so.')
  })

  it('escapes a voice id into the path', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise({ ...request, voiceId: 'a/b' }, { apiKey: 'k', fetchImpl })
    expect(seen.url).toContain('text-to-speech/a%2Fb')
  })

  it('sends the key in a header, never in the URL', async () => {
    const { fetchImpl, seen } = capture(ONE_SECOND)
    await elevenlabsTts.synthesise(request, { apiKey: 'secret-key', fetchImpl })

    expect(seen.url).not.toContain('secret-key')
    expect((seen.init?.headers as Record<string, string>)['xi-api-key']).toBe('secret-key')
  })

  it('refuses an empty body rather than storing a silent take', async () => {
    await expect(
      elevenlabsTts.synthesise(request, {
        apiKey: 'k',
        fetchImpl: respondWith(Buffer.alloc(0)),
      }),
    ).rejects.toThrow(ValidationError)
  })

  it('prices from the text, because no TTS vendor returns a charge', async () => {
    const result = await elevenlabsTts.synthesise(request, {
      apiKey: 'k',
      fetchImpl: respondWith(ONE_SECOND),
    })
    expect(result.estimatedCostUsd).toBeCloseTo(
      (request.text.length / 1000) * elevenlabsTts.pricePerKChar,
      10,
    )
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

  it('stands in for the narrator, so a mock run looks like a live one', async () => {
    const result = await createMockTTS().synthesise(request, { apiKey: 'k' })
    expect(result.provider).toBe('elevenlabs')
  })

  it('is deterministic, which is what lets the audio route regenerate a take', () => {
    const seed = mockTakeSeed('v-narrator', 'abc123')
    expect(mockNarrationPcm('The auditors signed it off.', seed)).toEqual(
      mockNarrationPcm('The auditors signed it off.', seed),
    )
  })

  it('gives different text and different voices different audio', () => {
    const a = mockNarrationPcm('The auditors signed it off.', mockTakeSeed('v-narrator', 'k'))
    expect(mockNarrationPcm('The auditors did not.', mockTakeSeed('v-narrator', 'k'))).not.toEqual(
      a,
    )
    expect(
      mockNarrationPcm('The auditors signed it off.', mockTakeSeed('v-other', 'k')),
    ).not.toEqual(a)
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
    const pcm = mockNarrationPcm('One two three four five.', mockTakeSeed('v-narrator', 'k'))
    let peak = 0
    for (let i = 0; i < pcm.length; i += 2) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i)))
    expect(peak).toBeGreaterThan(1_000)
  })

  it('narrates an empty paragraph as silence rather than throwing', () => {
    expect(mockNarrationPcm('   ', mockTakeSeed('v-narrator', 'k')).every((b) => b === 0)).toBe(
      true,
    )
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
  it('swaps the vendor for the mock under MOCK_PROVIDERS=1', async () => {
    const adapters = ttsAdapters({ MOCK_PROVIDERS: '1' })
    const result = await adapters.elevenlabs.synthesise(request, { apiKey: 'k' })
    // The live adapter would have needed a fetch; the mock needs nothing.
    expect(result.audioBuffer.length).toBeGreaterThan(0)
  })

  it('returns the live adapter when the flag is absent', () => {
    expect(ttsAdapter('elevenlabs', {})).toBe(elevenlabsTts)
  })

  it('publishes the live price even in mock mode, because caps outlive a test run', () => {
    expect(TTS_PRICES_PER_KCHAR).toEqual({ elevenlabs: elevenlabsTts.pricePerKChar })
  })
})

describe('ttsPrice', () => {
  it('is per thousand characters', () => {
    expect(ttsPrice(elevenlabsTts, 'x'.repeat(2_000))).toBeCloseTo(0.36, 10)
  })

  it('is zero for nothing', () => {
    expect(ttsPrice(elevenlabsTts, '')).toBe(0)
  })
})
