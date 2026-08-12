import type { PhonemeHint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { isIpa, markUpPhonemes, matchedHints, stylePromptWithHints } from './phonemes'

const hints: PhonemeHint[] = [
  { term: 'Wirecard', hint: '/ˈvaɪɐkart/' },
  { term: 'Theranos', hint: 'THAIR-uh-nose' },
  { term: 'Sarbanes-Oxley', hint: 'SAR-baynz OX-lee' },
]

describe('isIpa', () => {
  it('reads slashes as the IPA convention', () => {
    expect(isIpa('/ˈvaɪɐkart/')).toBe(true)
    expect(isIpa('VEER-card')).toBe(false)
    expect(isIpa('//')).toBe(false)
  })
})

describe('matchedHints', () => {
  it('selects only the terms present in this paragraph', () => {
    const matched = matchedHints('Wirecard filed for insolvency.', hints)
    expect(matched.map((hint) => hint.term)).toEqual(['Wirecard'])
  })

  it('matches case-insensitively', () => {
    expect(matchedHints('WIRECARD collapsed.', hints)).toHaveLength(1)
  })

  it('matches whole words only', () => {
    expect(matchedHints('The wirecards were unrelated.', hints)).toHaveLength(0)
  })

  /**
   * `\b` fails on a hyphen, and hyphenated terms are the norm here —
   * Sarbanes-Oxley, Dodd-Frank, Bre-X.
   */
  it('matches a hyphenated term', () => {
    expect(matchedHints('Sarbanes-Oxley changed the audit rules.', hints)).toHaveLength(1)
  })

  it('returns nothing when the list is empty, without inspecting the text', () => {
    expect(matchedHints('Anything at all.', [])).toEqual([])
  })
})

describe('stylePromptWithHints', () => {
  it('leaves the prompt untouched when nothing matches', () => {
    // No empty heading for the model to invent entries under, and no tokens
    // spent saying nothing — on every paragraph of every chapter.
    expect(stylePromptWithHints('Measured and dry.', 'Nothing to declare.', hints)).toBe(
      'Measured and dry.',
    )
  })

  it('appends only the matched terms', () => {
    const prompt = stylePromptWithHints('Measured.', 'Wirecard collapsed.', hints)
    expect(prompt).toContain('"Wirecard" is pronounced ˈvaɪɐkart (IPA)')
    expect(prompt).not.toContain('Theranos')
  })

  it('spells out a respelling as given', () => {
    expect(stylePromptWithHints('', 'Theranos ran out of blood.', hints)).toContain(
      '"Theranos" is pronounced "THAIR-uh-nose"',
    )
  })

  it('tells the model not to read the guidance aloud', () => {
    // Without it, "Pronounce these terms exactly as given" ends up in the audio.
    expect(stylePromptWithHints('', 'Wirecard.', hints)).toContain('do not read the guidance aloud')
  })

  it('works with no style prompt at all', () => {
    expect(stylePromptWithHints('', 'Nothing matches.', hints)).toBe('')
  })
})

describe('markUpPhonemes', () => {
  it('wraps an IPA hint in a phoneme tag around the original word', () => {
    expect(markUpPhonemes('Wirecard collapsed.', hints)).toBe(
      '<phoneme alphabet="ipa" ph="ˈvaɪɐkart">Wirecard</phoneme> collapsed.',
    )
  })

  it('substitutes a respelling, because it is not a phonetic alphabet', () => {
    expect(markUpPhonemes('Theranos raised $700m.', hints)).toBe('THAIR-uh-nose raised $700m.')
  })

  it('preserves the casing the paragraph used inside the tag', () => {
    expect(markUpPhonemes('WIRECARD collapsed.', hints)).toContain('>WIRECARD</phoneme>')
  })

  it('marks up every occurrence, not just the first', () => {
    const marked = markUpPhonemes('Wirecard, and Wirecard again.', hints)
    expect(marked.match(/<phoneme/g)).toHaveLength(2)
  })

  it('returns the text untouched when nothing matches', () => {
    expect(markUpPhonemes('Nothing to declare.', hints)).toBe('Nothing to declare.')
  })

  it('does not treat a hint term as a regular expression', () => {
    const odd: PhonemeHint[] = [{ term: 'S&P 500', hint: 'S and P five hundred' }]
    expect(markUpPhonemes('The S&P 500 fell.', odd)).toBe('The S and P five hundred fell.')
  })
})
