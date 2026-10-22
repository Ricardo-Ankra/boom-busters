import { describe, expect, it } from 'vitest'
import {
  CaseBriefSchema,
  DOCUMENT_KINDS,
  DOCUMENT_TIERS,
  DOSSIER_SERIES_POINTS_MAX,
  LegalSchema,
  ResearchClaimSchema,
  SeriesSchema,
} from './dossier'

describe('ResearchClaimSchema', () => {
  it('needs one to three supports and defaults legal and series to null', () => {
    const claim = ResearchClaimSchema.parse({
      text: 'Wirecard filed for insolvency in June 2020.',
      supports: [{ doc: 2, quote: 'filed for insolvency' }],
    })
    expect(claim.legal).toBeNull()
    expect(claim.series).toBeNull()
    expect(() => ResearchClaimSchema.parse({ text: 'x'.repeat(20), supports: [] })).toThrow()
    expect(() =>
      ResearchClaimSchema.parse({
        text: 'x'.repeat(20),
        supports: Array(4).fill({ doc: 1, quote: 'q' }),
      }),
    ).toThrow()
  })

  it('accepts a legal date at year, month or day precision', () => {
    for (const date of ['2020', '2020-06', '2020-06-25'])
      expect(LegalSchema.parse({ status: 'ruled', date, doc: 1 }).date).toBe(date)
    expect(() => LegalSchema.parse({ status: 'ruled', date: 'June 2020', doc: 1 })).toThrow()
  })

  it('caps a series at 24 points', () => {
    const point = { at: '2019', value: 1, asWritten: '1' }
    const series = (n: number) => ({
      label: 'Revenue',
      unit: 'EUR',
      currency: 'EUR',
      points: Array(n).fill(point),
    })
    expect(DOSSIER_SERIES_POINTS_MAX).toBe(24)
    expect(SeriesSchema.parse(series(24)).points).toHaveLength(24)
    expect(() => SeriesSchema.parse(series(25))).toThrow()
  })
})

describe('CaseBriefSchema', () => {
  it('has cast and toldAlready, not principals', () => {
    const brief = CaseBriefSchema.parse({
      summary: 's'.repeat(60),
      turningPoint: 't'.repeat(30),
      cast: [{ name: 'Markus Braun', role: 'CEO', wanted: 'To keep the share price rising.' }],
      openQuestions: [],
    })
    expect(brief.cast[0]?.scene).toBeNull()
    expect(brief.toldAlready).toEqual([])
    expect('principals' in brief).toBe(false)
  })
})

describe('DOCUMENT_TIERS', () => {
  it('assigns every kind a tier from one to five', () => {
    for (const kind of DOCUMENT_KINDS) expect([1, 2, 3, 4, 5]).toContain(DOCUMENT_TIERS[kind])
  })
})
