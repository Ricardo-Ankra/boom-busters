import { z } from 'zod'
import {
  SEARCHED_TERMS_MAX,
  byMonthlySearchesDesc,
  classifySearchTerms,
  termWords,
} from './search-terms'

/** One measured keyword row; every measure is null when VidIQ gave none. */
export const SearchKeywordSchema = z.object({
  keyword: z.string(),
  volume: z.number().nullable(),
  competition: z.number().nullable(),
  overall: z.number().nullable(),
  estimatedMonthlySearch: z.number().nullable(),
  growthPct: z.number().nullable(),
  /** What the searcher wants, in plain words; set by the research run's understanding step. */
  intent: z.string().max(80).optional(),
  /** Whether a video in the case's format on this channel would satisfy that searcher. */
  fit: z.enum(['fits', 'partly', 'off']).optional(),
  /** A short label shared by terms that mean the same thing. */
  topic: z.string().max(40).optional(),
})
export type KeywordFit = NonNullable<SearchKeyword['fit']>
export type SearchKeyword = z.infer<typeof SearchKeywordSchema>

/** A winning video (an outlier) in the subject's search space. */
export const SearchOutlierSchema = z.object({
  videoId: z.string(),
  title: z.string(),
  channel: z.string().nullable(),
  subscribers: z.number().nullable(),
  views: z.number().nullable(),
  breakoutScore: z.number().nullable(),
  publishedAt: z.string().nullable(),
  tags: z.array(z.string()),
})
export type SearchOutlier = z.infer<typeof SearchOutlierSchema>

export const AngleOptionSchema = z.object({
  angle: z.string().min(20).max(400),
  keyword: z.string(),
  /** Searched questions this angle answers. */
  answers: z.array(z.string()).max(5),
  gap: z.string().max(300),
})
export type AngleOption = z.infer<typeof AngleOptionSchema>

/** The brief's list limits. The model steps that feed these lists read the same numbers. */
export const TITLE_PATTERNS_MAX = 5
export const TOLD_ALREADY_MAX = 8

export const RECOMMENDATION_REASON_MAX = 200

/** Whether the subject fits the channel's scope, and the pillar it belongs to. */
export const BriefFitSchema = z.object({
  inScope: z.boolean(),
  pillarKey: z.string().nullable(),
  reason: z.string().max(300),
})
export type BriefFit = z.infer<typeof BriefFitSchema>

export const SearchBriefSchema = z.object({
  subject: z.string(),
  measuredAt: z.string().datetime(),
  targetKeyword: SearchKeywordSchema.nullable(),
  secondaryKeywords: z.array(SearchKeywordSchema).max(10),
  searchedQuestions: z.array(z.string()).max(10),
  outliers: z.array(SearchOutlierSchema).max(10),
  titlePatterns: z.array(z.string()).max(TITLE_PATTERNS_MAX),
  toldAlready: z.array(z.string()).max(TOLD_ALREADY_MAX),
  angleOptions: z.array(AngleOptionSchema).max(3),
  chosenAngle: z.number().nullable(),
  /** The format the research ran as; null in a brief saved before formats. */
  formatKey: z.string().nullable().default(null),
  fit: BriefFitSchema.nullable().default(null),
  /** Measured terms that are other people's video titles, kept apart from the keywords. */
  searchedTitles: z.array(SearchKeywordSchema).max(SEARCHED_TERMS_MAX).default([]),
  /** Measured terms in another language (auto-translated titles). */
  otherLanguages: z.array(SearchKeywordSchema).max(SEARCHED_TERMS_MAX).default([]),
  /** The model's pick among `angleOptions` (an index), with one sentence on why. */
  recommendedAngle: z.number().int().min(0).nullable().default(null),
  recommendationReason: z.string().max(RECOMMENDATION_REASON_MAX).nullable().default(null),
  /** The owner wrote their own angle instead of choosing an option. */
  ownAngle: z.boolean().default(false),
})
export type SearchBrief = z.infer<typeof SearchBriefSchema>

export const CaseResearchJobSchema = z.object({
  state: z.enum(['running', 'done', 'failed']),
  current: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
  /** Refreshed by the run as it works; the job is stale thirty minutes after it, or after `startedAt` without one. */
  heartbeatAt: z.string().optional(),
  subject: z.string(),
})
export type CaseResearchJob = z.infer<typeof CaseResearchJobSchema>

export const SEARCH_BRIEF_STALE_DAYS = 30
/** Credits per run: the base call (the run itself still spends this much today), then each optional call. */
export const CASE_RESEARCH_CREDITS = 20
const FORMAT_SEED_CREDITS = 5
const PEOPLE_SEED_CREDITS = 5
const PEOPLE_SEEDS_MAX = 2
const FIELD_CHECK_CREDITS = 35

/** The estimate for a run: 20, 5 for the format seed, 5 per People seed (two at most), and 35 for the field check, comments and niche test. */
export function caseResearchCredits(input: { formatSeed: boolean; people: number }): number {
  return (
    CASE_RESEARCH_CREDITS +
    (input.formatSeed ? FORMAT_SEED_CREDITS : 0) +
    PEOPLE_SEED_CREDITS * Math.min(Math.max(input.people, 0), PEOPLE_SEEDS_MAX) +
    FIELD_CHECK_CREDITS
  )
}

const JOB_STALE_MS = 30 * 60_000
const DAY_MS = 86_400_000

/** Running, and heard from (last heartbeat, else its start) under thirty minutes ago. */
export function caseResearchJobIsRunning(job: CaseResearchJob, now: Date = new Date()): boolean {
  const lastSeen = Date.parse(job.heartbeatAt ?? job.startedAt)
  return job.state === 'running' && now.getTime() - lastSeen < JOB_STALE_MS
}

/** A digit anywhere, which covers every currency amount (`$47`, `€1.9`, `R5`). */
export function keywordHasFigure(keyword: string): boolean {
  return /\d/.test(keyword)
}

/** A currency symbol (`R` only before a digit), digits with separators, and an optional scale word. */
const FIGURE_RUN =
  /(?:[$€£]|R(?=\d))?\d+(?:[.,]\d+)*(?:\s*(?:[Mm]illion|[Bb]illion|[Bb]n|[Mm]|[Kk])\b)?/g

export function maskFigures(keyword: string): string {
  return keyword.replace(FIGURE_RUN, '{figure}')
}

/** Below this `overall` a keyword is never offered as the target. */
const PICK_FLOOR = 50
const CANDIDATES_MAX = 3

/**
 * The keywords the research run checks the field for, best first. Eligible rows
 * are keywords (no title, no other language, no figure) with `overall` 50 or
 * more. Rows that fit (or were never judged) win; only when none do, rows that
 * partly fit. Then a row with a whole preferred word, then most searches (nulls
 * last). Three at most.
 */
export function pickTargetCandidates(
  rows: readonly SearchKeyword[],
  options: { preferredWords: readonly string[]; language?: string },
): SearchKeyword[] {
  const kinds = classifySearchTerms(
    rows.map((r) => r.keyword),
    { language: options.language },
  )
  const eligible = rows.filter(
    (r) =>
      !keywordHasFigure(r.keyword) &&
      kinds.get(keyOf(r.keyword)) === 'keyword' &&
      (r.overall ?? -1) >= PICK_FLOOR,
  )
  const fitting = eligible.filter((r) => r.fit === undefined || r.fit === 'fits')
  const pool = fitting.length > 0 ? fitting : eligible.filter((r) => r.fit === 'partly')
  const wanted = new Set(options.preferredWords.map((w) => w.toLowerCase()))
  const hasWanted = (r: SearchKeyword) => (termWords(r.keyword).some((w) => wanted.has(w)) ? 1 : 0)
  return pool
    .map((row, i) => ({ row, i }))
    .sort(
      (a, b) =>
        hasWanted(b.row) - hasWanted(a.row) || byMonthlySearchesDesc(a.row, b.row) || a.i - b.i,
    )
    .slice(0, CANDIDATES_MAX)
    .map((x) => x.row)
}

/**
 * The highest `overall` among keyword-shaped rows with no figure (never a
 * video title or another language); on a tie, a row naming the subject, then
 * the most searches. Null when no row qualifies. The upgrade path uses this;
 * a research run uses `pickTargetCandidates`.
 */
export function chooseTargetKeyword(
  rows: readonly SearchKeyword[],
  subject: string,
): SearchKeyword | null {
  const name = subject.trim().toLowerCase()
  const kinds = classifySearchTerms(rows.map((r) => r.keyword))
  const names = (r: SearchKeyword) =>
    name !== '' && r.keyword.toLowerCase().includes(name) ? 1 : 0
  let best: SearchKeyword | null = null
  for (const row of rows) {
    if (keywordHasFigure(row.keyword)) continue
    if (kinds.get(keyOf(row.keyword)) !== 'keyword') continue
    const lead =
      best === null
        ? 1
        : (row.overall ?? -1) - (best.overall ?? -1) ||
          names(row) - names(best) ||
          -byMonthlySearchesDesc(row, best)
    if (lead > 0) {
      best = row
    }
  }
  return best
}

/** One line of demand evidence for prompts: the target keyword and the best outlier. */
export function briefDemandNotes(brief: SearchBrief): string {
  const n = brief.outliers.length
  const videos = `${n} winning ${n === 1 ? 'video' : 'videos'}`
  const target = brief.targetKeyword
  if (!target) return `No searched keyword measured; ${videos}`
  const measures = [
    target.volume !== null ? `${target.volume} volume` : null,
    target.competition !== null ? `competition ${target.competition}` : null,
  ].filter((m): m is string => m !== null)
  const head = measures.length > 0 ? `${target.keyword}: ${measures.join(', ')}` : target.keyword
  let best: SearchOutlier | null = null
  for (const o of brief.outliers) {
    if (best === null || (o.breakoutScore ?? -1) > (best.breakoutScore ?? -1)) best = o
  }
  const bestParts: string[] = []
  if (best?.views != null) bestParts.push(`${best.views.toLocaleString('en-US')} views`)
  if (best?.breakoutScore != null) bestParts.push(`at ${Math.round(best.breakoutScore)}x`)
  const tail = bestParts.length > 0 ? `, best ${bestParts.join(' ')}` : ''
  return `${head}; ${videos}${tail}`
}

/** Measured more than thirty days ago. */
export function briefIsStale(brief: SearchBrief, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(brief.measuredAt) > SEARCH_BRIEF_STALE_DAYS * DAY_MS
}

/**
 * Third-party search text (a keyword, a searched question) as one plain line
 * for a prompt or a document: all whitespace collapsed, trimmed, capped.
 */
export function searchBriefLine(text: string, max = 200): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

const keyOf = (term: string) => term.trim().toLowerCase()

/** One list from several: the first spelling of a term wins; by monthly searches (nulls last), ten at most. */
function mergeTermRows(...lists: readonly (readonly SearchKeyword[])[]): SearchKeyword[] {
  const seen = new Set<string>()
  const rows: SearchKeyword[] = []
  for (const row of lists.flat()) {
    const key = keyOf(row.keyword)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  return rows.sort(byMonthlySearchesDesc).slice(0, SEARCHED_TERMS_MAX)
}

function byOverallDesc(a: SearchKeyword, b: SearchKeyword): number {
  return (b.overall ?? -1) - (a.overall ?? -1)
}

/**
 * Reads a brief saved before titles and other languages were kept apart.
 * Title and other-language rows leave the target and the secondaries for their
 * own lists; the target is re-picked only when the stored one was not a
 * keyword (an owner's keyword choice stays). Idempotent, and a brief that is
 * already split comes back unchanged. Not written back on read.
 */
export function upgradeSearchBrief(brief: SearchBrief): SearchBrief {
  const target = brief.targetKeyword
  const kinds = classifySearchTerms([
    ...(target ? [target.keyword] : []),
    ...brief.secondaryKeywords.map((r) => r.keyword),
    ...brief.searchedTitles.map((r) => r.keyword),
    ...brief.otherLanguages.map((r) => r.keyword),
  ])
  const kindOf = (r: SearchKeyword) => kinds.get(keyOf(r.keyword))
  const movedFrom = [...(target ? [target] : []), ...brief.secondaryKeywords].filter(
    (r) => kindOf(r) !== 'keyword',
  )
  const recommendedAngle =
    brief.recommendedAngle !== null && brief.recommendedAngle >= brief.angleOptions.length
      ? null
      : brief.recommendedAngle
  const recommendationReason = recommendedAngle === null ? null : brief.recommendationReason

  if (movedFrom.length === 0) {
    return recommendedAngle === brief.recommendedAngle
      ? brief
      : { ...brief, recommendedAngle, recommendationReason }
  }

  const keywordSecondaries = brief.secondaryKeywords.filter((r) => kindOf(r) === 'keyword')
  let nextTarget = target
  let secondaryKeywords = keywordSecondaries
  if (target !== null && kindOf(target) !== 'keyword') {
    nextTarget = chooseTargetKeyword(keywordSecondaries, brief.subject)
    secondaryKeywords = keywordSecondaries
      .filter((r) => r !== nextTarget)
      .sort(byOverallDesc)
      .slice(0, SEARCHED_TERMS_MAX)
  }
  const moved = (kind: 'title' | 'other-language') => movedFrom.filter((r) => kindOf(r) === kind)
  return {
    ...brief,
    targetKeyword: nextTarget,
    secondaryKeywords,
    searchedTitles: mergeTermRows(brief.searchedTitles, moved('title')),
    otherLanguages: mergeTermRows(brief.otherLanguages, moved('other-language')),
    recommendedAngle,
    recommendationReason,
  }
}

/** The schema for a brief read from the database: parses, then upgrades. */
export const StoredSearchBriefSchema = SearchBriefSchema.transform(upgradeSearchBrief)

/** A target with an `overall` below this is weak: the brief suggests researching again. */
export const WEAK_TARGET_OVERALL = 50

const DEMAND_KEYWORD_WEIGHT = 0.7
const DEMAND_PER_ANSWER = 6
const DEMAND_ANSWERS_MAX = 5

export interface AngleDemand {
  /** 0 to 100, computed on read and never stored. */
  score: number
  /** The brief's spelling of the option's keyword; null when it is empty or in no list. */
  keyword: string | null
  /** The keyword's VidIQ `overall`; null when the keyword part is 0 for any reason. */
  keywordOverall: number | null
  /** The keyword is a searched title or another language, not a keyword. */
  servesSearchedTerm: boolean
  /** Searched questions the option answers, at most five. */
  answers: number
}

/**
 * Demand for an angle: 70% of its keyword's `overall` (looked up among the
 * target and secondaries; 0 when the keyword is a title, another language or
 * unknown) plus 6 per searched question it answers (five at most), rounded
 * and capped at 100. Pass an upgraded brief.
 */
export function angleDemand(option: AngleOption, brief: SearchBrief): AngleDemand {
  const key = keyOf(option.keyword)
  const asTerm = [...brief.searchedTitles, ...brief.otherLanguages].find(
    (r) => keyOf(r.keyword) === key,
  )
  const asKeyword = [
    ...(brief.targetKeyword ? [brief.targetKeyword] : []),
    ...brief.secondaryKeywords,
  ].find((r) => keyOf(r.keyword) === key)
  const serves = key !== '' && asTerm !== undefined
  const found = key === '' ? undefined : (asTerm ?? asKeyword)
  const keywordOverall = serves ? null : (asKeyword?.overall ?? null)

  const asked = new Set(brief.searchedQuestions.map(keyOf))
  const answers = Math.min(
    new Set(option.answers.map(keyOf).filter((a) => asked.has(a))).size,
    DEMAND_ANSWERS_MAX,
  )
  const score = Math.min(
    100,
    Math.round(DEMAND_KEYWORD_WEIGHT * (keywordOverall ?? 0) + DEMAND_PER_ANSWER * answers),
  )
  return {
    score,
    keyword: found?.keyword ?? null,
    keywordOverall,
    servesSearchedTerm: serves,
    answers,
  }
}

/** An angle is chosen when an option was picked or the owner wrote their own. */
export function angleIsChosen(brief: SearchBrief): boolean {
  return brief.chosenAngle !== null || brief.ownAngle
}

/** Research again is worth suggesting: no target, a weak one, or an angle that serves a searched title. */
export function briefNeedsResearch(brief: SearchBrief): boolean {
  const target = brief.targetKeyword
  if (target === null || (target.overall ?? 0) < WEAK_TARGET_OVERALL) return true
  return brief.angleOptions.some((o) => angleDemand(o, brief).servesSearchedTerm)
}
