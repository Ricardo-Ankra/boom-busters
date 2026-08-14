import type { PhonemeHint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { applyPronunciations, isIpa, matchedHints } from './phonemes'

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

describe('applyPronunciations', () => {
  it('substitutes a respelling into the text', () => {
    expect(applyPronunciations('Theranos raised $700m.', hints).text).toBe(
      'THAIR-uh-nose raised $700m.',
    )
  })

  it('substitutes every occurrence, not just the first', () => {
    const { text } = applyPronunciations('Theranos, and Theranos again.', hints)
    expect(text.match(/THAIR-uh-nose/g)).toHaveLength(2)
  })

  /**
   * Eleven v3 takes no phoneme markup — no SSML, no `<phoneme>` tag — so an
   * IPA transcription has no way into the request. Dropped and *named*, per
   * spec principle 6: degrading is allowed, doing it quietly is not, and the
   * settings screen turns the report into "write it as a respelling instead".
   */
  it('drops an IPA hint by name rather than sending markup v3 does not take', () => {
    const { text, dropped } = applyPronunciations('Wirecard collapsed.', hints)
    expect(text).toBe('Wirecard collapsed.')
    expect(dropped).toEqual(['Wirecard'])
  })

  it('drops nothing when nothing matches', () => {
    const { text, dropped } = applyPronunciations('Nothing to declare.', hints)
    expect(text).toBe('Nothing to declare.')
    expect(dropped).toEqual([])
  })

  it('does not treat a hint term as a regular expression', () => {
    const odd: PhonemeHint[] = [{ term: 'S&P 500', hint: 'S and P five hundred' }]
    expect(applyPronunciations('The S&P 500 fell.', odd).text).toBe(
      'The S and P five hundred fell.',
    )
  })

  it('replaces the casing the paragraph used, because a respelling is the spoken form', () => {
    expect(applyPronunciations('THERANOS collapsed.', hints).text).toBe('THAIR-uh-nose collapsed.')
  })
})
