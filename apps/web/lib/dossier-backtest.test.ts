import { describe, expect, it, vi } from 'vitest'
import type { GroundedClaim, GroundedResearch } from '@boom-busters/schemas'
import {
  BACKTEST_CASES,
  BACKTEST_TARGETS,
  figureMatches,
  renderReport,
  scoreRuns,
  timedSteps,
  type CaseRun,
} from './dossier-backtest'

const annual = (year: number, val: number) => ({
  start: `${year}-01-01`,
  end: `${year}-12-31`,
  val,
  fy: year,
  fp: 'FY',
  form: '10-K',
  filed: `${year + 1}-02-01`,
})

const xbrl = {
  facts: {
    'us-gaap': {
      Revenues: { units: { USD: [annual(2021, 1_000_000_000), annual(2022, 2_000_000_000)] } },
      NetIncomeLoss: { units: { USD: [annual(2022, -500_000_000)] } },
      Assets: { units: { USD: [annual(2022, 212_000_000_000)] } },
    },
  },
}

const claim = (
  text: string,
  series: GroundedClaim['series'],
  found: boolean[] = [true],
): GroundedClaim => ({
  text,
  sourceUrl: null,
  sourceType: 'other',
  confidence: 'sourced',
  legalStatus: 'none',
  legalStatusDate: null,
  legalStatusDocumentId: null,
  series,
  supports: found.map((f, i) => ({
    documentId: 'd1',
    rank: i + 1,
    quote: 'q',
    found: f,
    offset: null,
    locatorSeconds: null,
    url: 'https://x.test',
    archivedUrl: null,
  })),
})

const series = (
  label: string,
  at: string,
  value: number,
  unit = 'USD',
): NonNullable<GroundedClaim['series']> => ({
  label,
  unit,
  currency: 'USD',
  points: [{ at, value, asWritten: String(value) }],
})

const research = (beats: { id: string; found: boolean }[] = []): GroundedResearch => ({
  entity: { qid: null, titles: [], cik: null, ticker: null, website: null },
  brief: {
    summary: '',
    turningPoint: '',
    cast: [],
    toldAlready: beats.map((b) => ({
      beat: 'a beat that was told already',
      ref: { documentId: b.id, url: null, found: b.found, locatorSeconds: null, quote: null },
    })),
    openQuestions: [],
  },
  scenes: [],
  answers: [],
  corpus: { read: 0, unread: 0, failed: 0 },
})

const page = { httpStatus: 200, archivedUrl: null, failure: null } as const

const run = (over: Partial<CaseRun> = {}): CaseRun => ({
  title: 'Enron',
  claims: [claim('Revenue grew.', null, [true, true])],
  research: research(),
  documents: [{ url: 'https://a.test', kind: 'reporting', ...page }],
  xbrl: null,
  costUsd: 3,
  model: 'claude-opus-5',
  passDurationsMs: { brief: 40_000, scenes: 60_000, claims: 150_000, answers: 90_000 },
  ...over,
})

describe('the back-test constants', () => {
  it('names the five cases and the targets', () => {
    expect(BACKTEST_CASES.map((c) => c.title)).toEqual([
      'Wirecard',
      'Enron',
      'Theranos',
      'FTX',
      'SVB Financial',
    ])
    expect(BACKTEST_TARGETS.costUsd).toBe(6)
    expect(BACKTEST_TARGETS.urlResolved).toBe(0.7)
    expect(BACKTEST_TARGETS).not.toHaveProperty('toldAlready')
    expect(BACKTEST_TARGETS.maxPassMs).toBe(200_000)
  })
})

describe('timedSteps', () => {
  it('times each research pass and passes every other step through untimed', async () => {
    let clock = 0
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const ran: string[] = []
    const { steps, durations } = timedSteps({
      run: async (id, fn) => {
        ran.push(id)
        return fn()
      },
    })

    const value = await steps.run('research-claims-2', async () => {
      clock += 1_500
      return 'claims'
    })
    await steps.run('research-ground-2', async () => {
      clock += 9_000
    })
    await expect(
      steps.run('research-brief-0', async () => {
        clock += 250
        throw new Error('model down')
      }),
    ).rejects.toThrow('model down')
    now.mockRestore()

    expect(value).toBe('claims')
    expect(ran).toEqual(['research-claims-2', 'research-ground-2', 'research-brief-0'])
    expect(durations).toEqual({ brief: 250, scenes: 0, claims: 1_500, answers: 0 })
  })
})

describe('figureMatches', () => {
  it('matches a point within 1 percent, in the unit the series names', () => {
    const claims = [
      claim('Revenue in 2022 was $2.0 billion.', series('Revenue', '2022', 2.01, 'USD billions')),
      claim('Net income in 2022 was a loss.', series('Net income', '2022', -400_000_000)),
    ]
    expect(figureMatches(claims, xbrl)).toEqual({ matched: 1, mismatched: 1, notCheckable: 0 })
  })

  it('reads total assets and ignores series that name no concept', () => {
    const claims = [
      claim('Total assets were large.', series('Total assets', '2022', 212_000_000_000)),
      claim('Revenue fell.', series('Headcount', '2022', 9)),
      claim('Staff numbers', series('Revenue', '2022', 1)),
    ]
    expect(figureMatches(claims, xbrl)).toEqual({ matched: 1, mismatched: 0, notCheckable: 0 })
  })

  it('counts a missing year, a non-year label and absent XBRL as not checkable', () => {
    const claims = [
      claim('Revenue in 2019', series('Revenue', '2019', 5)),
      claim('Revenue in Q1', series('Revenue', 'Q1 2022', 5)),
    ]
    expect(figureMatches(claims, xbrl)).toEqual({ matched: 0, mismatched: 0, notCheckable: 2 })
    expect(figureMatches(claims, null)).toEqual({ matched: 0, mismatched: 0, notCheckable: 2 })
  })

  it('ignores quarterly facts and non-USD series', () => {
    const quarterly = {
      facts: {
        'us-gaap': {
          Revenues: {
            units: {
              USD: [
                {
                  start: '2022-10-01',
                  end: '2022-12-31',
                  val: 5,
                  fp: 'FY',
                  form: '10-K',
                  filed: 'x',
                },
              ],
            },
          },
        },
      },
    }
    const euro = { ...series('Revenue', '2022', 2e9), currency: 'EUR' }
    expect(figureMatches([claim('Revenue 2022', series('Revenue', '2022', 5))], quarterly)).toEqual(
      {
        matched: 0,
        mismatched: 0,
        notCheckable: 1,
      },
    )
    expect(figureMatches([claim('Revenue 2022', euro)], xbrl).notCheckable).toBe(1)
  })
})

describe('scoreRuns', () => {
  it('passes a run that meets every target', () => {
    const report = scoreRuns([run()])
    expect(report.overall.quoteFound).toBe(1)
    expect(report.overall.urlResolved).toBe(1)
    expect(report.verdict).toEqual({ pass: true, failing: [] })
  })

  it('fails a rate under its target by name', () => {
    const report = scoreRuns([
      run({ claims: [claim('Revenue grew.', null, [true, false, false])] }),
    ])
    expect(report.overall.quoteFound).toBeCloseTo(1 / 3)
    expect(report.verdict.pass).toBe(false)
    expect(report.verdict.failing).toHaveLength(1)
    expect(report.verdict.failing[0]).toMatch(/^quoteFound/)
  })

  it('counts a Wayback copy as a resolved url', () => {
    const report = scoreRuns([
      run({
        documents: [
          {
            url: 'a',
            httpStatus: 404,
            archivedUrl: 'https://web.archive.org/x',
            kind: 'reporting',
            failure: null,
          },
          { url: 'b', httpStatus: null, archivedUrl: null, kind: 'reporting', failure: 'timeout' },
        ],
      }),
    ])
    expect(report.overall.urlResolved).toBe(0.5)
    expect(report.verdict.failing[0]).toMatch(/^urlResolved/)
  })

  it('passes a URL rate at the 70 percent target', () => {
    const resolved = { url: 'r', kind: 'reporting', ...page } as const
    const dead = { ...resolved, url: 'd', httpStatus: 404 }
    const documents: CaseRun['documents'] = [
      ...Array.from({ length: 7 }, () => resolved),
      ...Array.from({ length: 3 }, () => dead),
    ]
    const report = scoreRuns([run({ documents })])
    expect(report.overall.urlResolved).toBe(0.7)
    expect(report.verdict).toEqual({ pass: true, failing: [] })
  })

  it('reports no checkable figures and no transcripts as not measured, and passes', () => {
    const report = scoreRuns([run()])
    expect(report.overall.figureMatch).toBe('not measured')
    expect(report.overall.toldAlready).toBe('not measured')
    expect(report.transcriptAvailability).toBe('not measured')
    expect(report.verdict.pass).toBe(true)
  })

  it('scores told-already only over videos with a transcript', () => {
    const documents: CaseRun['documents'] = [
      { id: 'v1', url: 'https://y.test/1', kind: 'video', transcript: true, ...page },
      { id: 'v2', url: 'https://y.test/2', kind: 'video', transcript: false, ...page },
    ]
    const report = scoreRuns([
      run({
        documents,
        research: research([
          { id: 'v1', found: true },
          { id: 'v1', found: false },
          { id: 'v2', found: false },
        ]),
      }),
    ])
    expect(report.overall.toldAlready).toBe(0.5)
    expect(report.transcriptAvailability).toBe(0.5)
    // Reported, never gated: no transcript source exists to measure it against.
    expect(report.verdict.failing).toEqual([])
  })

  it('counts beats grounding dropped for lacking a transcript quote', () => {
    const documents: CaseRun['documents'] = [
      { id: 'v1', url: 'https://y.test/1', kind: 'video', transcript: true, ...page },
    ]
    const report = scoreRuns([
      run({ documents, research: research([{ id: 'v1', found: true }]), beatsDropped: 3 }),
    ])
    expect(report.overall.toldAlready).toBe(0.25)
    expect(report.verdict.failing).toEqual([])
  })

  it('pools figures across cases and fails a mismatch-heavy overall', () => {
    const report = scoreRuns([
      run({
        xbrl,
        claims: [
          claim('Revenue 2022', series('Revenue', '2022', 2e9)),
          claim('Revenue 2021', series('Revenue', '2021', 1)),
        ],
      }),
    ])
    expect(report.overall.figures).toEqual({ matched: 1, mismatched: 1, notCheckable: 0 })
    expect(report.overall.figureMatch).toBe(0.5)
    expect(report.verdict.failing[0]).toMatch(/^figureMatch/)
  })

  it('fails a dossier over the cost target and names the case', () => {
    const report = scoreRuns([run({ title: 'FTX', costUsd: 7.5 }), run({ costUsd: 2 })])
    expect(report.verdict.failing).toEqual([expect.stringMatching(/^costUsd.*FTX/)])
  })
})

describe('incomplete runs', () => {
  it('fails a pass over 200 s, naming the case and the pass', () => {
    const slow = { brief: 40_000, scenes: 60_000, claims: 212_300, answers: 200_000 }
    const report = scoreRuns([run({ title: 'FTX', passDurationsMs: slow }), run()])
    expect(report.verdict.failing).toEqual([
      'maxPassMs: FTX claims pass took 212.3 s, over the 200.0 s limit',
    ])
  })

  it('fails when a case was skipped, naming it, and says Incomplete', () => {
    const report = scoreRuns([run()], ['FTX', 'Theranos'])
    expect(report.verdict.pass).toBe(false)
    expect(report.verdict.failing[0]).toBe('skipped: FTX, Theranos')
    expect(renderReport(report, '2026-10-30')).toContain('Incomplete')
  })

  it('fails when no case was scored', () => {
    const report = scoreRuns([], ['Wirecard'])
    expect(report.verdict).toEqual({ pass: false, failing: ['skipped: Wirecard'] })
    expect(scoreRuns([]).verdict.pass).toBe(false)
  })
})

describe('the shared XBRL reader', () => {
  it('prefers the longer period when two facts tie on filed', () => {
    const tie = {
      facts: {
        'us-gaap': {
          Revenues: {
            units: {
              USD: [
                {
                  start: '2022-01-01',
                  end: '2022-12-31',
                  val: 1,
                  fp: 'FY',
                  form: '10-K',
                  filed: 'f',
                },
                {
                  start: '2021-01-01',
                  end: '2022-12-31',
                  val: 2_000,
                  fp: 'FY',
                  form: '10-K',
                  filed: 'f',
                },
              ],
            },
          },
        },
      },
    }
    const claims = [claim('Revenue 2022', series('Revenue', '2022', 2000))]
    expect(figureMatches(claims, tie)).toEqual({ matched: 1, mismatched: 0, notCheckable: 0 })
  })
})

describe('renderReport', () => {
  it('writes a table per rate with a row per case, then the verdict', () => {
    const report = scoreRuns([run({ title: 'Wirecard' }), run({ title: 'Enron', costUsd: 9 })])
    const md = renderReport(report, '2026-10-30')
    expect(md).toContain('# Dossier back-test, 2026-10-30')
    expect(md).toContain('## Quote-found rate')
    expect(md).toContain('| Wirecard | 100.0% |')
    expect(md).toContain('| Overall |')
    expect(md).toContain('not measured')
    expect(md).toContain('claude-opus-5')
    expect(md.indexOf('## Verdict')).toBeGreaterThan(md.indexOf('## Cost'))
    expect(md).toMatch(/Failing[\s\S]*costUsd/)
  })

  it('writes a pass-duration row per case', () => {
    const md = renderReport(
      scoreRuns([
        run({
          title: 'Wirecard',
          passDurationsMs: { brief: 41_250, scenes: 63_000, claims: 171_940, answers: 0 },
        }),
      ]),
      '2026-10-30',
    )
    expect(md).toContain('## Pass durations')
    expect(md).toContain('| Case | Brief | Scenes | Claims | Answers |')
    expect(md).toContain('| Wirecard | 41.3 s | 63.0 s | 171.9 s | 0.0 s |')
    expect(md.indexOf('## Pass durations')).toBeLessThan(md.indexOf('## Verdict'))
  })

  it('marks the told-already rate as reported only, and says why', () => {
    const md = renderReport(scoreRuns([run()]), '2026-10-30')
    expect(md).toContain(
      'Target: Reported only; no transcript source exists (the YouTube caption endpoint answers 404 to unsigned requests, confirmed 2026-10-22).',
    )
    expect(md).toContain('Target: at least 70.0%.')
  })

  it('says the rollout may go on when nothing fails', () => {
    expect(renderReport(scoreRuns([run()]), '2026-10-30')).toContain('Pass')
  })
})
