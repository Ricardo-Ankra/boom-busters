import type { Settings } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { voiceKeyFacts } from './voice-identity'

const tts: Settings['tts'] = {
  provider: 'elevenlabs',
  voiceId: 'v-narrator',
  stability: 'natural',
  phonemeHints: [],
}

describe('voiceKeyFacts', () => {
  it('carries exactly the settings that change how a paragraph is spoken', () => {
    expect(voiceKeyFacts(tts)).toEqual({
      voiceId: 'v-narrator',
      pronunciations: [],
      stability: 'natural',
    })
  })

  it('carries a moved stability tier, so changing it re-reads', () => {
    expect(voiceKeyFacts({ ...tts, stability: 'robust' }).stability).toBe('robust')
  })

  it('carries the pronunciation list for the key to narrow per paragraph', () => {
    const hints = [{ term: 'Wirecard', hint: 'VEER-card' }]
    expect(voiceKeyFacts({ ...tts, phonemeHints: hints }).pronunciations).toEqual(hints)
  })
})
