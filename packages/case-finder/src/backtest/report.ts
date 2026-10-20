import { BACKTEST } from '../config'
import type { Scored } from '../score/rank'
import { bootstrapInterval, median, spearman } from '../stats'
import type { IsoDate, Lane } from '../types'

/**
 * The back-test's statistics and its markdown report. Every figure is a
 * function of the case rows alone, so the report can be rebuilt from the
 * `-cases.json` the run writes beside it.
 */

export type CaseStatus =
  'ranked' | 'miss' | 'below floor' | 'outside top 250' | 'paper trail none' | 'no lane'

export interface CaseRow {
  videoId: string
  channel: string
  title: string
  T: IsoDate
  lane: Lane
  qid: string | null
  status: CaseStatus
  /** Present when the subject was scored (ranked, or killed for no paper trail). */
  pct: Scored['pct'] | null
  score: number
  legalKillWouldApply: boolean
  /** The baseline model's 0 to 100 score; null when not run or not answered for this case. */
  baseline: number | null
  outcome: number
  /** The subject's raw spike ratio at T; null when it was not measured (outside the population). */
  spike: number | null
}

export interface Verdict {
  rhoRubric: number
  rhoBaseline: number
  ciRubric: [number, number]
  ciBaseline: [number, number]
  ciDifference: [number, number]
  pass: boolean
  perLane: Record<Lane, number>
  withoutLegalKills: number
  missRate: number
  spikeVsOutcome: { spiking: number; aboveMedian: number }
}

export interface ReportMeta {
  mock: boolean
  configVersion: number
  commit: string
  baselineModel: string | null
  /** Cases the baseline was asked to score; null when it was not run. */
  baselineAsked: number | null
  /** Of those, how many got a usable score; null when it was not run. */
  baselineScored: number | null
  runDate: IsoDate
  /** The day the channel uploads were fetched: outcomes are views as of then. */
  outcomeMeasuredOn: IsoDate
  quotaNote: string
  /** Hitlist entries by laneOf over all their tags; `none` has no lane at all. */
  hitlistByLane: Record<Lane | 'none', number>
  unresolvedSeedNames: number
  selectionNote: string
  /** Cases whose subject had no lane at T, kept in their lane today (spec 9.5). */
  noLaneAtT: number
  /** Cases dropped because their outcome could not be measured. */
  unusable: { videoId: string; title: string; error: string }[]
}

/** The plan's "Decisions this plan makes", one line each, fixed before the back-test. */
export const PLAN_DECISIONS: readonly string[] = [
  'Paper-trail levels, by distinct primary documents dated before T: none 0, thin 1 to 2, enough 3 to 9, strong 10 or more.',
  'Primary reference domains (Wikipedia external links that count as primary): hosts ending in .gov, .gov.uk, .gov.za, .gov.au, .gc.ca, .gov.in, .go.jp, .gouv.fr, .bund.de, .europa.eu; and the hosts sec.gov, justice.gov, courtlistener.com, supremecourt.gov, judiciary.uk, bailii.org, saflii.org, austlii.edu.au, canlii.org, parliament.uk, aph.gov.au, parliament.gov.za, fca.org.uk, bafin.de, finra.org, jse.co.za, asic.gov.au, sfc.hk, mas.gov.sg, sebi.gov.in, cvm.gov.br, amf-france.org, consob.it, fsca.co.za, cftc.gov, ftc.gov, fdic.gov, federalreserve.gov, oig.* (any host whose first label is oig). Subdomains of a listed host count.',
  'Fortune climb rule (success-lane seed): a company whose best Fortune 500 rank improved by at least 200 places within any 10 consecutive list years, or whose first appearance was after 1970 and who later reached the top 100.',
  "EDGAR forms counted: success lane 10-K, 20-F, 40-F, S-1, F-1, 424B4; downfall lane NT 10-K, NT 20-F, 10-K/A, and 8-K whose items include 4.02. The company's CIK comes from Wikidata P5531.",
  "Revision dates are quantised to the first day of T's month (the last revision before that day). Still strictly before T, and it lets 40 test dates share about 30 cached revision sets.",
  "Pageviews include redirects: an entry's views are the sum over its title and every redirect to it, so a renamed article keeps its history.",
  "Query rule: an entry's YouTube and title-match query is its English title with any trailing parenthetical removed (Enron (company) gives Enron); a video counts only if the query appears in its title as a whole word, case-insensitive.",
  'Companies House and GDELT are deferred to the later plans: the back-test uses neither (GDELT only feeds the daily scan; Companies House is optional per the spec).',
  'Keys for this plan come from env, read by the CLI from .env.local: YOUTUBE_DATA_API_KEY, COURTLISTENER_TOKEN, DATA_CONTACT_EMAIL. Settings → Connections entries move to the Case Library plan, where the app first needs them.',
  "Raw cache lives in .cache/case-finder/ at the repo root (gitignored). The run's hitlist snapshot and per-case table go in the report folder docs/case-finder/; the hand-checked subject mapping is a committed fixture.",
]

export const CAVEAT_YOUTUBE =
  "YouTube view counts are today's, not as of each test date, so the competition measure is partly hindsight."
export const CAVEAT_BASELINE =
  'The baseline model already knows which of these cases became hits, which gives it an unfair advantage.'
/** Ruling R2: evidence gathering reads one page of each channel's uploads. */
export const CAVEAT_CHANNEL_MEDIANS =
  "The competition measure's channel medians use each channel's latest 50 uploads, not the six months either side of the video that the design describes, because full channel histories do not fit the YouTube quota."
/** Every other known hindsight in the evidence: today's redirects, editions, titles and people facts. */
export const CAVEATS_HINDSIGHT: readonly string[] = [
  "Pageviews include each article's current redirects, and world interest uses each company's current language editions.",
  'Each company is searched under its current English title, so a company renamed after a test date is searched under its later name.',
  "Founders' and executives' living status and convictions are read from Wikidata as they stand today.",
]

const LANES: readonly Lane[] = ['downfall', 'success']

/**
 * The pre-registered pass rule (spec 9.4), on point estimates. No baseline, no
 * pass; `verdict` also needs a baseline score for every case before it applies it.
 */
export function passes(rhoRubric: number, rhoBaseline: number): boolean {
  return !Number.isNaN(rhoBaseline) && rhoRubric > rhoBaseline && rhoRubric >= BACKTEST.passRho
}

/**
 * The rubric's score for each row, for correlation. A case the rubric could
 * not rank (a miss, below the floor, outside the top 250, killed for no paper
 * trail, no lane) sits one point below the lowest ranked case: the rubric
 * would not have recommended it, and the spec counts that against it.
 */
export function scoreForCorrelation(rows: CaseRow[]): number[] {
  const ranked = rows.filter((r) => r.status === 'ranked').map((r) => r.score)
  const floor = ranked.length === 0 ? 0 : Math.min(...ranked) - 1
  return rows.map((r) => (r.status === 'ranked' ? r.score : floor))
}

const NO_INTERVAL: [number, number] = [Number.NaN, Number.NaN]

/** Spearman over the rows at `indices`, NaN with fewer than two. */
function rhoAt(indices: number[], x: number[], y: number[]): number {
  if (indices.length < 2) return Number.NaN
  return spearman(
    indices.map((i) => x[i]!),
    indices.map((i) => y[i]!),
  )
}

/**
 * A percentile bootstrap over row indices, so the same seeded resampling
 * serves a plain correlation and the paired difference of two.
 */
function intervalOver(indices: number[], stat: (sample: number[]) => number): [number, number] {
  if (indices.length < 2) return NO_INTERVAL
  return bootstrapInterval(
    indices.map((i) => [i, i] as [number, number]),
    (pairs) => stat(pairs.map(([i]) => i)),
    BACKTEST.bootstrap,
    BACKTEST.intervalLevel,
    BACKTEST.seed,
  )
}

const indicesWhere = (rows: CaseRow[], keep: (r: CaseRow) => boolean) =>
  rows.flatMap((r, i) => (keep(r) ? [i] : []))

export function verdict(rows: CaseRow[]): Verdict {
  const rubric = scoreForCorrelation(rows)
  const outcome = rows.map((r) => r.outcome)
  const baseline = rows.map((r) => r.baseline ?? Number.NaN)
  const all = rows.map((_, i) => i)
  const withBaseline = indicesWhere(rows, (r) => r.baseline !== null)

  const rhoRubric = rhoAt(all, rubric, outcome)
  const rhoBaseline = rhoAt(withBaseline, baseline, outcome)
  const middle = median(outcome)
  const spiking = rows.filter((r) => r.spike !== null && r.spike >= 3)

  return {
    rhoRubric,
    rhoBaseline,
    ciRubric: intervalOver(all, (s) => rhoAt(s, rubric, outcome)),
    ciBaseline: intervalOver(withBaseline, (s) => rhoAt(s, baseline, outcome)),
    // Paired: each resample keeps a case's rubric score, baseline score and outcome together.
    ciDifference: intervalOver(
      withBaseline,
      (s) => rhoAt(s, rubric, outcome) - rhoAt(s, baseline, outcome),
    ),
    // A partial baseline would compare the rubric over all cases with the baseline over some.
    pass: withBaseline.length === rows.length && passes(rhoRubric, rhoBaseline),
    perLane: Object.fromEntries(
      LANES.map((lane) => [
        lane,
        rhoAt(
          indicesWhere(rows, (r) => r.lane === lane),
          rubric,
          outcome,
        ),
      ]),
    ) as Record<Lane, number>,
    withoutLegalKills: rhoAt(
      indicesWhere(rows, (r) => !r.legalKillWouldApply),
      rubric,
      outcome,
    ),
    missRate:
      rows.length === 0 ? Number.NaN : rows.filter((r) => r.status === 'miss').length / rows.length,
    spikeVsOutcome: {
      spiking: spiking.length,
      aboveMedian: spiking.filter((r) => r.outcome > middle).length,
    },
  }
}

const fixed = (x: number, digits = 3) => (Number.isFinite(x) ? x.toFixed(digits) : 'n/a')
const interval = ([lo, hi]: [number, number]) =>
  Number.isFinite(lo) && Number.isFinite(hi) ? `${fixed(lo)} to ${fixed(hi)}` : 'n/a'
const count = (n: number) => n.toLocaleString('en-US')
const cases = (n: number) => `${n} ${n === 1 ? 'case' : 'cases'}`
const percent = (x: number) => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : 'n/a')

/** A table cell: one line, pipes escaped. */
const cell = (text: string) => text.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim()

/** House rule for owner-facing prose: no em or en dashes, whatever a title or error carried. */
const plain = (text: string) => text.replace(/[\u2013\u2014]/g, '-')

function verdictLines(v: Verdict, meta: ReportMeta): string[] {
  const level = `${Math.round(BACKTEST.intervalLevel * 100)}%`
  const { baselineAsked: asked, baselineScored: scored, baselineModel } = meta
  const ran = asked !== null && scored !== null
  const complete = ran && scored === asked && scored >= 2
  let headline: string
  if (!ran) headline = '**Verdict: not decided: baseline not run.**'
  else if (!complete) {
    headline = `**Verdict: not decided: baseline scored ${scored} of ${cases(asked)}.**`
  } else if (v.pass) {
    headline =
      `**Verdict: pass.** The rubric's correlation beats the baseline's and reaches ` +
      `${BACKTEST.passRho.toFixed(2)}.`
  } else {
    headline =
      `**Verdict: fail.** A pass needs the rubric's correlation above the baseline's and at ` +
      `least ${BACKTEST.passRho.toFixed(2)}.`
  }
  return [
    '## Verdict',
    '',
    headline,
    '',
    `- Rubric Spearman: ${fixed(v.rhoRubric)} (${level} interval ${interval(v.ciRubric)})`,
    ...(ran ? [`- Baseline scored: ${scored} of ${cases(asked)} asked`] : []),
    ran
      ? `- Baseline Spearman: ${fixed(v.rhoBaseline)} (${level} interval ${interval(v.ciBaseline)})` +
        (baselineModel === null ? '' : `, model ${baselineModel}`)
      : '- Baseline Spearman: not run',
    `- Rubric minus baseline, paired ${level} interval: ${interval(v.ciDifference)}`,
  ]
}

function caseTable(rows: CaseRow[]): string[] {
  const header =
    '| Video | Channel | Title | T | Lane | QID | Status | D | G | S | W | Score | Legal kill | Baseline | Outcome | Spike |'
  const rule = `|${' --- |'.repeat(16)}`
  const lines = rows.map((r) => {
    const pct = r.pct
    const cells = [
      r.videoId,
      r.channel,
      r.title,
      r.T,
      r.lane,
      r.qid ?? '',
      r.status,
      pct ? pct.D.toFixed(0) : '',
      pct ? pct.G.toFixed(0) : '',
      pct ? pct.S.toFixed(0) : '',
      pct ? pct.W.toFixed(0) : '',
      pct ? r.score.toFixed(1) : '',
      r.legalKillWouldApply ? 'yes' : 'no',
      r.baseline === null ? '' : String(r.baseline),
      fixed(r.outcome, 2),
      r.spike === null ? '' : fixed(r.spike, 2),
    ]
    return `| ${cells.map(cell).join(' | ')} |`
  })
  return [header, rule, ...lines]
}

export function renderReport(rows: CaseRow[], v: Verdict, meta: ReportMeta): string {
  const legalKills = rows.filter((r) => r.legalKillWouldApply).length
  const misses = rows.filter((r) => r.status === 'miss').length
  const lanes = meta.hitlistByLane
  const out = [
    meta.mock
      ? `# MOCK: case-finder back-test, ${meta.runDate}`
      : `# Case-finder back-test, ${meta.runDate}`,
    '',
    ...(meta.mock
      ? ['**MOCK run: every source was a mock. None of these figures are real.**', '']
      : []),
    ...verdictLines(v, meta),
    '',
    '## Caveats',
    '',
    `- ${CAVEAT_YOUTUBE}`,
    `- ${CAVEAT_CHANNEL_MEDIANS}`,
    ...CAVEATS_HINDSIGHT.map((c) => `- ${c}`),
    `- ${CAVEAT_BASELINE}`,
    '',
    '## Breakdown',
    '',
    ...LANES.map(
      (lane) =>
        `- ${lane}: Spearman ${fixed(v.perLane[lane])} over ` +
        cases(rows.filter((r) => r.lane === lane).length),
    ),
    ...LANES.filter((lane) => v.perLane[lane] < 0).map(
      (lane) =>
        `- The ${lane} figure is negative: raise this with the owner before reading the verdict.`,
    ),
    `- Without the ${legalKills} of ${rows.length} cases the legal kill would have removed: ` +
      `Spearman ${fixed(v.withoutLegalKills)}`,
    `- Miss rate: ${misses} of ${rows.length} cases (${percent(v.missRate)}) had no hitlist entry`,
    `- No lane at T: ${meta.noLaneAtT} of ${cases(rows.length)}, kept in their lane today and ` +
      'scored with the unranked',
    `- Spiking at T (raw spike 3 or more): ${cases(v.spikeVsOutcome.spiking)}, ` +
      `${v.spikeVsOutcome.aboveMedian} of them with an outcome above the median`,
    '',
    '## Cases',
    '',
    meta.selectionNote,
    '',
    ...caseTable(rows),
    '',
    ...(meta.unusable.length === 0
      ? []
      : [
          '### Unusable cases',
          '',
          ...meta.unusable.map((u) => `- ${u.videoId} (${cell(u.title)}): ${u.error}`),
          '',
        ]),
    '## Decisions fixed before the run',
    '',
    ...PLAN_DECISIONS.map((d, i) => `${i + 1}. ${d}`),
    '',
    '## Run',
    '',
    `- Run date: ${meta.runDate}`,
    `- Outcomes measured on: ${meta.outcomeMeasuredOn} (the day the channel uploads were fetched)`,
    `- Hitlist by lane: downfall ${count(lanes.downfall)}, success ${count(lanes.success)}, ` +
      `no lane ${count(lanes.none)}`,
    `- Unresolved seed names: ${count(meta.unresolvedSeedNames)}`,
    `- Config version: ${meta.configVersion}`,
    `- Commit: ${meta.commit}`,
    `- Quota: ${meta.quotaNote}`,
    '',
  ]
  return plain(out.join('\n'))
}
