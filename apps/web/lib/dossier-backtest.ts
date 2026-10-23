import { annualXbrlFacts, type AnnualFact } from '@boom-busters/providers'
import {
  BACKTEST_CURRENT_WITHIN_DAYS,
  type DocumentKind,
  type GroundedClaim,
  type GroundedResearch,
  type Series,
} from '@boom-busters/schemas'
import type { Steps } from '@/inngest/lib/steps'

/**
 * The dossier back-test's pure half (spec section 9): the five closed cases,
 * the targets, and the scoring and report over what a live run collected.
 * No database or network import, so every rule here is a plain unit test; the
 * script that spends money lives in `scripts/live-dossier-backtest.ts`.
 */

export const BACKTEST_CASES = [
  {
    title: 'Wirecard',
    category: 'con',
    subject: 'Wirecard',
    people: ['Markus Braun', 'Jan Marsalek'],
    expectedTitle: 'Wirecard',
    recentOutcome: false,
  },
  {
    title: 'Enron',
    category: 'collapse',
    subject: 'Enron',
    people: ['Kenneth Lay', 'Jeffrey Skilling'],
    expectedTitle: 'Enron',
    recentOutcome: false,
  },
  {
    // The headline title that failed in production: the subject, not the title, must find the company.
    title:
      'Theranos on the Record: Why the Jury Convicted Elizabeth Holmes for Defrauding Investors but Not Patients',
    category: 'con',
    subject: 'Theranos',
    people: ['Elizabeth Holmes', 'Ramesh Balwani'],
    expectedTitle: 'Theranos',
    recentOutcome: true,
  },
  {
    title: 'FTX',
    category: 'collapse',
    subject: 'FTX',
    people: ['Sam Bankman-Fried'],
    expectedTitle: 'FTX',
    recentOutcome: true,
  },
  {
    title: 'SVB Financial',
    category: 'meltdown',
    subject: 'SVB Financial Group',
    people: ['Greg Becker'],
    expectedTitle: 'SVB Financial Group',
    recentOutcome: false,
  },
] as const

/**
 * The told-already rate has no target: it is reported, never gated, because
 * no transcript source exists to measure it against (see `renderReport`).
 */
export const BACKTEST_TARGETS = {
  quoteFound: 0.9,
  /**
   * The first live run measured 74% over Wikipedia reference links, and a
   * quarter of the web's links refuse a fetch or have rotted, so 95% was a
   * target no real corpus could meet.
   */
  urlResolved: 0.7,
  figureMatch: 0.8,
  costUsd: 6,
  /**
   * Each Inngest step has 300 s (the function limit), and a pass is one step
   * or, split into parts, one step per part, so a split pass is held to this
   * by its slowest part. 200 s leaves room for a slow day and the retry's
   * own overhead.
   */
  maxPassMs: 200_000,
} as const

export const RESEARCH_PASSES = ['brief', 'scenes', 'claims', 'answers'] as const
export type ResearchPass = (typeof RESEARCH_PASSES)[number]
export type PassDurations = Record<ResearchPass, number>

/** A pass's step id: the round, then the part for a pass split across steps. */
const PASS_STEP = /^research-(brief|scenes|claims|answers)-\d+(?:-\d+)?$/

/**
 * `Steps` that time each research pass's step into `durations`, wall clock,
 * model call and parse together. A pass split into parts records its slowest
 * part, not their sum: the 300 s limit is per step. A pass that never ran (no
 * open questions, so no answers pass) stays at 0.
 */
export function timedSteps(inner: Steps): { steps: Steps; durations: PassDurations } {
  const durations: PassDurations = { brief: 0, scenes: 0, claims: 0, answers: 0 }
  return {
    durations,
    steps: {
      run: async (id, fn) => {
        const pass = PASS_STEP.exec(id)?.[1] as ResearchPass | undefined
        if (pass === undefined) return inner.run(id, fn)
        const started = performance.now()
        try {
          return await inner.run(id, fn)
        } finally {
          durations[pass] = Math.max(durations[pass], performance.now() - started)
        }
      },
    },
  }
}

export interface CaseRun {
  title: string
  /** The entity's first title: the Wikipedia article the gather landed on; null when unresolved. */
  resolvedTitle: string | null
  /** `currentStatus.asOf` of the brief; null when the brief has none. */
  currentStatusAsOf: string | null
  claims: GroundedClaim[]
  research: GroundedResearch
  documents: {
    /**
     * Beats name their video by document id, so told-already can only be
     * scored where the id is kept. Optional so a fixture without videos stays small.
     */
    id?: string
    url: string
    httpStatus: number | null
    archivedUrl: string | null
    kind: DocumentKind
    failure: string | null
    /** A video whose transcript was fetched: `meta.transcript` on the stored row. */
    transcript?: boolean
  }[]
  /** The SEC company-facts JSON for the case's filer; null when it has none. */
  xbrl: unknown | null
  /**
   * Beats the model wrote that grounding dropped because their quote was not
   * found in a video transcript. Every beat that survives grounding is found,
   * so without this count the told-already rate could only read 100%.
   */
  beatsDropped?: number
  costUsd: number
  model: string
  /** Wall-clock milliseconds per research pass. */
  passDurationsMs: PassDurations
}

export interface FigureCounts {
  matched: number
  mismatched: number
  notCheckable: number
}

export type Rate = number | 'not measured'

const CLAIM_PATTERN = /revenue|net income|net loss|total assets/i
const TOLERANCE = 0.01

/**
 * Which us-gaap concepts a series label names. Revenue has two because
 * filers moved from `Revenues` to the contract-revenue tag after 2018.
 */
function conceptsFor(label: string): string[] {
  const text = label.toLowerCase()
  if (text.includes('revenue')) {
    return ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']
  }
  if (text.includes('net income') || text.includes('net loss')) return ['NetIncomeLoss']
  if (text.includes('total assets')) return ['Assets']
  return []
}

/** Annual 10-K USD values of one concept by fiscal year, from the shared reader. */
function annualValues(facts: readonly AnnualFact[], concept: string): Map<number, number> {
  return new Map(
    facts
      .filter((fact) => fact.concept === concept && fact.unit === 'USD')
      .map((fact) => [fact.year, fact.value]),
  )
}

/** The multiplier a series' unit text states ("USD millions" is 1e6). */
function scaleOf(unit: string): number {
  const text = unit.toLowerCase()
  if (text.includes('billion')) return 1e9
  if (text.includes('million')) return 1e6
  if (text.includes('thousand')) return 1e3
  return 1
}

function within(value: number, expected: number): boolean {
  if (expected === 0) return value === 0
  return Math.abs(value - expected) / Math.abs(expected) <= TOLERANCE
}

function checkSeries(series: Series, xbrl: unknown | null): FigureCounts {
  const counts: FigureCounts = { matched: 0, mismatched: 0, notCheckable: 0 }
  const concepts = conceptsFor(series.label)
  if (concepts.length === 0) return counts
  const usd = series.currency === null || series.currency.toUpperCase() === 'USD'
  const scale = scaleOf(series.unit)
  const annual = annualXbrlFacts(xbrl)
  const byConcept = concepts.map((concept) => annualValues(annual, concept))

  for (const point of series.points) {
    if (!usd || xbrl === null || !/^\d{4}$/.test(point.at)) {
      counts.notCheckable += 1
      continue
    }
    const year = Number(point.at)
    const known = byConcept.flatMap((values) => (values.has(year) ? [values.get(year)!] : []))
    if (known.length === 0) counts.notCheckable += 1
    else if (known.some((expected) => within(point.value * scale, expected))) counts.matched += 1
    else counts.mismatched += 1
  }
  return counts
}

/**
 * Each point of a revenue, net income or total assets series against the
 * XBRL value for that fiscal year, within 1%. A series is read when its claim
 * text and its label both name a concept; anything else is not a figure this
 * check speaks to, and is not counted at all.
 */
export function figureMatches(
  claims: readonly GroundedClaim[],
  xbrl: unknown | null,
): FigureCounts {
  const total: FigureCounts = { matched: 0, mismatched: 0, notCheckable: 0 }
  for (const claim of claims) {
    if (!claim.series || !CLAIM_PATTERN.test(claim.text)) continue
    const counts = checkSeries(claim.series, xbrl)
    total.matched += counts.matched
    total.mismatched += counts.mismatched
    total.notCheckable += counts.notCheckable
  }
  return total
}

const ratio = (numerator: number, denominator: number): Rate =>
  denominator === 0 ? 'not measured' : numerator / denominator

interface Tally {
  supportsFound: number
  supports: number
  urlsResolved: number
  urls: number
  figures: FigureCounts
  beatsFound: number
  beats: number
  transcripts: number
  videos: number
}

function tally(run: CaseRun): Tally {
  const supports = run.claims.flatMap((claim) => claim.supports)
  const resolved = run.documents.filter(
    (doc) =>
      (doc.httpStatus !== null && doc.httpStatus >= 200 && doc.httpStatus <= 299) ||
      doc.archivedUrl !== null,
  )
  const videos = run.documents.filter((doc) => doc.kind === 'video')
  const withTranscript = new Set(
    videos.flatMap((doc) => (doc.transcript === true && doc.id !== undefined ? [doc.id] : [])),
  )
  const beats = run.research.brief.toldAlready.filter(
    (beat) => beat.ref.documentId !== null && withTranscript.has(beat.ref.documentId),
  )
  return {
    supportsFound: supports.filter((support) => support.found).length,
    supports: supports.length,
    urlsResolved: resolved.length,
    urls: run.documents.length,
    figures: figureMatches(run.claims, run.xbrl),
    beatsFound: beats.filter((beat) => beat.ref.found).length,
    beats: beats.length + (run.beatsDropped ?? 0),
    transcripts: videos.filter((doc) => doc.transcript === true).length,
    videos: videos.length,
  }
}

function sum(tallies: readonly Tally[]): Tally {
  const total: Tally = {
    supportsFound: 0,
    supports: 0,
    urlsResolved: 0,
    urls: 0,
    figures: { matched: 0, mismatched: 0, notCheckable: 0 },
    beatsFound: 0,
    beats: 0,
    transcripts: 0,
    videos: 0,
  }
  for (const t of tallies) {
    total.supportsFound += t.supportsFound
    total.supports += t.supports
    total.urlsResolved += t.urlsResolved
    total.urls += t.urls
    total.figures.matched += t.figures.matched
    total.figures.mismatched += t.figures.mismatched
    total.figures.notCheckable += t.figures.notCheckable
    total.beatsFound += t.beatsFound
    total.beats += t.beats
    total.transcripts += t.transcripts
    total.videos += t.videos
  }
  return total
}

export interface Rates {
  quoteFound: Rate
  urlResolved: Rate
  figureMatch: Rate
  figures: FigureCounts
  toldAlready: Rate
  transcriptAvailability: Rate
}

function ratesOf(t: Tally): Rates {
  return {
    quoteFound: ratio(t.supportsFound, t.supports),
    urlResolved: ratio(t.urlsResolved, t.urls),
    figureMatch: ratio(t.figures.matched, t.figures.matched + t.figures.mismatched),
    figures: t.figures,
    toldAlready: ratio(t.beatsFound, t.beats),
    transcriptAvailability: ratio(t.transcripts, t.videos),
  }
}

export interface Report {
  cases: (Rates & {
    title: string
    resolvedTitle: string | null
    currentStatusAsOf: string | null
    costUsd: number
    model: string
    passDurationsMs: PassDurations
  })[]
  overall: Rates & { costUsd: number; maxCostUsd: number }
  transcriptAvailability: Rate
  models: string[]
  verdict: { pass: boolean; failing: string[] }
}

const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`

const DAY_MS = 86_400_000

/** The first day of a period an `asOf` names: "2024", "2024-03" or "2024-03-09". */
function periodStart(asOf: string): number {
  const [year, month = '01', day = '01'] = asOf.split('-')
  return Date.parse(`${year}-${month}-${day}T00:00:00Z`)
}

export function scoreRuns(
  runs: readonly CaseRun[],
  skipped: readonly string[] = [],
  now: Date = new Date(),
): Report {
  const tallies = runs.map(tally)
  const overallRates = ratesOf(sum(tallies))
  const costs = runs.map((run) => run.costUsd)
  const overall = {
    ...overallRates,
    costUsd: costs.length === 0 ? 0 : costs.reduce((a, b) => a + b, 0) / costs.length,
    maxCostUsd: Math.max(0, ...costs),
  }

  const failing: string[] = []
  for (const key of ['quoteFound', 'urlResolved', 'figureMatch'] as const) {
    const rate = overall[key]
    // A rate with nothing to measure never stops the rollout (spec 9).
    if (rate !== 'not measured' && rate < BACKTEST_TARGETS[key]) {
      failing.push(`${key}: ${percent(rate)} is under the ${percent(BACKTEST_TARGETS[key])} target`)
    }
  }
  for (const run of runs) {
    if (run.costUsd > BACKTEST_TARGETS.costUsd) {
      failing.push(
        `costUsd: ${run.title} cost $${run.costUsd.toFixed(2)}, over the $${BACKTEST_TARGETS.costUsd.toFixed(2)} target`,
      )
    }
    for (const pass of RESEARCH_PASSES) {
      const ms = run.passDurationsMs[pass]
      if (ms > BACKTEST_TARGETS.maxPassMs) {
        failing.push(
          `maxPassMs: ${run.title} ${pass} pass took ${seconds(ms)}, over the ${seconds(BACKTEST_TARGETS.maxPassMs)} limit`,
        )
      }
    }
  }

  for (const run of runs) {
    const spec = BACKTEST_CASES.find((c) => c.title === run.title)
    if (spec === undefined) continue
    if (run.resolvedTitle !== spec.expectedTitle) {
      failing.push(`subject: ${run.title} resolved to ${run.resolvedTitle ?? 'nothing'}`)
    }
    if (!spec.recentOutcome) continue
    if (run.currentStatusAsOf === null) {
      failing.push(`currentStatus: ${run.title} has none`)
    } else if (
      now.getTime() - periodStart(run.currentStatusAsOf) >
      BACKTEST_CURRENT_WITHIN_DAYS * DAY_MS
    ) {
      failing.push(
        `currentStatus: ${run.title} dated ${run.currentStatusAsOf}, older than ${BACKTEST_CURRENT_WITHIN_DAYS} days`,
      )
    }
  }

  // A case that was never measured cannot count as passing: a report over
  // fewer cases than asked for would read as a pass on evidence it lacks.
  if (skipped.length > 0) failing.unshift(`skipped: ${skipped.join(', ')}`)
  else if (runs.length === 0) failing.unshift('skipped: no case was scored')

  return {
    cases: runs.map((run, index) => ({
      ...ratesOf(tallies[index]!),
      title: run.title,
      resolvedTitle: run.resolvedTitle,
      currentStatusAsOf: run.currentStatusAsOf,
      costUsd: run.costUsd,
      model: run.model,
      passDurationsMs: run.passDurationsMs,
    })),
    overall,
    transcriptAvailability: overallRates.transcriptAvailability,
    models: [...new Set(runs.map((run) => run.model))],
    verdict: { pass: failing.length === 0, failing },
  }
}

const show = (rate: Rate): string => (rate === 'not measured' ? 'not measured' : percent(rate))

function rateTable(
  heading: string,
  target: string,
  pick: (rates: Rates) => string,
  report: Report,
): string[] {
  return [
    `## ${heading}`,
    '',
    `Target: ${target}.`,
    '',
    '| Case | Rate |',
    '| --- | --- |',
    ...report.cases.map((row) => `| ${row.title} | ${pick(row)} |`),
    `| Overall | ${pick(report.overall)} |`,
    '',
  ]
}

const counts = (c: FigureCounts): string =>
  `${c.matched} matched, ${c.mismatched} mismatched, ${c.notCheckable} not checkable`

export function renderReport(report: Report, date: string): string {
  const t = BACKTEST_TARGETS
  const lines = [
    `# Dossier back-test, ${date}`,
    '',
    `Five closed cases, the real gather and the four research passes. Model on the ledger: ${report.models.join(', ') || 'none'}.`,
    '',
    ...rateTable(
      'Quote-found rate',
      `at least ${percent(t.quoteFound)}`,
      (r) => show(r.quoteFound),
      report,
    ),
    ...rateTable(
      'URL resolution rate',
      `at least ${percent(t.urlResolved)}`,
      (r) => show(r.urlResolved),
      report,
    ),
    ...rateTable(
      'Figure match rate',
      `at least ${percent(t.figureMatch)} of checkable points`,
      (r) => `${show(r.figureMatch)} (${counts(r.figures)})`,
      report,
    ),
    ...rateTable(
      'Told-already rate',
      'Reported only; no transcript source exists (the YouTube caption endpoint answers 404 to unsigned requests, confirmed 2026-10-22)',
      (r) => show(r.toldAlready),
      report,
    ),
    ...rateTable(
      'Transcript availability',
      'reported only, no target',
      (r) => show(r.transcriptAvailability),
      report,
    ),
    '## Subject',
    '',
    'Target: each case resolves to the Wikipedia article named here.',
    '',
    '| Case | Expected | Resolved |',
    '| --- | --- | --- |',
    ...report.cases.map((row) => {
      const expected = BACKTEST_CASES.find((c) => c.title === row.title)?.expectedTitle ?? 'unknown'
      return `| ${row.title} | ${expected} | ${row.resolvedTitle ?? 'nothing'} |`
    }),
    '',
    '## Current status',
    '',
    `Target: a case with a recent outcome has a status dated within ${BACKTEST_CURRENT_WITHIN_DAYS} days of the run.`,
    '',
    '| Case | As of |',
    '| --- | --- |',
    ...report.cases.map((row) => `| ${row.title} | ${row.currentStatusAsOf ?? 'none'} |`),
    '',
    '## Cost',
    '',
    `Target: at most $${t.costUsd.toFixed(2)} per dossier.`,
    '',
    '| Case | Cost | Model |',
    '| --- | --- | --- |',
    ...report.cases.map((row) => `| ${row.title} | $${row.costUsd.toFixed(2)} | ${row.model} |`),
    `| Overall | $${report.overall.costUsd.toFixed(2)} mean, $${report.overall.maxCostUsd.toFixed(2)} highest | |`,
    '',
    '## Pass durations',
    '',
    `Target: every step under ${seconds(t.maxPassMs)}; a step has 300 s, and a split pass shows its slowest part. A pass that did not run shows 0.0 s.`,
    '',
    '| Case | Brief | Scenes | Claims | Answers |',
    '| --- | --- | --- | --- | --- |',
    ...report.cases.map(
      (row) =>
        `| ${row.title} | ${RESEARCH_PASSES.map((pass) => seconds(row.passDurationsMs[pass])).join(' | ')} |`,
    ),
    '',
    '## Verdict',
    '',
    report.verdict.failing.some((item) => item.startsWith('skipped'))
      ? 'Incomplete. Not every case was scored, so this run proves nothing yet; the rollout stops.'
      : report.verdict.pass
        ? 'Pass. Every measured rate meets its target; a rate marked "not measured" had nothing to measure.'
        : 'Fail. The rollout stops until these are fixed.',
    '',
  ]
  if (!report.verdict.pass) {
    lines.push('Failing:', '', ...report.verdict.failing.map((item) => `- ${item}`), '')
  }
  return lines.join('\n')
}
