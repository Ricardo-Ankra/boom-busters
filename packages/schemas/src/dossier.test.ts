import { describe, expect, it } from 'vitest'
import {
  CaseBriefSchema,
  DOCUMENT_KINDS,
  DOCUMENT_TIERS,
  DOSSIER_SERIES_POINTS_MAX,
  DOSSIER_STATUS_MAX,
  GroundedResearchSchema,
  LegalSchema,
  ResearchClaimSchema,
  ResearchEntitySchema,
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

describe('current status and entity defaults', () => {
  const brief = {
    summary: 'x'.repeat(60),
    turningPoint: 'The audit finally looked at the trust accounts.',
    cast: [],
    openQuestions: [],
  }

  it('defaults the brief currentStatus to null so old briefs parse', () => {
    expect(CaseBriefSchema.parse(brief).currentStatus).toBeNull()
  })

  it('parses a current status and enforces its limits', () => {
    const status = {
      asOf: '2026-10',
      text: 'Braun is on trial in Munich and the verdict is pending.',
    }
    expect(CaseBriefSchema.parse({ ...brief, currentStatus: status }).currentStatus).toEqual(status)
    expect(
      CaseBriefSchema.safeParse({ ...brief, currentStatus: { ...status, asOf: 'October' } })
        .success,
    ).toBe(false)
    expect(
      CaseBriefSchema.safeParse({ ...brief, currentStatus: { ...status, text: 'too short' } })
        .success,
    ).toBe(false)
    expect(
      CaseBriefSchema.safeParse({
        ...brief,
        currentStatus: { ...status, text: 'x'.repeat(DOSSIER_STATUS_MAX + 1) },
      }).success,
    ).toBe(false)
  })

  it('defaults new ResearchEntity fields so stored research still parses', () => {
    const old = { qid: 'Q1', titles: [], cik: null, ticker: null, website: null }
    const parsed = ResearchEntitySchema.parse(old)
    expect(parsed.people).toEqual([])
    expect(parsed.unresolved).toBe(false)
    expect(parsed.subject).toBeNull()
  })

  it('carries currentStatus through GroundedResearchSchema.brief', () => {
    const status = { asOf: '2026', text: 'Braun is on trial in Munich and the verdict is pending.' }
    const parsed = GroundedResearchSchema.parse({
      entity: { qid: null, titles: [], cik: null, ticker: null, website: null },
      brief: { ...brief, currentStatus: status, toldAlready: [] },
      scenes: [],
      answers: [],
      corpus: { read: 0, unread: 0, failed: 0 },
    })
    expect(parsed.brief.currentStatus).toEqual(status)
  })
})
