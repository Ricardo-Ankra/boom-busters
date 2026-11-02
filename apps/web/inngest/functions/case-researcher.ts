import {
  channelForCase,
  currentBible,
  getCase,
  saveCaseSearchBrief,
  writeCaseResearchJob,
} from '@boom-busters/db'
import {
  buildAngleOptionsRequest,
  buildKeywordFilterRequest,
  buildWinnersRequest,
  mockAngleOptions,
  mockKeywordFilter,
  mockProvidersEnabled,
  mockWinners,
  parseAngleOptions,
  parseKeywordFilter,
  parseWinners,
} from '@boom-busters/providers'
import type { AngleOptionsInput, Winners } from '@boom-busters/providers'
import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import type { VidiqVideo } from '@boom-busters/providers/vidiq'
import { SearchBriefSchema, chooseTargetKeyword, parseEventData } from '@boom-busters/schemas'
import type {
  AngleOption,
  CaseResearchJob,
  SearchBrief,
  SearchKeyword,
  SearchOutlier,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import type { AnswerComplete } from '@/lib/answer'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { spendVidiq } from '@/lib/vidiq-spend'
import { inngest } from '../client'
import { events } from '../events'

/**
 * case-researcher: what a case's subject looks like in YouTube search, as a
 * short brief kept on the case (`cases.search_brief`).
 *
 * Four VidIQ calls (matching terms, questions, outliers, the top outliers'
 * details), each a step of its own that records its credits in the ledger once
 * the call has returned, and three model steps between them. Only the brief's
 * digest-sized fields are stored: no transcripts and no full descriptions.
 *
 * Nothing reaches `cases.search_brief` until the last step, so a run that
 * fails midway leaves no half-written brief; the credits it spent stay in the
 * ledger. The subject is read from the research job the action stamped, so the
 * brief is for the subject the owner pressed the button on.
 */

const FUNCTION_ID = 'case-researcher'
const PURPOSE = 'case-research' as const

const TERMS_LIMIT = 20
const QUESTIONS_LIMIT = 10
const OUTLIERS_LIMIT = 25
/** Outliers whose details are read, and which the brief keeps. */
const OUTLIERS_KEPT = 10
/** The brief's own list limits. */
const SECONDARY_KEPT = 10
const TAGS_KEPT = 10
/** A description is read for its start only; none is stored. */
const DESCRIPTION_CHARS = 400

interface Loaded {
  channelId: string
  subject: string
  angleIdea: string | null
}

type Details = Record<string, { description: string; tags: string[] }>

const toKeyword = (row: SearchKeyword): SearchKeyword => ({
  keyword: row.keyword,
  volume: row.volume,
  competition: row.competition,
  overall: row.overall,
  estimatedMonthlySearch: row.estimatedMonthlySearch,
  growthPct: row.growthPct,
})

const toOutlier = (video: VidiqVideo): SearchOutlier => ({
  videoId: video.videoId,
  title: video.title,
  channel: video.channel,
  subscribers: video.subscribers,
  views: video.views,
  breakoutScore: video.breakoutScore,
  publishedAt: video.publishedAt,
  tags: [],
})

const byBreakout = (a: SearchOutlier, b: SearchOutlier) =>
  (b.breakoutScore ?? -1) - (a.breakoutScore ?? -1)

const byOverall = (a: SearchKeyword, b: SearchKeyword) => (b.overall ?? -1) - (a.overall ?? -1)

/** Whether this run still owns the case's job: the same start, and still running. */
function owns(job: CaseResearchJob | null, jobStartedAt: string): job is CaseResearchJob {
  return job !== null && job.startedAt === jobStartedAt && job.state === 'running'
}

/**
 * Refreshes the job's heartbeat (and the step it is on) at the start of a
 * step, so a long run is not taken as dead. A run that no longer owns the job
 * stops before it spends.
 */
async function beat(caseId: string, jobStartedAt: string, current: string): Promise<void> {
  const job = await writeCaseResearchJob(db, caseId, (existing) =>
    owns(existing, jobStartedAt)
      ? { ...existing, current, heartbeatAt: new Date().toISOString() }
      : existing,
  )
  if (!owns(job, jobStartedAt)) {
    throw new NonRetriableError('A newer job has taken the case; this research stops')
  }
}

/**
 * Marks the case's job failed with the reason; the owner sees it on the case.
 * A run that no longer owns the job (a newer one started, or it was stopped)
 * leaves it alone.
 */
export async function failCaseResearch(
  caseId: string,
  message: string,
  jobStartedAt: string,
): Promise<void> {
  try {
    await writeCaseResearchJob(db, caseId, (job) =>
      owns(job, jobStartedAt) ? { ...job, state: 'failed', current: null, error: message } : job,
    )
  } catch (error) {
    console.error('[case-researcher] could not record the failure', error)
  }
}

/** `callForAnswer`'s call for a run with no project: charged to the channel. */
const completeFor =
  (channelId: string): AnswerComplete =>
  (request, call) =>
    callLlm(request, { channelId, ...(call === 'answer' ? {} : { purpose: call }) })

export const caseResearcher = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Case research',
    retries: 2,
    concurrency: [{ key: 'event.data.caseId', limit: 1 }],
    onFailure: async ({ event }) => {
      const caseId = event.data.event.data['caseId']
      const jobStartedAt = event.data.event.data['jobStartedAt']
      if (typeof caseId !== 'string' || typeof jobStartedAt !== 'string') return
      await failCaseResearch(
        caseId,
        String(event.data.error?.message ?? 'Unknown error'),
        jobStartedAt,
      )
    },
    triggers: [events.caseResearchRequested],
  },
  async ({ event, step }) => {
    const { caseId, jobStartedAt } = parseEventData('case/research.requested', event.data)

    const loaded: Loaded = await step.run('load', async () => {
      await beat(caseId, jobStartedAt, 'load')
      const row = await getCase(db, caseId)
      const channel = await channelForCase(db, caseId)
      if (!row || !channel) throw new NonRetriableError('That case no longer exists')
      const subject = row.searchJob?.subject.trim() ?? ''
      if (subject === '') throw new NonRetriableError('The case has no subject to research')
      return { channelId: channel.id, subject, angleIdea: row.angle?.trim() || null }
    })
    const { channelId, subject, angleIdea } = loaded
    const complete = completeFor(channelId)

    // 1. The terms that contain the subject, with their measures.
    const terms: SearchKeyword[] = await step.run('keywords-terms', async () => {
      await beat(caseId, jobStartedAt, 'keywords-terms')
      const found = await spendVidiq(
        {
          channelId,
          purpose: PURPOSE,
          tool: 'vidiq_keyword_research',
          cost: VIDIQ_CREDIT_COST.keywordResearch,
        },
        (client) => client.keywordResearch(subject, { mode: 'matching_terms', limit: TERMS_LIMIT }),
      )
      return found.data.map(toKeyword)
    })

    // 2. The model keeps the terms that are about this subject.
    const keywords: SearchKeyword[] = await step.run('keywords-filter', async () => {
      await beat(caseId, jobStartedAt, 'keywords-filter')
      // Nothing measured, nothing to filter: no model call.
      if (terms.length === 0) return []
      let kept: string[]
      if (mockProvidersEnabled()) {
        kept = mockKeywordFilter(terms)
      } else {
        const answer = await callForAnswer({
          request: buildKeywordFilterRequest({ subject, rows: terms }),
          parse: (text, note) => parseKeywordFilter(text, terms, note),
          complete,
        })
        kept = answerOrStop(answer, 'The keyword filter could not be read')
      }
      const wanted = new Set(kept)
      return terms.filter((row) => wanted.has(row.keyword))
    })

    // 3. The questions people search.
    const questions: string[] = await step.run('keywords-questions', async () => {
      await beat(caseId, jobStartedAt, 'keywords-questions')
      const found = await spendVidiq(
        {
          channelId,
          purpose: PURPOSE,
          tool: 'vidiq_keyword_research',
          cost: VIDIQ_CREDIT_COST.keywordResearch,
        },
        (client) => client.keywordResearch(subject, { mode: 'questions', limit: QUESTIONS_LIMIT }),
      )
      return found.data.map((row) => row.keyword).slice(0, QUESTIONS_LIMIT)
    })

    // 4. The winning videos: outliers with every word of the subject in the title.
    const outliers: SearchOutlier[] = await step.run('outliers', async () => {
      await beat(caseId, jobStartedAt, 'outliers')
      const found = await spendVidiq(
        {
          channelId,
          purpose: PURPOSE,
          tool: 'vidiq_outliers',
          cost: VIDIQ_CREDIT_COST.outliers,
        },
        (client) =>
          client.outliers({
            keyword: subject,
            requireAllTitleTerms: true,
            publishedWithin: 'allTime',
            limit: OUTLIERS_LIMIT,
          }),
      )
      return found.data.map(toOutlier).sort(byBreakout)
    })
    const top = outliers.slice(0, OUTLIERS_KEPT)

    // 5. The top outliers' tags and the start of their descriptions. Skipped with no outliers.
    const details: Details =
      top.length === 0
        ? {}
        : await step.run('outlier-details', async () => {
            await beat(caseId, jobStartedAt, 'outlier-details')
            const found = await spendVidiq(
              {
                channelId,
                purpose: PURPOSE,
                tool: 'vidiq_get_videos_by_ids',
                cost: VIDIQ_CREDIT_COST.getVideosByIds,
              },
              (client) => client.getVideosByIds(top.map((outlier) => outlier.videoId)),
            )
            const kept: Details = {}
            for (const video of found.data) {
              kept[video.videoId] = {
                description: (video.description ?? '').trim().slice(0, DESCRIPTION_CHARS),
                tags: (video.tags ?? []).slice(0, TAGS_KEPT),
              }
            }
            return kept
          })
    const winning: SearchOutlier[] = top.map((outlier) => ({
      ...outlier,
      tags: details[outlier.videoId]?.tags ?? [],
    }))

    // 6. What the winning titles share, and what they already tell.
    const winners: Winners = await step.run('winners', async () => {
      await beat(caseId, jobStartedAt, 'winners')
      // No outliers, nothing to study: no model call.
      if (winning.length === 0) return { titlePatterns: [], toldAlready: [] }
      if (mockProvidersEnabled()) return mockWinners()
      const descriptions = Object.fromEntries(
        Object.entries(details).map(([videoId, detail]) => [videoId, detail.description]),
      )
      const answer = await callForAnswer({
        request: buildWinnersRequest({ subject, outliers: winning, descriptions }),
        parse: (text, note) => parseWinners(text, note),
        complete,
      })
      return answerOrStop(answer, 'The winning-video patterns could not be read')
    })

    // The target is the best keyword with no figure in it; the rest are secondary.
    const target = chooseTargetKeyword(keywords, subject)
    const secondary = keywords
      .filter((row) => row.keyword !== target?.keyword)
      .sort(byOverall)
      .slice(0, SECONDARY_KEPT)

    // 7. Two or three angles to choose between, from the channel's current bible.
    const angleOptions: AngleOption[] = await step.run('angles', async () => {
      await beat(caseId, jobStartedAt, 'angles')
      // A case has no frozen bible: the channel's current version stands in.
      const bible = await currentBible(db, channelId)
      const input: AngleOptionsInput = {
        bible,
        subject,
        angleIdea,
        targetKeyword: target?.keyword ?? null,
        secondaryKeywords: secondary.map((row) => row.keyword),
        searchedQuestions: questions,
        toldAlready: winners.toldAlready,
      }
      if (mockProvidersEnabled()) return mockAngleOptions(input)
      const answer = await callForAnswer({
        request: buildAngleOptionsRequest(input),
        parse: (text, note) => parseAngleOptions(text, input, note),
        complete,
      })
      return answerOrStop(answer, 'The angle options could not be read')
    })

    // 8. The brief, written once, and only while this run still owns the job.
    const saved = await step.run('save-brief', async () => {
      await beat(caseId, jobStartedAt, 'save-brief')
      const brief: SearchBrief = SearchBriefSchema.parse({
        subject,
        measuredAt: new Date().toISOString(),
        targetKeyword: target,
        secondaryKeywords: secondary,
        searchedQuestions: questions,
        outliers: winning,
        titlePatterns: winners.titlePatterns,
        toldAlready: winners.toldAlready,
        angleOptions,
        chosenAngle: null,
      })
      return saveCaseSearchBrief(db, caseId, brief, jobStartedAt)
    })
    if (!saved) return { outcome: 'superseded' as const }

    return { outcome: 'researched' as const, outliers: winning.length }
  },
)
