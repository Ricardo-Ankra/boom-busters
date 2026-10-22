import { annualXbrlFacts, type AnnualFact } from '@boom-busters/providers'
import type { DocumentKind, GroundedClaim, GroundedResearch, Series } from '@boom-busters/schemas'

/**
 * The dossier back-test's pure half (spec section 9): the five closed cases,
 * the targets, and the scoring and report over what a live run collected.
 * No database or network import, so every rule here is a plain unit test; the
 * script that spends money lives in `scripts/live-dossier-backtest.ts`.
 */

export const BACKTEST_CASES = [
  { title: 'Wirecard', category: 'con' },
  { title: 'Enron', category: 'collapse' },
  { title: 'Theranos', category: 'con' },
  { title: 'FTX', category: 'collapse' },
  { title: 'SVB Financial', category: 'meltdown' },
] as const

export const BACKTEST_TARGETS = {
  quoteFound: 0.9,
  urlResolved: 0.95,
  figureMatch: 0.8,
  toldAlready: 0.9,
  costUsd: 6,
} as const

export interface CaseRun {
  title: string
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
  costUsd: number
  model: string
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
    beats: beats.length,
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
  cases: (Rates & { title: string; costUsd: number; model: string })[]
  overall: Rates & { costUsd: number; maxCostUsd: number }
  transcriptAvailability: Rate
  models: string[]
  verdict: { pass: boolean; failing: string[] }
}

const percent = (rate: number): string => `${(rate * 100).toFixed(1)}%`

export function scoreRuns(runs: readonly CaseRun[], skipped: readonly string[] = []): Report {
  const tallies = runs.map(tally)
  const overallRates = ratesOf(sum(tallies))
  const costs = runs.map((run) => run.costUsd)
  const overall = {
    ...overallRates,
    costUsd: costs.length === 0 ? 0 : costs.reduce((a, b) => a + b, 0) / costs.length,
    maxCostUsd: Math.max(0, ...costs),
  }

  const failing: string[] = []
  for (const key of ['quoteFound', 'urlResolved', 'figureMatch', 'toldAlready'] as const) {
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
  }

  // A case that was never measured cannot count as passing: a report over
  // fewer cases than asked for would read as a pass on evidence it lacks.
  if (skipped.length > 0) failing.unshift(`skipped: ${skipped.join(', ')}`)
  else if (runs.length === 0) failing.unshift('skipped: no case was scored')

  return {
    cases: runs.map((run, index) => ({
      ...ratesOf(tallies[index]!),
      title: run.title,
      costUsd: run.costUsd,
      model: run.model,
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
      `at least ${percent(t.toldAlready)} over videos with a transcript`,
      (r) => show(r.toldAlready),
      report,
    ),
    ...rateTable(
      'Transcript availability',
      'reported only, no target',
      (r) => show(r.transcriptAvailability),
      report,
    ),
    '## Cost',
    '',
    `Target: at most $${t.costUsd.toFixed(2)} per dossier.`,
    '',
    '| Case | Cost | Model |',
    '| --- | --- | --- |',
    ...report.cases.map((row) => `| ${row.title} | $${row.costUsd.toFixed(2)} | ${row.model} |`),
    `| Overall | $${report.overall.costUsd.toFixed(2)} mean, $${report.overall.maxCostUsd.toFixed(2)} highest | |`,
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
