import { describe, expect, it } from 'vitest'
import {
  RESEARCH_PROFILES,
  evidenceLabel,
  researchProfileOf,
  standingSeverity,
  withStandingSeverity,
} from './research-profiles'

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

    it('grades a finding established, one study or contested', () => {
      expect(p.evidence?.statuses.map((s) => s.key)).toEqual([
        'established',
        'single_study',
        'contested',
      ])
      expect(evidenceLabel(p, 'established', 'script')).toBe('ESTABLISHED FINDING')
      expect(evidenceLabel(p, 'single_study', 'script')).toBe('ONE STUDY')
      expect(evidenceLabel(p, 'contested', 'script')).toBe('CONTESTED')
      expect(evidenceLabel(p, 'established', 'review')).toBe('Established')
      expect(evidenceLabel(p, 'single_study', 'review')).toBe('One study')
      expect(evidenceLabel(p, 'contested', 'review')).toBe('Contested')
      expect(evidenceLabel(p, 'nonsense', 'review')).toBeNull()
    })

    it('earns established from two scholarly documents or a review word, else falls to one study', () => {
      expect(p.evidence?.earned).toEqual({
        status: 'established',
        minScholarlyDocuments: 2,
        reviewWords: ['meta-analysis', 'meta-analyses', 'meta-analytic', 'systematic review'],
      })
      expect(p.evidence?.fallback).toBe('single_study')
    })
  })

  it('every profile shares the corpus budget in full', () => {
    for (const p of Object.values(RESEARCH_PROFILES)) {
      const sum = Object.values(p.tierShares).reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - 1)).toBeLessThan(1e-9)
    }
  })

  it('the investigation reviews no standing and the science blocks contested, advises one study', () => {
    expect(RESEARCH_PROFILES.investigation.review).toBeNull()
    expect(RESEARCH_PROFILES.science.review).toEqual({
      standing: { blocking: ['contested'], advisory: ['single_study'] },
    })
  })

  it('reads the label out of the message', () => {
    const { science, investigation } = RESEARCH_PROFILES
    expect(standingSeverity(science, 'CONTESTED: narrated as settled')).toBe('blocking')
    expect(standingSeverity(science, 'Narrated as settled, but the claim is ONE STUDY')).toBe(
      'advisory',
    )
    expect(standingSeverity(science, 'ESTABLISHED FINDING')).toBeNull()
    expect(standingSeverity(science, 'no label here')).toBeNull()
    expect(standingSeverity(investigation, 'CONTESTED')).toBeNull()
  })

  it('stamps severity on overstated-standing warnings only', () => {
    const standing = {
      kind: 'overstated-standing' as const,
      sentence: 's',
      message: 'ONE STUDY here',
    }
    const other = { kind: 'unsourced-claim' as const, sentence: 's', message: 'no source given' }
    const unresolved = {
      kind: 'overstated-standing' as const,
      sentence: 's',
      message: 'no label here',
    }
    const result = withStandingSeverity(RESEARCH_PROFILES.science, [standing, other, unresolved])
    expect(result).toEqual([{ ...standing, severity: 'advisory' }, other, unresolved])
    expect('severity' in result[1]!).toBe(false)
    expect('severity' in result[2]!).toBe(false)
  })

  it('the strictest label in a message wins', () => {
    const { science } = RESEARCH_PROFILES
    expect(standingSeverity(science, 'ONE STUDY narrated as settled; the claim is CONTESTED')).toBe(
      'blocking',
    )
    expect(standingSeverity(science, 'ESTABLISHED FINDING and ONE STUDY')).toBe('advisory')
  })

  it('the investigation leaves every warning untouched', () => {
    const warnings = [
      { kind: 'overstated-standing' as const, sentence: 's', message: 'CONTESTED here' },
      { kind: 'unsourced-claim' as const, sentence: 's', message: 'no source given' },
    ]
    const result = withStandingSeverity(RESEARCH_PROFILES.investigation, warnings)
    expect(result[0]).toBe(warnings[0])
    expect(result[1]).toBe(warnings[1])
    expect('severity' in result[0]!).toBe(false)
  })
})
