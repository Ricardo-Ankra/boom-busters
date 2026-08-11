import { budgetGateData } from './gates'
import {
  buildBriefRequest,
  buildClaimsRequest,
  buildTimelineRequest,
  mockBrief,
  mockClaims,
  mockTimeline,
  parseBrief,
  parseClaims,
  parseTimeline,
  mockProvidersEnabled,
} from '@boom-busters/providers'
import type { CaseBrief, DraftClaim, TimelineEvent } from '@boom-busters/schemas'
import {
  BudgetExceededError,
  UNVERIFIED_CLAIM_WARNING_RATIO,
  isRetriable,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import type { GetStepTools } from 'inngest'
import { callLlm } from '@/lib/llm'
import type { inngest } from '../client'

type StepTools = GetStepTools<typeof inngest>

/**
 * The three research passes, shared by `dossier-runner` and `dossier-reviser`
 * so a revision is researched exactly the way the first pass was.
 *
 * Everything crossing a step boundary here is plain JSON. Inngest serialises
 * step return values, so an `Error` instance does not survive the trip — it
 * arrives as a shapeless object that `instanceof` will not recognise. The
 * budget gate is therefore passed as `budgetGateData()`, the same plain record
 * the Needs-you card renders from.
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
  /** Set when a cap would be crossed; the caller parks on the budget gate. */
  budgetGate?: Record<string, unknown>
}

type Guarded<T> = { ok: true; value: T } | { ok: false; gate: Record<string, unknown> }

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
 */
async function guarded<T>(fn: () => Promise<T>): Promise<Guarded<T>> {
  try {
    return { ok: true, value: await fn() }
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

  const brief = await step.run(`research-brief-${round}`, async (): Promise<Guarded<CaseBrief>> => {
    if (mocked) return { ok: true, value: mockBrief(caseContext) }
    return guarded(async () => {
      const request = buildBriefRequest(caseContext)
      return parseBrief(
        (
          await callLlm(
            note
              ? {
                  ...request,
                  messages: [
                    ...request.messages,
                    { role: 'user' as const, content: `The human asks for changes: ${note}` },
                  ],
                }
              : request,
            { projectId },
          )
        ).text,
      )
    })
  })
  if (!brief.ok) return { ...empty(), budgetGate: brief.gate }

  const timeline = await step.run(
    `research-timeline-${round}`,
    async (): Promise<Guarded<TimelineEvent[]>> => {
      if (mocked) return { ok: true, value: mockTimeline() }
      return guarded(async () =>
        parseTimeline(
          (await callLlm(buildTimelineRequest(caseContext, brief.value), { projectId })).text,
        ),
      )
    },
  )
  if (!timeline.ok) return { ...empty(), budgetGate: timeline.gate }

  const claims = await step.run(
    `research-claims-${round}`,
    async (): Promise<Guarded<DraftClaim[]>> => {
      if (mocked) return { ok: true, value: mockClaims() }
      return guarded(async () =>
        parseClaims(
          (
            await callLlm(buildClaimsRequest(caseContext, brief.value, timeline.value), {
              projectId,
            })
          ).text,
        ),
      )
    },
  )
  if (!claims.ok) return { ...empty(), budgetGate: claims.gate }

  return { brief: brief.value, timeline: timeline.value, claims: claims.value }
}

function empty(): ResearchResult {
  return { brief: EMPTY_BRIEF, timeline: [], claims: [] }
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
