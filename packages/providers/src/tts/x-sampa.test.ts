import { describe, expect, it } from 'vitest'
import { ipaToXSampa, isUsableXSampa } from './x-sampa'

/**
 * Cloud TTS rejects `PHONETIC_ENCODING_IPA` outright and accepts X-SAMPA —
 * verified against a live key on 2026-08-13, on every voice family and every
 * phrase tried. The hints stay IPA where a human writes them, so this is the
 * conversion in between.
 *
 * What these tests do *not* claim: that a converted transcription will be
 * accepted. Google validates against the voice's own phoneme inventory, so
 * `aI` passes for en-GB and a bare `a` does not — correct X-SAMPA is necessary
 * and not sufficient. That is why the adapter drops a refused pronunciation and
 * carries on, and why Settings checks a hint with the vendor when it is typed.
 */

describe('ipaToXSampa', () => {
  it('strips the slashes a human writes around a transcription', () => {
    expect(ipaToXSampa('/tɒm/')).toBe('tQm')
    expect(ipaToXSampa('[tɒm]')).toBe('tQm')
    expect(ipaToXSampa('tɒm')).toBe('tQm')
  })

  it('maps the stress and length marks', () => {
    expect(ipaToXSampa('ˈtoʊ')).toBe('"toU')
    expect(ipaToXSampa('ˌtoʊ')).toBe('%toU')
    expect(ipaToXSampa('ɑː')).toBe('A:')
  })

  it.each([
    ['ə', '@'],
    ['ɪ', 'I'],
    ['ʊ', 'U'],
    ['ɛ', 'E'],
    ['æ', '{'],
    ['ɒ', 'Q'],
    ['ʌ', 'V'],
    ['ɐ', '6'],
    ['ʃ', 'S'],
    ['ʒ', 'Z'],
    ['θ', 'T'],
    ['ð', 'D'],
    ['ŋ', 'N'],
    ['ɜ', '3'],
  ])('maps %s to %s', (ipa, xsampa) => {
    expect(ipaToXSampa(ipa)).toBe(xsampa)
  })

  it('converts a real transcription end to end', () => {
    expect(ipaToXSampa('/ˈθɛrənoʊs/')).toBe('"TEr@noUs')
    expect(ipaToXSampa('/ˈɛnrɒn/')).toBe('"EnrQn')
  })

  it('leaves plain ASCII letters alone, since X-SAMPA shares them', () => {
    expect(ipaToXSampa('kart')).toBe('kart')
  })

  it('drops a symbol it does not know rather than guessing at it', () => {
    // A guess would be a pronunciation nobody chose. The adapter verifies the
    // result with the vendor anyway, so omission is the safe failure.
    expect(ipaToXSampa('t\u0361m')).toBe('tm')
  })

  it('handles an empty transcription without throwing', () => {
    expect(ipaToXSampa('')).toBe('')
    expect(ipaToXSampa('//')).toBe('')
  })
})

describe('isUsableXSampa', () => {
  it('rejects a transcription that converted to nothing but marks', () => {
    expect(isUsableXSampa('"')).toBe(false)
    expect(isUsableXSampa('')).toBe(false)
  })

  it('accepts one with phonemes in it', () => {
    expect(isUsableXSampa('"TEr@noUs')).toBe(true)
    expect(isUsableXSampa('{')).toBe(true)
  })
})
