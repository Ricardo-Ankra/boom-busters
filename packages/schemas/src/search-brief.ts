import { z } from 'zod'

/** One measured keyword row; every measure is null when VidIQ gave none. */
export const SearchKeywordSchema = z.object({
  keyword: z.string(),
  volume: z.number().nullable(),
  competition: z.number().nullable(),
  overall: z.number().nullable(),
  estimatedMonthlySearch: z.number().nullable(),
  growthPct: z.number().nullable(),
})
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

export const SearchBriefSchema = z.object({
  subject: z.string(),
  measuredAt: z.string().datetime(),
  targetKeyword: SearchKeywordSchema.nullable(),
  secondaryKeywords: z.array(SearchKeywordSchema).max(10),
  searchedQuestions: z.array(z.string()).max(10),
  outliers: z.array(SearchOutlierSchema).max(10),
  titlePatterns: z.array(z.string()).max(5),
  toldAlready: z.array(z.string()).max(8),
  angleOptions: z.array(AngleOptionSchema).max(3),
  chosenAngle: z.number().nullable(),
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
/** The estimate shown before a case research run spends VidIQ credits. */
export const CASE_RESEARCH_CREDITS = 20

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

const DOCUMENTARY_PHRASES = [
  'documentary',
  'what happened to',
  'rise and fall of',
  'story',
  'collapse',
  'bankruptcy',
]

/**
 * The highest `overall` among rows with no figure; on a tie, a documentary
 * phrase, then a row naming the subject. Null when no row qualifies.
 */
export function chooseTargetKeyword(
  rows: readonly SearchKeyword[],
  subject: string,
): SearchKeyword | null {
  const name = subject.trim().toLowerCase()
  const rank = (row: SearchKeyword): [number, number, number] => {
    const text = row.keyword.toLowerCase()
    return [
      row.overall ?? -1,
      DOCUMENTARY_PHRASES.some((p) => text.includes(p)) ? 1 : 0,
      name !== '' && text.includes(name) ? 1 : 0,
    ]
  }
  let best: SearchKeyword | null = null
  let bestRank: [number, number, number] = [-2, 0, 0]
  for (const row of rows) {
    if (keywordHasFigure(row.keyword)) continue
    const r = rank(row)
    const better =
      r[0] !== bestRank[0]
        ? r[0] > bestRank[0]
        : r[1] !== bestRank[1]
          ? r[1] > bestRank[1]
          : r[2] > bestRank[2]
    if (best === null || better) {
      best = row
      bestRank = r
    }
  }
  return best
}

/** One line of demand evidence for prompts: the target keyword and the best outlier. */
export function briefDemandNotes(brief: SearchBrief): string {
  const n = brief.outliers.length
  const videos = `${n} winning videos`
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
