import type { Settings } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { voiceKeyFacts } from './voice-identity'

const LIVE = { MOCK_PROVIDERS: undefined }

const tts: Settings['tts'] = {
  provider: 'gemini',
  voiceId: 'Charon',
  stylePrompt: 'A measured documentary narrator.',
  pacing: 1,
  phonemeHints: [],
}

describe('voiceKeyFacts', () => {
  it('includes the instructions on a prompt-steered narrator', () => {
    expect(voiceKeyFacts({ ...tts }, LIVE).stylePrompt).toBe('A measured documentary narrator.')
  })

  it('excludes them where the vendor never receives them', () => {
    // Cloud TTS sends plain text and a speaking rate; an edited instruction
    // cannot change a byte of its audio, so it must not re-buy anything.
    expect(
      voiceKeyFacts({ ...tts, provider: 'google-cloud-tts' }, LIVE).stylePrompt,
    ).toBeUndefined()
    expect(voiceKeyFacts({ ...tts, provider: 'elevenlabs' }, LIVE).stylePrompt).toBeUndefined()
  })

  it('excludes empty instructions, so promptless projects keep their keys', () => {
    expect(voiceKeyFacts({ ...tts, stylePrompt: '   ' }, LIVE).stylePrompt).toBeUndefined()
  })

  it('carries the rest of the identity untouched', () => {
    const facts = voiceKeyFacts({ ...tts, pacing: 0.9 }, LIVE)
    expect(facts.voiceId).toBe('Charon')
    expect(facts.pacing).toBe(0.9)
    expect(facts.pronunciations).toEqual([])
  })
})
