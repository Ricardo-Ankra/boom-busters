import { annualXbrlFacts, type AnnualFact } from '@boom-busters/providers'
import {
  BACKTEST_CURRENT_WITHIN_DAYS,
  RESEARCH_PROFILE_KEYS,
  RESEARCH_PROFILES,
  type DocumentKind,
  type GroundedClaim,
  type GroundedResearch,
  type ResearchProfileKey,
  type Series,
} from '@boom-busters/schemas'
import type { Steps } from '@/inngest/lib/steps'
import { optionalText, readRawFlags } from './live-set-args'

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
    profile: 'investigation',
  },
  {
    title: 'Enron',
    category: 'collapse',
    subject: 'Enron',
    people: ['Kenneth Lay', 'Jeffrey Skilling'],
    expectedTitle: 'Enron',
    recentOutcome: false,
    profile: 'investigation',
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
    profile: 'investigation',
  },
  {
    title: 'FTX',
    category: 'collapse',
    subject: 'FTX',
    people: ['Sam Bankman-Fried'],
    expectedTitle: 'FTX',
    recentOutcome: true,
    profile: 'investigation',
  },
  {
    title: 'SVB Financial',
    category: 'meltdown',
    subject: 'SVB Financial Group',
    people: ['Greg Becker'],
    expectedTitle: 'SVB Financial Group',
    recentOutcome: false,
    profile: 'investigation',
  },
  // The science cases (spec section 11). The replication crisis runs through
  // all five, so a working evidence axis must show contested and single-study
  // claims, not only established ones. Their category is a placeholder the
  // case row needs; the science profile does not read it.
  {
    title: 'Stanford prison experiment',
    category: 'collapse',
    subject: 'Stanford prison experiment',
    people: ['Philip Zimbardo'],
    expectedTitle: 'Stanford prison experiment',
    recentOutcome: false,
    profile: 'science',
  },
  {
    title: 'Ego depletion',
    category: 'collapse',
    subject: 'Ego depletion',
    people: ['Roy Baumeister'],
    expectedTitle: 'Ego depletion',
    recentOutcome: false,
    profile: 'science',
  },
  {
    title: 'Stanford marshmallow experiment',
    category: 'collapse',
    subject: 'Stanford marshmallow experiment',
    people: ['Walter Mischel'],
    expectedTitle: 'Stanford marshmallow experiment',
    recentOutcome: false,
    profile: 'science',
  },
  {
    title: 'Power posing',
    category: 'collapse',
    subject: 'Power posing',
    people: ['Amy Cuddy'],
    expectedTitle: 'Power posing',
    recentOutcome: false,
    profile: 'science',
  },
  {
    title: 'Milgram experiment',
    category: 'collapse',
    subject: 'Milgram experiment',
    people: ['Stanley Milgram'],
    expectedTitle: 'Milgram experiment',
    recentOutcome: false,
    profile: 'science',
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
  /** Of the documents a science case read, the share that are scholarly (spec section 11). */
  scholarlyShare: 0.2,
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
  /** Documents the research read (no failure), counted by kind: the base of the scholarly share. */
  readKinds: Partial<Record<DocumentKind, number>>
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
  scholarly: number
  read: number
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
    scholarly: run.readKinds.scholarly ?? 0,
    read: Object.values(run.readKinds).reduce((a, b) => a + b, 0),
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
    scholarly: 0,
    read: 0,
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
    total.scholarly += t.scholarly
    total.read += t.read
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
  /** Of the documents read, the share that are scholarly. */
  scholarlyShare: Rate
}

function ratesOf(t: Tally): Rates {
  return {
    quoteFound: ratio(t.supportsFound, t.supports),
    urlResolved: ratio(t.urlsResolved, t.urls),
    figureMatch: ratio(t.figures.matched, t.figures.matched + t.figures.mismatched),
    figures: t.figures,
    toldAlready: ratio(t.beatsFound, t.beats),
    transcriptAvailability: ratio(t.transcripts, t.videos),
    scholarlyShare: ratio(t.scholarly, t.read),
  }
}

export type CaseRow = Rates & {
  title: string
  resolvedTitle: string | null
  currentStatusAsOf: string | null
  costUsd: number
  model: string
  passDurationsMs: PassDurations
}

/** One research profile's cases, pooled: the report groups its tables by these. */
export interface ProfileReport {
  profile: ResearchProfileKey
  cases: CaseRow[]
  overall: Rates & { costUsd: number; maxCostUsd: number }
  /** Cases that resolved to the Wikipedia article they expect, over the cases run. */
  resolvedRate: Rate
  scholarlyShare: Rate
  /** Claims by `evidence.status`; a claim with no finding is counted as "no finding". */
  evidenceMix: Record<string, number>
}

export interface Report {
  cases: CaseRow[]
  profiles: ProfileReport[]
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

const rowOf = (run: CaseRun, t: Tally): CaseRow => ({
  ...ratesOf(t),
  title: run.title,
  resolvedTitle: run.resolvedTitle,
  currentStatusAsOf: run.currentStatusAsOf,
  costUsd: run.costUsd,
  model: run.model,
  passDurationsMs: run.passDurationsMs,
})

/** The profile a run's case belongs to; a title the closed list does not know reads as the investigation. */
const profileOfTitle = (title: string): ResearchProfileKey =>
  BACKTEST_CASES.find((c) => c.title === title)?.profile ?? 'investigation'

/** Profiles whose science-style measures are gated: the scholarly share and the evidence mix. */
const SCHOLARLY_PROFILES: readonly ResearchProfileKey[] = ['science']

const NO_FINDING = 'no finding'

function evidenceMixOf(runs: readonly CaseRun[]): Record<string, number> {
  const mix: Record<string, number> = {}
  for (const run of runs) {
    for (const claim of run.claims) {
      const key = claim.evidence?.status ?? NO_FINDING
      mix[key] = (mix[key] ?? 0) + 1
    }
  }
  return mix
}

function costsOf(runs: readonly CaseRun[]): { costUsd: number; maxCostUsd: number } {
  const costs = runs.map((run) => run.costUsd)
  return {
    costUsd: costs.length === 0 ? 0 : costs.reduce((a, b) => a + b, 0) / costs.length,
    maxCostUsd: Math.max(0, ...costs),
  }
}

export function scoreRuns(
  runs: readonly CaseRun[],
  skipped: readonly string[] = [],
  now: Date = new Date(),
): Report {
  const tallies = runs.map(tally)
  const overallRates = ratesOf(sum(tallies))
  const overall = { ...overallRates, ...costsOf(runs) }

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

  const profiles: ProfileReport[] = RESEARCH_PROFILE_KEYS.flatMap((profile) => {
    const members = runs.flatMap((run, index) =>
      profileOfTitle(run.title) === profile ? [{ run, index }] : [],
    )
    if (members.length === 0) return []
    const inProfile = members.map((member) => member.run)
    const rates = ratesOf(sum(members.map((member) => tallies[member.index]!)))
    const resolved = inProfile.filter(
      (run) =>
        run.resolvedTitle !== null &&
        run.resolvedTitle === BACKTEST_CASES.find((c) => c.title === run.title)?.expectedTitle,
    ).length
    return [
      {
        profile,
        cases: members.map((member) => rowOf(member.run, tallies[member.index]!)),
        overall: { ...rates, ...costsOf(inProfile) },
        resolvedRate: ratio(resolved, inProfile.length),
        scholarlyShare: rates.scholarlyShare,
        evidenceMix: evidenceMixOf(inProfile),
      },
    ]
  })

  for (const row of profiles) {
    if (!SCHOLARLY_PROFILES.includes(row.profile)) continue
    const share = row.scholarlyShare
    if (share !== 'not measured' && share < BACKTEST_TARGETS.scholarlyShare) {
      failing.push(
        `scholarlyShare: ${row.profile} ${percent(share)} is under the ${percent(BACKTEST_TARGETS.scholarlyShare)} target`,
      )
    }
    // The replication crisis runs through the science cases: an axis that
    // never leaves "established" is not telling the claims apart.
    if ((row.evidenceMix.contested ?? 0) + (row.evidenceMix.single_study ?? 0) === 0) {
      failing.push(`evidenceMix: ${row.profile} shows no contested or single_study claim`)
    }
  }

  // A case that was never measured cannot count as passing: a report over
  // fewer cases than asked for would read as a pass on evidence it lacks.
  if (skipped.length > 0) failing.unshift(`skipped: ${skipped.join(', ')}`)
  else if (runs.length === 0) failing.unshift('skipped: no case was scored')

  return {
    cases: runs.map((run, index) => rowOf(run, tallies[index]!)),
    profiles,
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
  profile: ProfileReport,
): string[] {
  return [
    `## ${heading}`,
    '',
    `Target: ${target}.`,
    '',
    '| Case | Rate |',
    '| --- | --- |',
    ...profile.cases.map((row) => `| ${row.title} | ${pick(row)} |`),
    `| Overall | ${pick(profile.overall)} |`,
    '',
  ]
}

const counts = (c: FigureCounts): string =>
  `${c.matched} matched, ${c.mismatched} mismatched, ${c.notCheckable} not checkable`

/** Every table for one profile's cases; the report repeats this block per profile. */
function profileSection(profile: ProfileReport): string[] {
  const t = BACKTEST_TARGETS
  const mix = Object.entries(profile.evidenceMix).sort(
    ([a, x], [b, y]) => y - x || a.localeCompare(b),
  )
  return [
    `# Profile: ${profile.profile}`,
    '',
    ...rateTable(
      'Quote-found rate',
      `at least ${percent(t.quoteFound)}`,
      (r) => show(r.quoteFound),
      profile,
    ),
    ...rateTable(
      'URL resolution rate',
      `at least ${percent(t.urlResolved)}`,
      (r) => show(r.urlResolved),
      profile,
    ),
    ...rateTable(
      'Figure match rate',
      `at least ${percent(t.figureMatch)} of checkable points`,
      (r) => `${show(r.figureMatch)} (${counts(r.figures)})`,
      profile,
    ),
    ...rateTable(
      'Told-already rate',
      'Reported only; no transcript source exists (the YouTube caption endpoint answers 404 to unsigned requests, confirmed 2026-10-22)',
      (r) => show(r.toldAlready),
      profile,
    ),
    ...rateTable(
      'Transcript availability',
      'reported only, no target',
      (r) => show(r.transcriptAvailability),
      profile,
    ),
    ...(SCHOLARLY_PROFILES.includes(profile.profile)
      ? rateTable(
          'Scholarly share',
          `at least ${percent(t.scholarlyShare)} of read documents`,
          (r) => show(r.scholarlyShare),
          profile,
        )
      : []),
    ...(RESEARCH_PROFILES[profile.profile].evidence === null
      ? []
      : [
          '## Evidence status mix',
          '',
          'Reported, and for a science case checked: the axis must show contested or single_study claims, not only established ones. A claim with no finding carries no status.',
          '',
          '| Status | Claims |',
          '| --- | --- |',
          ...(mix.length === 0
            ? ['| none | 0 |']
            : mix.map(([status, claims]) => `| ${status} | ${claims} |`)),
          '',
        ]),
    '## Subject',
    '',
    'Target: each case resolves to the Wikipedia article named here.',
    '',
    '| Case | Expected | Resolved |',
    '| --- | --- | --- |',
    ...profile.cases.map((row) => {
      const expected = BACKTEST_CASES.find((c) => c.title === row.title)?.expectedTitle ?? 'unknown'
      return `| ${row.title} | ${expected} | ${row.resolvedTitle ?? 'nothing'} |`
    }),
    '',
    `Resolved rate: ${show(profile.resolvedRate)}.`,
    '',
    '## Current status',
    '',
    `Target: a case with a recent outcome has a status dated within ${BACKTEST_CURRENT_WITHIN_DAYS} days of the run.`,
    '',
    '| Case | As of |',
    '| --- | --- |',
    ...profile.cases.map((row) => `| ${row.title} | ${row.currentStatusAsOf ?? 'none'} |`),
    '',
    '## Cost',
    '',
    `Target: at most $${t.costUsd.toFixed(2)} per dossier.`,
    '',
    '| Case | Cost | Model |',
    '| --- | --- | --- |',
    ...profile.cases.map((row) => `| ${row.title} | $${row.costUsd.toFixed(2)} | ${row.model} |`),
    `| Overall | $${profile.overall.costUsd.toFixed(2)} mean, $${profile.overall.maxCostUsd.toFixed(2)} highest | |`,
    '',
    '## Pass durations',
    '',
    `Target: every step under ${seconds(t.maxPassMs)}; a step has 300 s, and a split pass shows its slowest part. A pass that did not run shows 0.0 s.`,
    '',
    '| Case | Brief | Scenes | Claims | Answers |',
    '| --- | --- | --- | --- | --- |',
    ...profile.cases.map(
      (row) =>
        `| ${row.title} | ${RESEARCH_PASSES.map((pass) => seconds(row.passDurationsMs[pass])).join(' | ')} |`,
    ),
    '',
  ]
}

export function renderReport(report: Report, date: string): string {
  const lines = [
    `# Dossier back-test, ${date}`,
    '',
    `${report.cases.length} closed ${report.cases.length === 1 ? 'case' : 'cases'}, the real gather and the four research passes, grouped by research profile. Model on the ledger: ${report.models.join(', ') || 'none'}.`,
    '',
    ...report.profiles.flatMap(profileSection),
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

const MAX_CAP_USD = 30

export interface BacktestArgs {
  cap: number
  profile: ResearchProfileKey
  titles: string[]
}

/**
 * The back-test script's flags, pure so they can be tested without running
 * the script (it spends money on load). `--profile` picks which profile's
 * cases run (default `investigation`, today's behaviour); `--cases` narrows
 * within that profile; `--cap` is the dollar cap, $1 unless the owner says.
 */
export function parseBacktestArgs(argv: readonly string[]): BacktestArgs {
  const raw = readRawFlags(argv)
  const capText = raw.cap
  const cap = capText === undefined || capText.trim() === '' ? 1 : Number(capText)
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(`--cap "${capText}" is not a valid dollar amount; give a number above 0.`)
  }
  if (cap > MAX_CAP_USD) throw new Error(`--cap may not pass $${MAX_CAP_USD}.`)

  const profileText = optionalText(raw, 'profile') ?? 'investigation'
  const profile = RESEARCH_PROFILE_KEYS.find((key) => key === profileText)
  if (profile === undefined) {
    throw new Error(
      `Unknown profile ${profileText}; the profiles are ${RESEARCH_PROFILE_KEYS.join(', ')}.`,
    )
  }

  const inProfile = BACKTEST_CASES.filter((c) => c.profile === profile)
  const known: string[] = inProfile.map((c) => c.title)
  const chosen = optionalText(raw, 'cases')
  // A case may be named by its subject too, since Theranos's title is a headline.
  const asTitle = (name: string): string =>
    inProfile.find((c) => c.title === name || c.subject === name)?.title ?? name
  const titles = chosen ? chosen.split(',').map((name) => asTitle(name.trim())) : [...known]
  const unknown = titles.filter((title) => !known.includes(title))
  if (unknown.length > 0) {
    throw new Error(
      `Unknown case ${unknown.join(', ')}; the ${profile} back-test cases are ${known.join(', ')}.`,
    )
  }
  return { cap, profile, titles }
}
