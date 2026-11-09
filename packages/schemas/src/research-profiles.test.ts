import { describe, expect, it } from 'vitest'
import { RESEARCH_PROFILES, evidenceLabel, researchProfileOf } from './research-profiles'

describe('research profiles', () => {
  it('reads a bible without a profile as investigation', () => {
    expect(researchProfileOf({}).key).toBe('investigation')
    expect(researchProfileOf({ researchProfile: 'science' }).key).toBe('science')
  })

  describe('investigation', () => {
    const p = RESEARCH_PROFILES.investigation

    it('keeps the document tiers it had before the move', () => {
      expect(p.tiers).toEqual({
        filing: 1,
        'web-archive': 1,
        'press-release': 1,
        reporting: 2,
        video: 3,
        figures: 4,
        regulator: 5,
        court: 5,
        scholarly: 2,
      })
    })

    it('keeps the tier shares', () => {
      expect(p.tierShares).toEqual({ 1: 0.25, 2: 0.3, 3: 0.15, 4: 0.1, 5: 0.2 })
    })

    it('accepts businesses and keeps the related words', () => {
      expect(p.subject.accept).toBe('business')
      expect(p.subject.relatedWords.test('Enron scandal')).toBe(true)
    })

    it('runs every keyed source, has no scholarly hosts and no evidence axis', () => {
      expect(Object.values(p.sources).every((on) => on === true)).toBe(true)
      expect(p.scholarlyHosts).toEqual([])
      expect(p.evidence).toBeNull()
      expect(evidenceLabel(p, 'x', 'script')).toBeNull()
    })
  })

  describe('science', () => {
    const p = RESEARCH_PROFILES.science

    it('accepts any topic and reads study words as related', () => {
      expect(p.subject.accept).toBe('topic')
      expect(p.subject.relatedWords.test('Stanford prison experiment')).toBe(true)
      expect(p.subject.relatedWords.test('Enron scandal')).toBe(false)
    })

    it('runs no keyed source', () => {
      expect(Object.values(p.sources).every((on) => on === false)).toBe(true)
    })

    it('ranks scholarly documents first and keeps the other tiers', () => {
      expect(p.tiers.scholarly).toBe(1)
      expect(p.tiers.reporting).toBe(RESEARCH_PROFILES.investigation.tiers.reporting)
      expect(p.tierShares).toEqual({ 1: 0.4, 2: 0.3, 3: 0.1, 4: 0.05, 5: 0.15 })
    })

    it('lists the scholarly hosts', () => {
      expect(p.scholarlyHosts).toHaveLength(24)
      expect(p.scholarlyHosts).toContain('doi.org')
      expect(p.scholarlyHosts).toContain('psycnet.apa.org')
    })

    it('has no evidence axis yet', () => {
      expect(p.evidence).toBeNull()
    })
  })

  it('every profile shares the corpus budget in full', () => {
    for (const p of Object.values(RESEARCH_PROFILES)) {
      const sum = Object.values(p.tierShares).reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
    }
  })
})
