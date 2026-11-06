import {
  channelForCase,
  currentBible,
  getCase,
  saveCaseSearchBrief,
  writeCaseResearchJob,
} from '@boom-busters/db'
import {
  buildAngleOptionsRequest,
  buildCommentThemesRequest,
  buildFitRequest,
  buildKeywordUnderstandingRequest,
  buildWinnersRequest,
  mockAngleOptions,
  mockCommentThemes,
  mockFit,
  mockKeywordUnderstanding,
  mockProvidersEnabled,
  mockWinners,
  parseAngleOptions,
  parseCommentThemes,
  parseFit,
  parseKeywordUnderstanding,
  parseWinners,
} from '@boom-busters/providers'
import type {
  AngleOptionsInput,
  AngleRating,
  CommentThemesInput,
  FitInput,
  KeywordUnderstanding,
  KeywordUnderstandingInput,
  Winners,
} from '@boom-busters/providers'
import { VIDIQ_CREDIT_COST } from '@boom-busters/providers/vidiq'
import type { VidiqVideo } from '@boom-busters/providers/vidiq'
import {
  SearchBriefSchema,
  TITLE_PATTERNS_MAX,
  TOLD_ALREADY_MAX,
  byMonthlySearchesDesc,
  fieldCompetition,
  isStaleField,
  leadKeyword,
  openDoors,
  parseEventData,
  pickTargetCandidates,
  preferredWords,
  resolveFormat,
  splitSearchTerms,
} from '@boom-busters/schemas'
import type {
  AngleOption,
  BriefFit,
  CaseResearchJob,
  CommentTheme,
  FieldCheck,
  NicheTest,
  SearchBrief,
  SearchKeyword,
  SearchOutlier,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import type { AnswerComplete } from '@/lib/answer'
import {
  CAP_REACHED,
  CapReached,
  awaitNicheTest,
  readComments,
  searchField,
  startNicheTest,
} from '@/lib/case-evidence'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { rateAngles } from '@/lib/rate-angles'
import { spendVidiq } from '@/lib/vidiq-spend'
import { inngest } from '../client'
import { events } from '../events'

/**
 * case-researcher: what a case's subject looks like in YouTube search, as a
 * short brief kept on the case (`cases.search_brief`).
 *
 * Four VidIQ calls (matching terms, questions, outliers, the top outliers'
 * details), each a step of its own that records its credits in the ledger once
 * the call has returned, and model steps between them. A case whose format has
 * a lead keyword adds matching terms for the subject with that keyword, and up
 * to two People add matching terms for each name. One model step judges what
 * each term's searcher wants. Then the optional checks, each purchase a step
 * of its own: who ranks for the target candidates, the comments on the top
 * winning videos, and a niche test of the recommended angle. A check the
 * monthly cap refuses, or that fails, is skipped and recorded; it never fails
 * the run. Only the brief's digest-sized fields are stored: no transcripts, no
 * full descriptions and no comments.
 *
 * Nothing reaches `cases.search_brief` until the last step, so a run that
 * fails midway leaves no half-written brief; the credits it spent stay in the
 * ledger. The subject is read from the research job the action stamped, so the
 * brief is for the subject the owner pressed the button on.
 */

const FUNCTION_ID = 'case-researcher'
const PURPOSE = 'case-research' as const

/** Matching terms asked for; the keyword measurer asks for the same many. */
export const TERMS_LIMIT = 20
const QUESTIONS_LIMIT = 10
const OUTLIERS_LIMIT = 25
/** Outliers whose details are read, and which the brief keeps. */
const OUTLIERS_KEPT = 10
/** The brief's own list limits. */
const SECONDARY_KEPT = 10
const TAGS_KEPT = 10
const ANGLE_OPTIONS_MAX = 3
/** A description is read for its start only; none is stored. */
const DESCRIPTION_CHARS = 400
/** People whose names seed a matching-terms search. */
const PEOPLE_SEEDS = 2
/** Candidates whose field is checked, winning videos whose comments are read. */
const OFF_INTENT_KEPT = 10
const COMMENT_VIDEOS = 3

interface Loaded {
  channelId: string
  subject: string
  angleIdea: string | null
  /** The case's format resolved against the current bible, and its lead keyword. */
  formatKey: string | null
  leadKeyword: string | null
  /** Absent in a load memoised before these fields existed; read with a default. */
  people?: string[]
  language?: string
  formatName?: string
  formatKeywords?: string[]
  pillarKeywords?: string[]
  pillarLabel?: string | null
}

/** What an optional step returns when the monthly cap refused its purchase. */
interface Capped {
  capped: true
}
const isCapped = (value: unknown): value is Capped =>
  typeof value === 'object' && value !== null && 'capped' in value

/**
 * An optional step's body: a cap refusal becomes a marker the run reads, any
 * other failure is logged and becomes null. Never throws, so an optional
 * check cannot fail the run. The heartbeat is the caller's, outside the try.
 */
async function optional<T>(what: string, body: () => Promise<T>): Promise<T | Capped | null> {
  try {
    return await body()
  } catch (error) {
    if (error instanceof CapReached) return { capped: true }
    console.error(`[case-researcher] ${what} failed`, error)
    return null
  }
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

/** The first of each text, compared without case: VidIQ can repeat a row, and a repeat is a duplicate React key. */
function firstOfEach<T>(items: readonly T[], text: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = text(item).trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

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
      // The case's own format, as the channel's current bible words it: a key
      // the bible no longer lists reads as the primary.
      const { bible } = await currentBible(db, channel.id)
      const format = resolveFormat(bible.formats, row.formatKey)
      const pillar = bible.caseCategories.find((c) => c.key === row.category)
      return {
        channelId: channel.id,
        subject,
        angleIdea: row.angle?.trim() || null,
        formatKey: format.key,
        leadKeyword: leadKeyword(format),
        people: row.people
          .map((name) => name.trim())
          .filter((name) => name !== '')
          .slice(0, PEOPLE_SEEDS),
        language: bible.language,
        formatName: format.name,
        formatKeywords: format.keywords,
        pillarKeywords: pillar?.keywords ?? [],
        pillarLabel: pillar?.label ?? null,
      }
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
      return firstOfEach(found.data.map(toKeyword), (row) => row.keyword)
    })

    // 1b. The terms that contain the subject and the format's lead keyword. Skipped without one
    // (a `load` memoised before the deploy has none, and must not spend on "<subject> undefined").
    const formatTerms: SearchKeyword[] = !loaded.leadKeyword
      ? []
      : await step.run('keywords-format', async () => {
          await beat(caseId, jobStartedAt, 'keywords-format')
          const found = await spendVidiq(
            {
              channelId,
              purpose: PURPOSE,
              tool: 'vidiq_keyword_research',
              cost: VIDIQ_CREDIT_COST.keywordResearch,
            },
            (client) =>
              client.keywordResearch(`${subject} ${loaded.leadKeyword}`, {
                mode: 'matching_terms',
                limit: TERMS_LIMIT,
              }),
          )
          return firstOfEach(found.data.map(toKeyword), (row) => row.keyword)
        })
    // 1c. The terms that contain each person's name (the first two, in the owner's order).
    const peopleTerms: SearchKeyword[] = []
    for (const [at, name] of (loaded.people ?? []).entries()) {
      const found: SearchKeyword[] = await step.run(`keywords-people-${at}`, async () => {
        await beat(caseId, jobStartedAt, `keywords-people-${at}`)
        const result = await spendVidiq(
          {
            channelId,
            purpose: PURPOSE,
            tool: 'vidiq_keyword_research',
            cost: VIDIQ_CREDIT_COST.keywordResearch,
          },
          (client) => client.keywordResearch(name, { mode: 'matching_terms', limit: TERMS_LIMIT }),
        )
        return firstOfEach(result.data.map(toKeyword), (row) => row.keyword)
      })
      peopleTerms.push(...found)
    }
    const measured = firstOfEach([...terms, ...formatTerms, ...peopleTerms], (row) => row.keyword)

    // 2. The model keeps the terms that are about this subject, and says what each searcher wants,
    // whether this channel's format would satisfy them, and a topic that groups the same wants.
    const understood: KeywordUnderstanding = await step.run('keywords-understand', async () => {
      await beat(caseId, jobStartedAt, 'keywords-understand')
      // Nothing measured, nothing to judge: no model call.
      if (measured.length === 0) return { niche: '', terms: [] }
      const input: KeywordUnderstandingInput = {
        bible: await currentBible(db, channelId),
        subject,
        formatName: loaded.formatName ?? '',
        formatKeywords: loaded.formatKeywords ?? [],
        pillarLabel: loaded.pillarLabel ?? null,
        rows: measured,
      }
      if (mockProvidersEnabled()) return mockKeywordUnderstanding(input)
      const answer = await callForAnswer({
        request: buildKeywordUnderstandingRequest(input),
        parse: (text, note) => parseKeywordUnderstanding(text, input, note),
        complete,
      })
      return answerOrStop(answer, 'The keyword understanding could not be read')
    })
    // Joined outside any step, from the memoised answer, so a parked run replays it the same way.
    const labels = new Map(understood.terms.map((term) => [term.keyword, term]))
    const judged: SearchKeyword[] = measured.flatMap((row) => {
      const label = labels.get(row.keyword)
      if (label === undefined) return []
      return [
        {
          ...row,
          ...(label.intent === '' ? {} : { intent: label.intent }),
          fit: label.fit,
          ...(label.topic === '' ? {} : { topic: label.topic }),
        },
      ]
    })
    const offIntent = judged
      .filter((row) => row.fit === 'off')
      .sort(byMonthlySearchesDesc)
      .slice(0, OFF_INTENT_KEPT)
    const keywords = judged.filter((row) => row.fit !== 'off')

    // 2b. Whether the subject belongs on this channel, and under which pillar. No credits.
    const fit: BriefFit = await step.run('fit', async () => {
      await beat(caseId, jobStartedAt, 'fit')
      const bible = await currentBible(db, channelId)
      const input: FitInput = { bible, subject }
      if (mockProvidersEnabled()) return mockFit(input)
      const answer = await callForAnswer({
        request: buildFitRequest(input),
        parse: (text, note) =>
          parseFit(
            text,
            bible.bible.caseCategories.map((pillar) => pillar.key),
            note,
          ),
        complete,
      })
      return answerOrStop(answer, 'The channel fit could not be read')
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
      return firstOfEach(
        found.data.map((row) => row.keyword),
        (question) => question,
      ).slice(0, QUESTIONS_LIMIT)
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

    // Titles and other languages are kept apart; the target and secondaries are real keywords.
    // Split and picked outside any step, from the memoised keywords, so a parked run replays them
    // the same way.
    const language = loaded.language ?? ''
    const split = splitSearchTerms(keywords, { language })
    const preferred = preferredWords(
      [...(loaded.formatKeywords ?? []), ...(loaded.pillarKeywords ?? [])],
      subject,
    )
    const candidates = pickTargetCandidates(keywords, { preferredWords: preferred, language })
    const skipped: string[] = []

    // 6b. Who ranks now for each candidate: one search a step. The cap ends the group.
    const fieldChecks: FieldCheck[] = []
    for (const [at, found] of candidates.entries()) {
      const check = await step.run(`field-${at}`, async () => {
        await beat(caseId, jobStartedAt, `field-${at}`)
        return optional('the field check', () => searchField(found.keyword, channelId))
      })
      if (isCapped(check)) {
        skipped.push(`field check: ${CAP_REACHED}`)
        break
      }
      if (check !== null) fieldChecks.push(check)
    }
    // The first candidate whose field is not a cross; else the first. A candidate with no check
    // is not a cross: nothing was measured against it.
    const checkOf = (keyword: string) => fieldChecks.find((check) => check.keyword === keyword)
    const target: SearchKeyword | null =
      candidates.find((found) => {
        const check = checkOf(found.keyword)
        return check === undefined || fieldCompetition(check) !== 'bad'
      }) ??
      candidates[0] ??
      null
    const secondary = split.keywords
      .filter((row) => row.keyword !== target?.keyword)
      .sort(byOverall)
      .slice(0, SECONDARY_KEPT)
    const targetCheck = target === null ? undefined : checkOf(target.keyword)
    // App-computed text only: nothing VidIQ wrote reaches the angle prompt through here.
    const fieldSummary =
      target === null || targetCheck === undefined
        ? null
        : `${openDoors(targetCheck)} open ${openDoors(targetCheck) === 1 ? 'door' : 'doors'} in the top ten for ${target.keyword}; the field is ${
            isStaleField(targetCheck, new Date(targetCheck.checkedAt)) ? 'stale' : 'recent'
          }`

    // 6c. What viewers of the top winning videos asked for: one video's comments a step.
    const gathered: Awaited<ReturnType<typeof readComments>> = []
    let videosRead = 0
    for (const [at, video] of winning.slice(0, COMMENT_VIDEOS).entries()) {
      const read = await step.run(`comments-${at}`, async () => {
        await beat(caseId, jobStartedAt, `comments-${at}`)
        return optional('reading comments', () => readComments(video.videoId, channelId))
      })
      if (isCapped(read)) {
        skipped.push(`comments: ${CAP_REACHED}`)
        break
      }
      if (read === null) continue
      videosRead += 1
      gathered.push(...read)
    }
    const commentThemes: CommentTheme[] =
      gathered.length === 0
        ? []
        : await step.run('comment-themes', async () => {
            await beat(caseId, jobStartedAt, 'comment-themes')
            // Optional like the reading: a failed themes pass loses the themes, not the run.
            try {
              const input: CommentThemesInput = {
                bible: await currentBible(db, channelId),
                subject,
                comments: gathered,
              }
              if (mockProvidersEnabled()) return mockCommentThemes(input)
              const answer = await callForAnswer({
                request: buildCommentThemesRequest(input),
                parse: (text, note) => parseCommentThemes(text, input, note),
                complete,
              })
              return answerOrStop(answer, 'The comment themes could not be read')
            } catch (error) {
              console.error('[case-researcher] the comment themes failed', error)
              return []
            }
          })

    // 6d. What the winning titles share, and what they already tell.
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
        commentThemes,
        fieldSummary,
      }
      if (mockProvidersEnabled()) return mockAngleOptions(input)
      const answer = await callForAnswer({
        request: buildAngleOptionsRequest(input),
        parse: (text, note) => parseAngleOptions(text, input, note),
        complete,
      })
      return answerOrStop(answer, 'The angle options could not be read')
    })

    /** The brief as the save step writes it, from the same values the rating reads. */
    const candidate = (rating: AngleRating | null, tests: NicheTest[] = []) => ({
      subject,
      measuredAt: new Date().toISOString(),
      targetKeyword: target,
      secondaryKeywords: secondary.slice(0, SECONDARY_KEPT),
      searchedQuestions: questions.slice(0, QUESTIONS_LIMIT),
      outliers: winning.slice(0, OUTLIERS_KEPT),
      titlePatterns: winners.titlePatterns.slice(0, TITLE_PATTERNS_MAX),
      toldAlready: winners.toldAlready.slice(0, TOLD_ALREADY_MAX),
      angleOptions: angleOptions.slice(0, ANGLE_OPTIONS_MAX),
      chosenAngle: null,
      formatKey: loaded.formatKey ?? null,
      fit,
      searchedTitles: split.searchedTitles,
      otherLanguages: split.otherLanguages,
      recommendedAngle: rating?.recommended ?? null,
      recommendationReason: rating?.reason ?? null,
      ownAngle: false,
      language,
      ...(understood.niche === '' ? {} : { niche: understood.niche }),
      offIntent,
      fieldChecks,
      commentThemes,
      commentsRead: { videos: videosRead, comments: gathered.length },
      nicheTests: tests.slice(0, 3),
      skipped: skipped.slice(0, 6),
    })

    // 7b. Which angle to recommend. A failure never loses the run: the brief is saved with no
    // recommendation, and the owner can press Rate the angles.
    const rating: AngleRating | null = await step.run('rate-angles', async () => {
      await beat(caseId, jobStartedAt, 'rate-angles')
      if (angleOptions.length < 2) return null
      const parsed = SearchBriefSchema.safeParse(candidate(null))
      if (!parsed.success) return null
      try {
        const rated = await rateAngles(parsed.data, await currentBible(db, channelId), complete)
        if (rated.ok) return rated.rating
        console.error('[case-researcher] the angle rating failed', rated.error)
      } catch (error) {
        console.error('[case-researcher] the angle rating failed', error)
      }
      return null
    })

    // 7c. A niche test of the recommended angle: one purchase to start, then a free wait. Skipped
    // with no recommendation or no niche; a cap, a failure or no answer in time is recorded.
    const nicheTests: NicheTest[] = []
    const recommended = rating === null ? undefined : angleOptions[rating.recommended]
    if (recommended !== undefined && understood.niche !== '') {
      const started = await step.run('niche-start', async () => {
        await beat(caseId, jobStartedAt, 'niche-start')
        return optional('the niche test', () =>
          startNicheTest(
            {
              niche: understood.niche,
              idea: recommended.angle,
              ...(language === '' ? {} : { language }),
            },
            channelId,
          ),
        )
      })
      if (isCapped(started)) skipped.push(`niche test: ${CAP_REACHED}`)
      else if (started === null) skipped.push('niche test: no result')
      else {
        const test = await step.run('niche-wait', async () => {
          await beat(caseId, jobStartedAt, 'niche-wait')
          return optional('waiting for the niche test', () =>
            awaitNicheTest(started, recommended.angle),
          )
        })
        if (test === null || isCapped(test)) skipped.push('niche test: no result')
        else nicheTests.push(test)
      }
    }

    // 8. The brief, written once, and only while this run still owns the job.
    const saved = await step.run('save-brief', async () => {
      await beat(caseId, jobStartedAt, 'save-brief')
      // Each list is cut to the brief's own limit first, so a long model answer
      // cannot fail the parse after every credit is spent.
      const parsed = SearchBriefSchema.safeParse(candidate(rating, nicheTests))
      // A retry would fail the same way, so the run stops with a reason the owner can read.
      if (!parsed.success) {
        throw new NonRetriableError(
          'The research result did not fit the brief format, so nothing was saved.',
        )
      }
      const brief: SearchBrief = parsed.data
      return saveCaseSearchBrief(db, caseId, brief, jobStartedAt)
    })
    if (!saved) return { outcome: 'superseded' as const }

    return { outcome: 'researched' as const, outliers: winning.length }
  },
)
