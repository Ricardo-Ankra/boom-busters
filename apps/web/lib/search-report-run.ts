import {
  addRankCheck,
  currentBible,
  freezeSearchReport,
  frozenReportsForChannel,
  getProject,
  pendingReport,
  rankChecksForVideo,
  recordReportDeferral,
} from '@boom-busters/db'
import {
  buildTermMatchRequest,
  mockProvidersEnabled,
  mockTermMatch,
  parseTermMatch,
} from '@boom-busters/providers'
import type { TermMatch, TermMatchInput } from '@boom-busters/providers'
import {
  buildSearchReport,
  CHECKPOINTS,
  DEFAULT_RESEARCH_THRESHOLDS,
  lengthBand,
  MODEL_DEFER_MAX,
  matchTermDeterministic,
  RANK_DEFER_MAX,
  REPORT_LAG_DAYS,
  researchKeywords,
} from '@boom-busters/schemas'
import type {
  Checkpoint,
  SearchBrief,
  SearchOutcome,
  SearchReport,
  TermBucket,
} from '@boom-busters/schemas'
import { callForAnswer } from '@/lib/answer'
import type { AnswerComplete } from '@/lib/answer'
import { CapReached, rankFor } from '@/lib/case-evidence'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { fetchVideoAnalytics, mockVideoAnalytics, SEARCH_SOURCE_KEY } from '@/lib/youtube-analytics'
import type { VideoAnalytics } from '@/lib/youtube-analytics'

/**
 * The frozen search report of one live master at one checkpoint (7, 28 or 90
 * days after it went public). `runSearchReport` does all of its work inside
 * the one Inngest step that calls it, and returns plain JSON: a failure of
 * the model or of the VidIQ rank check is a deferral to a later daily run,
 * never a thrown step, so Inngest does not retry it blind.
 */

const DAY_MS = 86_400_000

/** UTC midnight of the day a moment falls on. */
function utcDay(moment: Date): number {
  return Date.UTC(moment.getUTCFullYear(), moment.getUTCMonth(), moment.getUTCDate())
}

/**
 * The checkpoints whose report is due: the run's moment is at or past the
 * publish day plus N plus the lag, and the checkpoint is not already done.
 * Pass the frozen ones as `done`; a pending row is due again.
 */
export function dueCheckpoints(
  publishedAt: Date,
  now: Date,
  done: ReadonlySet<Checkpoint>,
): Checkpoint[] {
  const start = utcDay(publishedAt)
  return CHECKPOINTS.filter(
    (checkpoint) =>
      !done.has(checkpoint) && now.getTime() >= start + (checkpoint + REPORT_LAG_DAYS) * DAY_MS,
  )
}

export interface SearchReportRunInput {
  channelId: string
  projectId: string
  videoId: string
  checkpoint: Checkpoint
  /** ISO time the video went public. */
  publishedAt: string
  durationSec: number | null
  token: { mode: 'mock' } | { mode: 'live'; accessToken: string }
}

export type SearchReportRunResult = { state: 'frozen' | 'deferred'; outcome?: SearchOutcome }

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** The model call of a run with no project: charged to the channel. */
const completeFor =
  (channelId: string): AnswerComplete =>
  (request, call) =>
    callLlm(request, { channelId, ...(call === 'answer' ? {} : { purpose: call }) })

/** A frozen report's search hold: seconds watched per view over the buckets that have one. */
function overallHold(report: SearchReport): number | null {
  let views = 0
  let seconds = 0
  for (const bucket of Object.values(report.buckets)) {
    if (bucket.holdSec === null) continue
    views += bucket.views
    seconds += bucket.views * bucket.holdSec
  }
  return views > 0 ? seconds / views : null
}

const present = (values: (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null)

/** What the brief knows about each researched keyword, for the model to judge by meaning. */
function researchedRows(brief: SearchBrief, researched: string[]): TermMatchInput['researched'] {
  const known = new Map(
    [...(brief.targetKeyword ? [brief.targetKeyword] : []), ...brief.secondaryKeywords].map(
      (row) => [row.keyword.trim().toLowerCase(), row],
    ),
  )
  return researched.map((keyword) => {
    const row = known.get(keyword.trim().toLowerCase())
    return {
      keyword,
      ...(row?.topic ? { topic: row.topic } : {}),
      ...(row?.intent ? { intent: row.intent } : {}),
    }
  })
}

export async function runSearchReport(input: SearchReportRunInput): Promise<SearchReportRunResult> {
  const { channelId, projectId, videoId, checkpoint } = input

  // 1. The row. A replay of a frozen one changes nothing.
  const row = await pendingReport(db, { channelId, projectId, videoId, checkpoint })
  if (row.state === 'frozen') {
    return { state: 'frozen', ...(row.report ? { outcome: row.report.outcome } : {}) }
  }

  // 2. The window runs from the publish day to the publish day plus N.
  const startMs = utcDay(new Date(input.publishedAt))
  const range = { start: isoDay(startMs), end: isoDay(startMs + checkpoint * DAY_MS) }
  let analytics: VideoAnalytics
  try {
    analytics =
      input.token.mode === 'mock'
        ? mockVideoAnalytics(videoId, range)
        : await fetchVideoAnalytics(input.token.accessToken, videoId, range)
  } catch (error) {
    // Neither a model nor a rank failure, so nothing is counted: the next daily run tries again.
    console.warn(
      `[analytics] search report ${checkpoint} for ${videoId} deferred, analytics read failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { state: 'deferred' }
  }

  // 3. The research the video was made from, frozen on the project.
  const project = await getProject(db, projectId)
  const brief = project?.searchBrief ?? null
  const keywords = brief ? researchKeywords(brief) : { target: null, researched: [] }
  const target = keywords.target
  const language =
    brief?.language ||
    (await currentBible(db, channelId).then(
      (current) => current.bible.language || undefined,
      () => undefined,
    ))

  // 4. Terms that match the research in words, then the model for the rest.
  type Placed = {
    term: string
    views: number
    minutes: number
    bucket: TermBucket
    keyword?: string
    reason?: string
  }
  const placed: Placed[] = []
  const leftovers: { term: string; views: number; minutes: number }[] = []
  for (const term of analytics.searchTerms) {
    const hit = matchTermDeterministic(term.term, keywords, language)
    if (hit) placed.push({ ...term, bucket: hit.bucket, keyword: hit.keyword })
    else leftovers.push(term)
  }

  // Rank first, so a model deferral never re-buys it (the check is reused next run).
  let rank: SearchReport['rank'] = null
  let rankSkipped: string | undefined
  if (checkpoint === 28 && target !== null) {
    const due = startMs + (checkpoint + REPORT_LAG_DAYS) * DAY_MS
    const wanted = target.trim().toLowerCase()
    const earlier = (await rankChecksForVideo(db, videoId)).find(
      (check) => check.keyword.trim().toLowerCase() === wanted && check.checkedAt.getTime() >= due,
    )
    if (earlier) {
      rank = {
        keyword: target,
        position: earlier.position,
        checkedAt: earlier.checkedAt.toISOString(),
      }
    } else {
      try {
        const position = await rankFor(target, videoId, channelId)
        let checkedAt = new Date()
        try {
          checkedAt = (await addRankCheck(db, { channelId, videoId, keyword: target, position }))
            .checkedAt
        } catch (recordError) {
          // Paid for already: freeze with the position in hand rather than buy it again.
          console.warn(
            `[analytics] rank check for ${videoId} was paid for but not recorded: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
          )
        }
        rank = { keyword: target, position, checkedAt: checkedAt.toISOString() }
      } catch (error) {
        if (row.rankAttempts + 1 < RANK_DEFER_MAX) {
          await recordReportDeferral(db, row.id, 'rank')
          return { state: 'deferred' }
        }
        rankSkipped = error instanceof CapReached ? 'credit cap' : 'rank check failed'
      }
    }
  }

  let matching: SearchReport['matching'] = target === null ? 'none' : 'full'
  let matched: TermMatch['terms'] = []
  if (target !== null && leftovers.length > 0) {
    const request: TermMatchInput = {
      language: language ?? '',
      target,
      researched: researchedRows(brief!, keywords.researched),
      terms: leftovers.map((term) => term.term),
    }
    try {
      if (mockProvidersEnabled()) {
        matched = mockTermMatch(request).terms
      } else {
        const answer = await callForAnswer({
          request: buildTermMatchRequest(request),
          parse: (text, note) => parseTermMatch(text, request, note),
          complete: completeFor(channelId),
        })
        if (!answer.ok) throw new Error(answer.issue)
        matched = answer.value.terms
      }
    } catch {
      // A budget stop, a provider error or a refused answer all wait for another run.
      if (row.modelAttempts + 1 < MODEL_DEFER_MAX) {
        await recordReportDeferral(db, row.id, 'model')
        return { state: 'deferred' }
      }
      matching = 'deterministic-only'
      matched = []
    }
  }
  const byTerm = new Map(matched.map((m) => [m.term, m]))
  for (const term of leftovers) {
    const answer = byTerm.get(term.term)
    placed.push(
      answer
        ? {
            ...term,
            bucket: answer.bucket,
            ...(answer.keyword === undefined ? {} : { keyword: answer.keyword }),
            ...(answer.reason === '' ? {} : { reason: answer.reason }),
          }
        : { ...term, bucket: 'unmatched' },
    )
  }

  // 6. Baselines: the channel's other frozen reports at this checkpoint.
  const band = lengthBand(input.durationSec)
  const others = (await frozenReportsForChannel(db, channelId, checkpoint)).filter(
    (other) => other.videoId !== videoId,
  )
  const inBand = others.filter(
    (other) => band !== null && lengthBand(other.report.durationSec) === band,
  )
  const baselineInputs = {
    holdBand: present(inBand.map((o) => overallHold(o.report))),
    holdChannel: present(others.map((o) => overallHold(o.report))),
    dropBand: present(inBand.map((o) => o.report.earlyDrop)),
    dropChannel: present(others.map((o) => o.report.earlyDrop)),
    subsBand: present(inBand.map((o) => o.report.engagement.subscribersPer1k)),
    subsChannel: present(others.map((o) => o.report.engagement.subscribersPer1k)),
  }

  // 7 and 8. Build the report and freeze it.
  const report = buildSearchReport({
    checkpoint,
    range,
    publishedAt: input.publishedAt,
    durationSec: input.durationSec,
    views: analytics.views ?? 0,
    searchViews: analytics.viewsBySource[SEARCH_SOURCE_KEY] ?? 0,
    avgViewDurationSec: analytics.avgViewDurationSec,
    subscribersGained: analytics.subscribersGained,
    likes: analytics.likes,
    comments: analytics.comments,
    retentionCurve: analytics.retentionCurve,
    terms: placed,
    targetKeyword: target,
    matching,
    rank,
    ...(rankSkipped === undefined ? {} : { rankSkipped }),
    baselineInputs,
    thresholds: DEFAULT_RESEARCH_THRESHOLDS,
    now: new Date(),
  })
  await freezeSearchReport(db, row.id, report)
  return { state: 'frozen', outcome: report.outcome }
}
