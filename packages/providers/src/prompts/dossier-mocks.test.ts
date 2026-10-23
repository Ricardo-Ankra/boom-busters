import { DOSSIER_QUOTE_MIN_FOLDED } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { foldText } from '../research/fold'
import { mockCorpusDocuments } from '../research/mock-corpus'
import { parseAnswers, parseBrief, parseClaims, parseScenes } from './dossier'
import { mockAnswers, mockBrief, mockClaims, mockScenes } from './dossier-mocks'

const caseContext = { title: 'Enron', category: 'collapse' }

describe('mock research', () => {
  const documents = mockCorpusDocuments()
  const textOf = (doc: number) => documents[doc - 1]!.text

  it('says in the dossier itself that nothing was researched', () => {
    // A mock dossier that reads plausibly is one somebody eventually approves by accident.
    expect(mockBrief(caseContext).summary).toMatch(/MOCK DOSSIER/)
    expect(mockBrief(caseContext).summary).toMatch(/No research was performed/)
  })

  it('says where the mock story stands now, dated, so the fixture shows the section', () => {
    const status = mockBrief(caseContext).currentStatus
    expect(status?.asOf).toMatch(/^\d{4}(-\d{2}){0,2}$/)
    expect(status?.text).toMatch(/^MOCK STATUS/)
  })

  it('gathers four documents of the kinds the checks need, each labelled mock', () => {
    expect(documents.map((document) => document.kind)).toEqual([
      'press-release',
      'reporting',
      'video',
      'regulator',
    ])
    for (const document of documents) expect(document.text.startsWith('MOCK DOCUMENT')).toBe(true)
    expect(textOf(3)).toMatch(/\[\d{2}:\d{2}\]/)
  })

  it('validates against the same schemas as real output', () => {
    const brief = parseBrief(JSON.stringify(mockBrief(caseContext)))
    expect(brief).toEqual(mockBrief(caseContext))
    expect(parseScenes(JSON.stringify({ scenes: mockScenes() }))).toEqual(mockScenes())
    expect(parseClaims(JSON.stringify({ claims: mockClaims() }))).toEqual(mockClaims())
    expect(parseAnswers(JSON.stringify(mockAnswers(brief)))).toEqual(mockAnswers(brief))
  })

  it('cites only the four mock documents', () => {
    const brief = mockBrief(caseContext)
    const cited = [
      ...brief.cast.flatMap((member) => (member.scene ? [member.scene.doc] : [])),
      ...brief.toldAlready.map((told) => told.doc),
      ...mockScenes().map((scene) => scene.doc),
      ...mockClaims().flatMap((claim) => [
        ...claim.supports.map((support) => support.doc),
        ...(claim.legal ? [claim.legal.doc] : []),
      ]),
      ...mockAnswers(brief).answers.flatMap((answer) => (answer.doc ? [answer.doc] : [])),
    ]
    expect(cited.length).toBeGreaterThan(0)
    for (const doc of cited) {
      expect(doc).toBeGreaterThanOrEqual(1)
      expect(doc).toBeLessThanOrEqual(documents.length)
    }
  })

  it('misses exactly one quote on purpose, so the e2e fixture parks at the gate', () => {
    const brief = mockBrief(caseContext)
    const quotes = [
      ...brief.cast.flatMap((member) => (member.scene ? [member.scene] : [])),
      ...brief.toldAlready,
      ...mockScenes(),
      ...mockClaims().flatMap((claim) => claim.supports),
    ]
    const missing = quotes.filter(({ doc, quote }) => !textOf(doc).includes(quote))
    expect(missing).toEqual([mockClaims()[1]!.supports[0]])
    // Long enough for the quote check, so the miss is the only one it reports.
    for (const { quote } of quotes) {
      expect(foldText(quote).folded.length).toBeGreaterThanOrEqual(DOSSIER_QUOTE_MIN_FOLDED)
    }
    const figure = mockClaims()[2]!
    for (const point of figure.series!.points) {
      expect(foldText(point.asWritten).folded.length).toBeGreaterThanOrEqual(
        DOSSIER_QUOTE_MIN_FOLDED,
      )
    }
  })

  it('carries a figure series written as doc 1 prints it, a ruled status and a transcript scene', () => {
    const [, , figure, ruled] = mockClaims()
    expect(figure?.supports[0]?.doc).toBe(1)
    expect(figure?.series?.points).toHaveLength(2)
    for (const point of figure!.series!.points) expect(textOf(1)).toContain(point.asWritten)
    expect(ruled?.legal).toEqual({ status: 'ruled', date: '2019-02', doc: 4 })
    expect(mockClaims()[0]?.supports.map((support) => support.doc)).toEqual([2, 4])
    expect(mockScenes().some((scene) => documents[scene.doc - 1]?.kind === 'video')).toBe(true)
    expect(mockBrief(caseContext).toldAlready.map((told) => told.doc)).toEqual([3])
  })

  it('is deterministic', () => {
    expect(mockBrief(caseContext)).toEqual(mockBrief(caseContext))
    expect(mockCorpusDocuments()).toEqual(mockCorpusDocuments())
  })
})
