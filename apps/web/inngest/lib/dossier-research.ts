import { budgetGateData } from './gates'
import {
  buildAnswersRequest,
  buildBriefRequest,
  buildClaimsRequest,
  buildTimelineRequest,
  mockAnswers,
  mockBrief,
  mockClaims,
  mockTimeline,
  parseAnswers,
  parseBrief,
  parseClaims,
  parseTimeline,
  mockProvidersEnabled,
} from '@boom-busters/providers'
import type { Repair } from '@boom-busters/providers'
import type {
  CaseBrief,
  DraftClaim,
  ResearchAnswer,
  ResearchAnswers,
  TimelineEvent,
} from '@boom-busters/schemas'
import {
  BudgetExceededError,
  UNVERIFIED_CLAIM_WARNING_RATIO,
  isRetriable,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import type { GetStepTools } from 'inngest'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import type { Answer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import type { inngest } from '../client'

type StepTools = GetStepTools<typeof inngest>

/**
 * The four research passes, shared by `dossier-runner` and `dossier-reviser`
 * so a revision is researched exactly the way the first pass was.
 *
 * Everything crossing a step boundary here is plain JSON. Inngest serialises
 * step return values, so an `Error` instance does not survive the trip — it
 * arrives as a shapeless object that `instanceof` will not recognise. The
 * budget gate is therefore passed as `budgetGateData()`, the same plain record
 * the Needs-you card renders from.
 *
 * Each pass is one answer on `callForAnswer` (decision 293): a refused or
 * cut-off pass is asked once more, and what the parser trimmed or dropped
 * travels beside the value as `repairs`, for the notice the save step writes.
 */

export interface CaseContext {
  title: string
  category: string
  angle: string | null
  demandNotes: string | null
}

export interface ResearchResult {
  brief: CaseBrief
  timeline: TimelineEvent[]
  claims: DraftClaim[]
  /** Pass 4's output (decision 201): the open questions, answered or null. */
  answers: ResearchAnswer[]
  /**
   * What the passes repaired (decision 293), in pass order, for the notice on
   * the dossier review. Never missing here: each pass's list is read with a
   * default, since a run parked before the deploy replays results without one.
   */
  repairs: Repair[]
  /** Set when a cap would be crossed; the caller parks on the budget gate. */
  budgetGate?: Record<string, unknown>
}

type Guarded<T> =
  { ok: true; value: T; repairs?: Repair[] } | { ok: false; gate: Record<string, unknown> }

/**
 * `BudgetExceededError` is caught here rather than thrown, because throwing it
 * into Inngest's retry machinery would retry a call the guard has already
 * refused, four more times, to be refused four more times.
 *
 * Everything else the taxonomy calls non-retriable is re-thrown as
 * `NonRetriableError`, which is spec section 7 and was missing. Without it
 * Inngest applied the same four attempts to a `ValidationError`, and a research
 * pass that came back in the wrong shape was paid for five times over before
 * anyone saw it fail. Retrying is for a provider having a bad minute; it is
 * not a way to argue with a schema.
 *
 * The answer itself comes from the helper (decision 293): at most two calls,
 * then `answerOrStop` stops the stage with the reason as a `NonRetriableError`.
 * That is not a `PipelineError`, so `isRetriable` passes it on unchanged.
 */
async function guarded<T>(what: string, ask: () => Promise<Answer<T>>): Promise<Guarded<T>> {
  try {
    const answer = await ask()
    const value = answerOrStop(answer, what)
    return { ok: true, value, repairs: answer.ok ? (answer.repairs ?? []) : [] }
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    if (!isRetriable(error)) {
      throw new NonRetriableError(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? { cause: error } : {},
      )
    }
    throw error
  }
}

const EMPTY_BRIEF: CaseBrief = {
  summary: '',
  turningPoint: '',
  principals: [],
  openQuestions: [],
}

export async function researchDossier(
  step: StepTools,
  input: {
    projectId: string
    caseContext: CaseContext
    /** Distinguishes step ids across revisions, which must not memoise. */
    round: number
    note?: string | undefined
  },
): Promise<ResearchResult> {
  const { projectId, caseContext, round, note } = input
  const mocked = mockProvidersEnabled()
  const complete = completeForProject(projectId)

  const brief = await step.run(`research-brief-${round}`, async (): Promise<Guarded<CaseBrief>> => {
    if (mocked) return { ok: true, value: mockBrief(caseContext) }
    const request = buildBriefRequest(caseContext)
    return guarded('The research brief could not be written', () =>
      callForAnswer({
        request: note
          ? {
              ...request,
              messages: [
                ...request.messages,
                { role: 'user' as const, content: `The human asks for changes: ${note}` },
              ],
            }
          : request,
        parse: parseBrief,
        complete,
      }),
    )
  })
  if (!brief.ok) return { ...empty(), budgetGate: brief.gate }

  const timeline = await step.run(
    `research-timeline-${round}`,
    async (): Promise<Guarded<TimelineEvent[]>> => {
      if (mocked) return { ok: true, value: mockTimeline() }
      return guarded('The research timeline could not be written', () =>
        callForAnswer({
          request: buildTimelineRequest(caseContext, brief.value),
          parse: parseTimeline,
          complete,
        }),
      )
    },
  )
  if (!timeline.ok) return { ...empty(), budgetGate: timeline.gate }

  const claims = await step.run(
    `research-claims-${round}`,
    async (): Promise<Guarded<DraftClaim[]>> => {
      if (mocked) return { ok: true, value: mockClaims() }
      return guarded('The claims could not be extracted', () =>
        callForAnswer({
          request: buildClaimsRequest(caseContext, brief.value, timeline.value),
          parse: parseClaims,
          complete,
        }),
      )
    },
  )
  if (!claims.ok) return { ...empty(), budgetGate: claims.gate }

  // What each pass repaired (decision 293), read with a default: a run parked
  // before the deploy replays step results stored without `repairs` (spec 5.1).
  const repairs: Repair[] = [
    ...(brief.repairs ?? []),
    ...(timeline.repairs ?? []),
    ...(claims.repairs ?? []),
  ]

  // Pass 4 (decision 201): the brief's own open questions, answered from the
  // record before the dossier lands. Skipped entirely when the brief raised
  // none — there is nothing to spend on.
  if (brief.value.openQuestions.length === 0) {
    return {
      brief: brief.value,
      timeline: timeline.value,
      claims: claims.value,
      answers: [],
      repairs,
    }
  }

  const answers = await step.run(
    `research-answers-${round}`,
    async (): Promise<Guarded<ResearchAnswers>> => {
      if (mocked) return { ok: true, value: mockAnswers(brief.value) }
      return guarded('The open questions could not be answered', () =>
        callForAnswer({
          request: buildAnswersRequest(caseContext, brief.value, timeline.value),
          parse: parseAnswers,
          complete,
        }),
      )
    },
  )
  if (!answers.ok) return { ...empty(), budgetGate: answers.gate }

  return {
    brief: brief.value,
    timeline: timeline.value,
    // Facts surfaced while answering join the claim list, minus any the
    // claims pass already extracted — the model repeats itself often enough
    // that without this the review screen would show the same assertion as
    // two rows to triage twice.
    claims: [...claims.value, ...dedupeAgainst(claims.value, answers.value.claims)],
    answers: answers.value.answers,
    repairs: [...repairs, ...(answers.repairs ?? [])],
  }
}

/** Answer-pass claims minus the ones the claims pass already produced. */
function dedupeAgainst(existing: readonly DraftClaim[], candidates: readonly DraftClaim[]) {
  const fold = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  const seen = new Set(existing.map((claim) => fold(claim.text)))
  return candidates.filter((claim) => {
    const key = fold(claim.text)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function empty(): ResearchResult {
  return { brief: EMPTY_BRIEF, timeline: [], claims: [], answers: [], repairs: [] }
}

/** The one-line context the gate card shows (spec section 11.3). */
export function gateSummary(counts: {
  total: number
  unverified: number
  quarantined: number
}): string {
  const parts = [`Dossier ready · ${counts.total} claims`]

  if (counts.unverified > 0) parts.push(`${counts.unverified} unsourced`)
  if (counts.quarantined > 0) parts.push(`${counts.quarantined} quarantined`)

  if (counts.total > 0 && counts.unverified / counts.total > UNVERIFIED_CLAIM_WARNING_RATIO) {
    // Saying so at the gate beats handing over forty amber rows in silence.
    parts.push('research quality is poor — consider re-running')
  }

  return parts.join(' · ')
}
