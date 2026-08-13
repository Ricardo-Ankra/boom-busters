import { ValidationError } from '@boom-busters/schemas'
import type { PhonemeHint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { encodeWav, NARRATION_SAMPLE_RATE } from './audio'
import {
  applyRespellings,
  customPronunciations,
  DEFAULT_LANGUAGE_CODE,
  googleCloudTts,
  invalidPhrases,
  languageOfVoice,
  stripWavHeader,
} from './google-cloud'
import type { TTSRequest } from './types'

/**
 * Recorded shapes only — a suite that called Cloud TTS for real would cost
 * money to run and would go red whenever Google had a bad minute.
 *
 * The voice-list fixture below is trimmed from an actual `GET /v1/voices`
 * response taken with a live key on 2026-08-13, which is where `Chirp3-HD`,
 * `naturalSampleRateHertz: 24000` and the `ssmlGender` casing come from.
 */

const hints: PhonemeHint[] = [
  { term: 'Wirecard', hint: '/ˈvaɪɐkart/' },
  { term: 'Theranos', hint: 'THAIR-uh-nose' },
]

const request: TTSRequest = {
  text: 'Wirecard collapsed, and Theranos was already gone.',
  voiceId: 'en-GB-Chirp3-HD-Achernar',
  stylePrompt: 'Measured and dry.',
  phonemeHints: hints,
  idempotencyKey: 'abc123',
}

const PCM = Buffer.alloc(NARRATION_SAMPLE_RATE * 2, 7)

function capture(body: unknown): {
  fetchImpl: typeof fetch
  seen: { url?: string; init?: RequestInit }
} {
  const seen: { url?: string; init?: RequestInit } = {}
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.url = url
    seen.init = init
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch

  return { fetchImpl, seen }
}

function respondWith(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })) as unknown as typeof fetch
}

// ---------------------------------------------------------------------------
// The container
// ---------------------------------------------------------------------------

describe('stripWavHeader', () => {
  /**
   * The whole reason this function exists: Cloud TTS wraps LINEAR16 in a WAV,
   * where Gemini and ElevenLabs return bare samples. Left in place, 44 bytes of
   * ASCII would be read as audio by `waveformPeaks`, every duration would gain
   * a millisecond, and `encodeWav` would wrap a WAV inside a second WAV.
   */
  it('unwraps a WAV back to the samples inside it', () => {
    const wrapped = encodeWav(PCM, { sampleRate: NARRATION_SAMPLE_RATE })
    expect(stripWavHeader(wrapped)).toEqual(PCM)
  })

  it('leaves bare PCM untouched', () => {
    // Detected rather than assumed, so an encoding change cannot silently eat
    // the first 44 bytes of every take.
    expect(stripWavHeader(PCM)).toEqual(PCM)
  })

  it('walks the chunk list rather than assuming the header is 44 bytes', () => {
    // A LIST/INFO chunk before `data` is legal, and skipping a fixed 44 would
    // read it as audio.
    const wav = encodeWav(PCM, { sampleRate: NARRATION_SAMPLE_RATE })
    const list = Buffer.alloc(8 + 10)
    list.write('LIST', 0, 'ascii')
    list.writeUInt32LE(10, 4)

    const withList = Buffer.concat([wav.subarray(0, 36), list, wav.subarray(36)])
    expect(stripWavHeader(withList)).toEqual(PCM)
  })

  it('survives a truncated buffer without throwing', () => {
    expect(stripWavHeader(Buffer.alloc(0))).toEqual(Buffer.alloc(0))
    expect(stripWavHeader(Buffer.from('RIFF'))).toEqual(Buffer.from('RIFF'))
  })
})

// ---------------------------------------------------------------------------
// Pronunciation
// ---------------------------------------------------------------------------

describe('pronunciation on Chirp', () => {
  /**
   * A pronunciation goes in `customPronunciations`, as IPA, exactly as the
   * human wrote it. A respelling has nowhere to go but the text.
   *
   * This asserted X-SAMPA and a conversion in front of it, because a live test
   * had every IPA pronunciation refused. That test used `/ˈvaɪɐkart/`, whose
   * `ɐ` is not an en-GB phoneme — Google refuses on the phoneme and the message
   * reads the same either way, so a bad phoneme was read as a bad encoding.
   * Re-tested with the sounds held constant (`/ˈkæt/`, `/ˈdɒɡ/`): IPA is
   * accepted. The conversion was never load-bearing either — it turned `ɐ` into
   * `6`, which is the same phoneme and equally refused.
   */
  it('sends the hint as IPA, keyed by the written term', () => {
    expect(customPronunciations(request.text, hints)).toEqual([
      {
        phrase: 'Wirecard',
        phoneticEncoding: 'PHONETIC_ENCODING_IPA',
        pronunciation: 'ˈvaɪɐkart',
      },
    ])
  })

  it('strips the slashes, which are notation and not phonemes', () => {
    const [entry] = customPronunciations('Cat.', [{ term: 'Cat', hint: '/ˈkæt/' }])
    expect(entry?.pronunciation).toBe('ˈkæt')
  })

  it('omits a hint that is nothing but slashes', () => {
    expect(customPronunciations('Wirecard.', [{ term: 'Wirecard', hint: '//' }])).toEqual([])
  })

  it('does not offer a respelling as a phonetic encoding, because it is not one', () => {
    const only = customPronunciations('Theranos ran out of blood.', hints)
    expect(only).toEqual([])
  })

  it('substitutes a respelling into the text instead', () => {
    expect(applyRespellings('Theranos ran out of blood.', hints)).toBe(
      'THAIR-uh-nose ran out of blood.',
    )
  })

  it('leaves an IPA term in the text alone, since the field carries it', () => {
    expect(applyRespellings('Wirecard collapsed.', hints)).toBe('Wirecard collapsed.')
  })

  it('sends nothing at all when no hint matches', () => {
    expect(customPronunciations('Nothing to declare.', hints)).toEqual([])
    expect(applyRespellings('Nothing to declare.', hints)).toBe('Nothing to declare.')
  })
})

describe('languageOfVoice', () => {
  it('reads the language the voice id declares', () => {
    expect(languageOfVoice('en-GB-Chirp3-HD-Achernar')).toBe('en-GB')
    expect(languageOfVoice('de-DE-Chirp3-HD-Kore')).toBe('de-DE')
  })

  it('falls back rather than sending a malformed request', () => {
    expect(languageOfVoice('nonsense')).toBe(DEFAULT_LANGUAGE_CODE)
  })
})

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

describe('google cloud tts adapter', () => {
  const AUDIO = {
    audioContent: encodeWav(PCM, { sampleRate: NARRATION_SAMPLE_RATE }).toString('base64'),
  }

  it('returns unwrapped PCM and a duration derived from it', async () => {
    const result = await googleCloudTts.synthesise(request, {
      apiKey: 'k',
      fetchImpl: respondWith(AUDIO),
    })

    expect(result.audioBuffer).toEqual(PCM)
    expect(result.durationMs).toBe(1000)
    expect(result.provider).toBe('google-cloud-tts')
  })

  it('asks for LINEAR16 at the narration sample rate', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as Record<string, never>
    expect(body).toMatchObject({
      audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: NARRATION_SAMPLE_RATE },
    })
  })

  it('sends an ordinary paragraph as plain text, not SSML and not markup', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { input: Record<string, unknown> }
    expect(body.input).toHaveProperty('text')
    expect(body.input).not.toHaveProperty('markup')
    // SSML is offered on Chirp 3 HD at Preview and deliberately not used: the
    // markup and customPronunciations fields cover narration without it.
    expect(body.input).not.toHaveProperty('ssml')
    expect(String(body.input['text'])).not.toContain('<phoneme')
  })

  /**
   * The pause control, and the reason it is worth routing two ways.
   *
   * `[pause]`, `[pause short]` and `[pause long]` are only read from the
   * `markup` input; sent as `text` they would be narrated aloud as the words
   * "pause long", which is the worst available failure — audible, wrong, and
   * bought.
   */
  it('sends a paragraph carrying pause markup through the markup field', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(
      { ...request, text: 'It signed off for years. [pause long] Nobody asked.' },
      { apiKey: 'k', fetchImpl },
    )

    const body = JSON.parse(String(seen.init?.body)) as { input: Record<string, unknown> }
    expect(body.input).toHaveProperty('markup')
    expect(body.input).not.toHaveProperty('text')
    expect(String(body.input['markup'])).toContain('[pause long]')
  })

  it('still carries pronunciations alongside markup', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(
      { ...request, text: `${request.text} [pause] And again.` },
      { apiKey: 'k', fetchImpl },
    )

    const body = JSON.parse(String(seen.init?.body)) as {
      input: { markup?: string; customPronunciations?: { pronunciations: unknown[] } }
    }
    expect(body.input.markup).toBeDefined()
    expect(body.input.customPronunciations?.pronunciations).toHaveLength(1)
  })

  it('carries IPA hints in customPronunciations', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(request, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as {
      input: { customPronunciations?: { pronunciations: unknown[] } }
    }
    expect(body.input.customPronunciations?.pronunciations).toHaveLength(1)
  })

  it('omits customPronunciations entirely when nothing matches', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(
      { ...request, text: 'Nothing to declare.' },
      { apiKey: 'k', fetchImpl },
    )

    const body = JSON.parse(String(seen.init?.body)) as { input: Record<string, unknown> }
    expect(body.input).not.toHaveProperty('customPronunciations')
  })

  it('names the voice and agrees with it about the language', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(
      { ...request, voiceId: 'de-DE-Chirp3-HD-Kore' },
      { apiKey: 'k', fetchImpl },
    )

    const body = JSON.parse(String(seen.init?.body)) as { voice: Record<string, string> }
    expect(body.voice).toEqual({ languageCode: 'de-DE', name: 'de-DE-Chirp3-HD-Kore' })
  })

  it('passes pacing through as speakingRate, which is centred on 1 like ours', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise({ ...request, pacing: 0.9 }, { apiKey: 'k', fetchImpl })

    const body = JSON.parse(String(seen.init?.body)) as { audioConfig: { speakingRate: number } }
    expect(body.audioConfig.speakingRate).toBe(0.9)
  })

  it('sends the key in a header, never in the URL', async () => {
    const { fetchImpl, seen } = capture(AUDIO)
    await googleCloudTts.synthesise(request, { apiKey: 'secret-key', fetchImpl })

    expect(seen.url).not.toContain('secret-key')
    expect((seen.init?.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
  })

  it('refuses an empty answer rather than storing a silent take', async () => {
    await expect(
      googleCloudTts.synthesise(request, { apiKey: 'k', fetchImpl: respondWith({}) }),
    ).rejects.toThrow(ValidationError)
  })
})

describe('google cloud tts voices', () => {
  /** Trimmed from a real `GET /v1/voices?languageCode=en-GB` response. */
  const LIVE = {
    voices: [
      {
        name: 'en-GB-Chirp3-HD-Achernar',
        languageCodes: ['en-GB'],
        ssmlGender: 'FEMALE',
        naturalSampleRateHertz: 24000,
      },
      {
        name: 'en-GB-Chirp-HD-D',
        languageCodes: ['en-GB'],
        ssmlGender: 'MALE',
        naturalSampleRateHertz: 24000,
      },
      // The families deliberately not offered: an audition panel with two
      // hundred voices in it is a wall, not a choice.
      { name: 'en-GB-Standard-A', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
      { name: 'en-GB-Neural2-B', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
      { name: 'en-GB-Studio-C', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
    ],
  }

  it('offers only the Chirp families', async () => {
    const voices = await googleCloudTts.voices({ apiKey: 'k', fetchImpl: respondWith(LIVE) })
    expect(voices.map((voice) => voice.id)).toEqual([
      'en-GB-Chirp3-HD-Achernar',
      'en-GB-Chirp-HD-D',
    ])
  })

  it('labels a voice by its name rather than its full id', async () => {
    const voices = await googleCloudTts.voices({ apiKey: 'k', fetchImpl: respondWith(LIVE) })
    expect(voices[0]).toMatchObject({ label: 'Achernar', description: 'Chirp 3 HD · female' })
  })

  it('is empty rather than broken when the account has no Chirp voices', async () => {
    const voices = await googleCloudTts.voices({
      apiKey: 'k',
      fetchImpl: respondWith({ voices: [{ name: 'en-GB-Standard-A' }] }),
    })
    expect(voices).toEqual([])
  })

  it('verifies a key with the same free call', async () => {
    const { fetchImpl, seen } = capture({ voices: [] })
    await googleCloudTts.verifyKey('k', { fetchImpl })

    expect(seen.url).toContain('/voices')
    expect(seen.init?.method).toBeUndefined()
  })
})

/**
 * A pronunciation the vendor refuses must not cost us the words.
 *
 * Google validates against the voice's own phoneme inventory — `aI` passes for
 * en-GB, a bare `a` does not — and refuses the whole request with a 400 naming
 * the phrases. Our taxonomy makes that a non-retriable `ValidationError`, so
 * without a fallback one bad hint in Settings would fail every paragraph
 * containing that word, permanently, and take the chapter's narration with it.
 */
describe('a refused pronunciation', () => {
  const PCM_B64 = encodeWav(PCM, { sampleRate: NARRATION_SAMPLE_RATE }).toString('base64')

  function refuseThenAccept(): { fetchImpl: typeof fetch; bodies: string[] } {
    const bodies: string[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body))
      if (bodies.length === 1) {
        return new Response(
          JSON.stringify({
            error: {
              code: 400,
              message:
                'The following custom pronunciation phrases are invalid: Wirecard. Please ensure the phrases are well-structured.',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ audioContent: PCM_B64 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    return { fetchImpl, bodies }
  }

  it('retries once without it, so the paragraph is still narrated', async () => {
    const { fetchImpl, bodies } = refuseThenAccept()
    const result = await googleCloudTts.synthesise(request, { apiKey: 'k', fetchImpl })

    expect(bodies).toHaveLength(2)
    expect(result.audioBuffer).toEqual(PCM)

    // The retry carries the words, and no longer the pronunciation.
    const second = JSON.parse(bodies[1]!) as { input: Record<string, unknown> }
    expect(second.input).not.toHaveProperty('customPronunciations')
    expect(second.input['text']).toBe(
      String((JSON.parse(bodies[0]!) as { input: { text: string } }).input.text),
    )
  })

  it('reports what it dropped rather than degrading silently', () => {
    // Principle 6: anything auto-substituted must be visibly flagged.
    // The vendor's real wording, recorded from a live 400.
    expect(
      invalidPhrases(
        'The following custom pronunciation phrases are invalid: Wirecard. Please ensure the phrases are well-structured and that the phonemes are valid.',
      ),
    ).toEqual(['Wirecard'])

    expect(
      invalidPhrases('The following custom pronunciation phrases are invalid: Wirecard, Theranos.'),
    ).toEqual(['Wirecard', 'Theranos'])

    // Tolerant of rewording, because an exact match that stopped matching would
    // silently take the fallback away.
    expect(invalidPhrases('custom pronunciation entries were invalid: Enron.')).toEqual(['Enron'])

    // And says nothing about a 400 that is not about pronunciation at all.
    expect(invalidPhrases('Bad voice name')).toEqual([])
  })

  it('carries the dropped phrases up on the result', async () => {
    const { fetchImpl } = refuseThenAccept()
    const result = await googleCloudTts.synthesise(request, { apiKey: 'k', fetchImpl })
    expect(result.droppedPronunciations).toEqual(['Wirecard'])
  })

  it('does not retry a 400 that is about something else', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls += 1
      return new Response(JSON.stringify({ error: { code: 400, message: 'Bad voice name' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    await expect(googleCloudTts.synthesise(request, { apiKey: 'k', fetchImpl })).rejects.toThrow()
    expect(calls).toBe(1)
  })
})
