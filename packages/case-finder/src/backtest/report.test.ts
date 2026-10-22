import { describe, expect, it } from 'vitest'
import {
  passes,
  renderReport,
  scoreForCorrelation,
  verdict,
  type CaseRow,
  type ReportMeta,
} from './report'

function row(n: number, overrides: Partial<CaseRow> = {}): CaseRow {
  return {
    videoId: `vid${n}`,
    channel: '@ModernMBA',
    title: `[fake] video ${n}`,
    T: '2021-05-01',
    lane: n % 2 === 0 ? 'downfall' : 'success',
    qid: `Q${n}`,
    status: 'ranked',
    pct: { D: 50, G: 50, S: 50, W: 50 },
    score: 10 * n,
    legalKillWouldApply: false,
    baseline: 100 - 5 * n,
    outcome: n,
    spike: 1,
    countedVideos: 0,
    cappedVideos: 0,
    cappedChannels: [],
    ...overrides,
  }
}

const META: ReportMeta = {
  mock: false,
  configVersion: 1,
  commit: 'abc1234',
  baselineModel: 'claude-test',
  baselineAsked: 6,
  baselineScored: 6,
  runDate: '2026-10-21',
  outcomeMeasuredOn: '2026-10-18',
  quotaNote: '9,000 YouTube units left today',
  hitlistByLane: { downfall: 1200, success: 300, none: 40 },
  unresolvedSeedNames: 17,
  selectionNote: '10 selected: 5 downfall, 5 success',
  noLaneAtT: 2,
  unusable: [],
}

const dashes = /[\u2013\u2014]/

describe('scoreForCorrelation', () => {
  it('unrankable rows score below every ranked row', () => {
    const rows = [
      row(1, { score: 42 }),
      row(2, { status: 'miss', pct: null, score: 0 }),
      row(3, { score: 17.5 }),
      row(4, { status: 'below floor', pct: null, score: 0 }),
      row(5, { status: 'paper trail none', score: 90 }),
      row(6, { status: 'no lane', pct: null, score: 0 }),
      row(7, { status: 'outside top 250', pct: null, score: 0 }),
    ]
    expect(scoreForCorrelation(rows)).toEqual([42, 16.5, 17.5, 16.5, 16.5, 16.5, 16.5])
  })

  it('with nothing ranked every unrankable row scores 0', () => {
    expect(scoreForCorrelation([row(1, { status: 'miss', score: 5 })])).toEqual([0])
  })
})

describe('verdict', () => {
  it('pass needs both conditions', () => {
    expect(passes(0.35, 0.4)).toBe(false)
    expect(passes(0.31, 0.2)).toBe(true)
    expect(passes(0.29, 0.1)).toBe(false)
    expect(passes(0.31, Number.NaN)).toBe(false)
  })

  it('correlates the rubric and the baseline with the outcome, with intervals', () => {
    // Rubric score rises with the outcome; the baseline falls with it.
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1))
    const v = verdict(rows)
    expect(v.rhoRubric).toBeCloseTo(1)
    expect(v.rhoBaseline).toBeCloseTo(-1)
    expect(v.pass).toBe(true)
    expect(v.ciRubric[0]).toBeLessThanOrEqual(v.rhoRubric)
    expect(v.ciRubric[1]).toBeGreaterThanOrEqual(v.ciRubric[0])
    expect(v.ciDifference[0]).toBeGreaterThan(0)
    expect(verdict(rows)).toEqual(v)
  })

  it('pass needs a baseline score for every row', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1))
    expect(verdict(rows).pass).toBe(true)
    rows[3] = { ...rows[3]!, baseline: null }
    const v = verdict(rows)
    expect(v.rhoRubric).toBeGreaterThan(v.rhoBaseline)
    expect(v.pass).toBe(false)
  })

  it('leaves the baseline undecided when it was not run', () => {
    const v = verdict(Array.from({ length: 6 }, (_, i) => row(i + 1, { baseline: null })))
    expect(Number.isNaN(v.rhoBaseline)).toBe(true)
    expect(v.ciBaseline.every(Number.isNaN)).toBe(true)
    expect(v.ciDifference.every(Number.isNaN)).toBe(true)
    expect(v.pass).toBe(false)
  })

  it('reports per lane, without legal kills, the miss rate and the spike line', () => {
    const rows = [
      row(1, { spike: 4, outcome: 10 }),
      row(2, { spike: 3, outcome: 1 }),
      row(3, { spike: 0.5, outcome: 5 }),
      row(4, { status: 'miss', pct: null, spike: null, outcome: 2 }),
      row(5, { legalKillWouldApply: true, spike: null, outcome: 7 }),
      row(6, { spike: 1, outcome: 3 }),
    ]
    const v = verdict(rows)
    expect(Object.keys(v.perLane).sort()).toEqual(['downfall', 'success'])
    expect(v.missRate).toBeCloseTo(1 / 6)
    // Outcomes sorted 1 2 3 5 7 10: median 4. Spiking rows 1 and 2; only row 1 is above.
    expect(v.spikeVsOutcome).toEqual({ spiking: 2, aboveMedian: 1 })
    expect(Number.isFinite(v.withoutLegalKills)).toBe(true)
  })
})

describe('renderReport', () => {
  const rows = Array.from({ length: 6 }, (_, i) => row(i + 1))

  it("the report states the YouTube hindsight caveat and the baseline's head start", () => {
    const text = renderReport(rows, verdict(rows), META)
    expect(text).toContain(
      "YouTube view counts are today's, not as of each test date, so the competition measure is partly hindsight.",
    )
    expect(text).toContain(
      'The baseline model already knows which of these cases became hits, which gives it an unfair advantage.',
    )
  })

  it('discloses the channel-median rule and names every known hindsight', () => {
    const text = renderReport(rows, verdict(rows), META)
    const caveats = text.slice(text.indexOf('## Caveats'), text.indexOf('## Breakdown'))
    expect(caveats).toContain(
      "- Channel medians use each channel's uploads within six months of the video; where reaching that far back needed more than 20 pages, the channel's latest 50 uploads were used instead. When a channel's history was read across more than one day, uploads posted in between can shift YouTube's pages, so a few older uploads may be missed.\n",
    )
    for (const sentence of [
      "Pageviews include each article's current former titles, and world interest uses each company's current language editions.",
      'Each company is searched under its current English title, so a company renamed after a test date is searched under its later name.',
      "Founders' and executives' living status and convictions are read from Wikidata as they stand today.",
    ]) {
      expect(caveats).toContain(`- ${sentence}\n`)
    }
  })

  it('counts the capped channels and counted videos under the channel-median caveat', () => {
    const counted = [
      row(1, { countedVideos: 4, cappedVideos: 2, cappedChannels: ['UCa', 'UCb'] }),
      row(2, { countedVideos: 3, cappedVideos: 1, cappedChannels: ['UCb'] }),
      row(3, { countedVideos: 5 }),
      row(4, { status: 'miss', pct: null }),
    ]
    const text = renderReport(counted, verdict(counted), META)
    expect(text).toContain(
      "- Channel medians use each channel's uploads within six months of the video; where " +
        "reaching that far back needed more than 20 pages, the channel's latest 50 uploads " +
        "were used instead. When a channel's history was read across more than one day, " +
        "uploads posted in between can shift YouTube's pages, so a few older uploads may be " +
        'missed.\n  - Capped: 2 channels, 3 of 12 counted videos.\n',
    )
    const none = renderReport(rows, verdict(rows), META)
    expect(none).toContain('  - Capped: 0 channels, 0 of 0 counted videos.\n')
  })

  it('lists the channel-median decision with the others fixed before the run', () => {
    const text = renderReport(rows, verdict(rows), META)
    expect(text).toMatch(/\n11\. Channel medians \(owner's ruling 2026-10-21/)
  })

  it('puts the verdict first and lists every case, the decisions and the run facts', () => {
    const text = renderReport(rows, verdict(rows), META)
    const verdictAt = text.indexOf('## Verdict')
    expect(verdictAt).toBeGreaterThan(-1)
    expect(verdictAt).toBeLessThan(text.indexOf('## Caveats'))
    expect(text.indexOf('## Caveats')).toBeLessThan(text.indexOf('## Cases'))
    for (const r of rows) expect(text).toContain(`| ${r.videoId} |`)
    expect(text).toContain('Paper-trail levels')
    expect(text).toContain('Raw cache')
    expect(text).toContain('downfall 1,200, success 300, no lane 40')
    expect(text).toContain('Unresolved seed names: 17')
    expect(text).toContain('abc1234')
    expect(text).toContain('Config version: 1')
    expect(text).toContain('9,000 YouTube units left today')
    expect(text).not.toMatch(/MOCK/)
  })

  it('says MOCK first in a mock run and "not decided" without a baseline', () => {
    const noBaseline = rows.map((r) => ({ ...r, baseline: null }))
    const text = renderReport(noBaseline, verdict(noBaseline), {
      ...META,
      mock: true,
      baselineModel: null,
      baselineAsked: null,
      baselineScored: null,
    })
    expect(text.startsWith('# MOCK')).toBe(true)
    expect(text).toContain('not decided: baseline not run')
  })

  it('a partial baseline is not decided and says how many cases it scored', () => {
    const partial = rows.map((r, i) => ({ ...r, baseline: i === 0 ? null : r.baseline }))
    const text = renderReport(partial, verdict(partial), { ...META, baselineScored: 5 })
    expect(text).toContain('**Verdict: not decided: baseline scored 5 of 6 cases.**')
    expect(text).toContain('- Baseline scored: 5 of 6 cases asked')
    expect(text).not.toContain('baseline not run')
    const one = [row(1)]
    const single = renderReport(one, verdict(one), {
      ...META,
      baselineAsked: 1,
      baselineScored: 1,
    })
    expect(single).toContain('not decided: baseline scored 1 of 1 case.')
  })

  it('counts the cases that had no lane at T', () => {
    const text = renderReport(rows, verdict(rows), META)
    expect(text).toContain(
      '- No lane at T: 2 of 6 cases, kept in their lane today and scored with the unranked',
    )
  })

  it('shows the run date and the date the outcomes were measured on', () => {
    const text = renderReport(rows, verdict(rows), META)
    expect(text).toContain('- Run date: 2026-10-21')
    expect(text).toContain('- Outcomes measured on: 2026-10-18')
  })

  it('flags a negative lane figure for the owner', () => {
    const v = { ...verdict(rows), perLane: { downfall: -0.2, success: 0.4 } }
    const text = renderReport(rows, v, META)
    expect(text).toContain(
      'The downfall figure is negative: raise this with the owner before reading the verdict.',
    )
    expect(text).not.toContain('The success figure is negative')
  })

  it('lists unusable cases with their error, and no dash from a title reaches the text', () => {
    const titled = [row(1, { title: 'Wirecard \u2013 the missing \u2014 billion | part 1' })]
    const text = renderReport(titled, verdict(titled), {
      ...META,
      unusable: [
        { videoId: 'vid9', title: 'Gone', error: 'No settled peer uploads for video vid9' },
      ],
    })
    expect(text).toContain('No settled peer uploads for video vid9')
    expect(text).toContain('Wirecard - the missing - billion \\| part 1')
    expect(text).not.toMatch(dashes)
  })
})
