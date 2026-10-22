import { budgetGateData } from './gates'
import {
  countClaims,
  listDossierDocuments,
  type ClaimCounts,
  type ClaimRow,
  type Database,
  type DraftClaimInput,
} from '@boom-busters/db'
import {
  buildAnswersRequest,
  buildBriefRequest,
  buildClaimsRequest,
  buildScenesRequest,
  foldText,
  groundResearch,
  mockAnswers,
  mockBrief,
  mockClaims,
  mockScenes,
  mockProvidersEnabled,
  parseAnswers,
  parseBrief,
  parseClaims,
  parseScenes,
  renderCorpus,
  truncateAtParagraph,
  withNote,
} from '@boom-busters/providers'
import type { CorpusDocument, LLMTaskRequest, Repair } from '@boom-busters/providers'
import type {
  CaseBrief,
  GroundedClaim,
  GroundedResearch,
  ResearchAnswers,
  ResearchClaim,
  ResearchEntity,
  Scene,
} from '@boom-busters/schemas'
import {
  BudgetExceededError,
  DOSSIER_DOCUMENT_TOKENS,
  UNVERIFIED_CLAIM_WARNING_RATIO,
  isRetriable,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import type { Answer, AnswerComplete } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import type { Steps } from './steps'

/**
 * The four research passes over the gathered corpus, then the grounding that
 * checks every citation, shared by `dossier-runner` and `dossier-reviser` so a
 * revision is researched exactly the way the first pass was.
 *
 * Everything crossing a step boundary here is plain JSON. Inngest serialises
 * step return values, so an `Error` instance does not survive the trip: it
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

/** How the corpus split at the gather: what the passes read, and what they did not. */
export interface CorpusCounts {
  read: number
  unread: number
  failed: number
}

export interface ResearchResult {
  research: GroundedResearch
  claims: GroundedClaim[]
  /**
   * What the passes and the grounding repaired (decision 293), in pass order,
   * for the notice on the dossier review. Never missing here: each pass's
   * list is read with a default, since a run parked before the deploy
   * replays results without one.
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
 * `NonRetriableError` (spec section 7): retrying is for a provider having a
 * bad minute, not a way to argue with a schema.
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

export async function researchDossier(
  steps: Steps,
  input: {
    projectId: string
    caseContext: CaseContext
    /** Distinguishes step ids across revisions, which must not memoise. */
    round: number
    note?: string | undefined
    entity: ResearchEntity
    /** The read documents in rank order: a citation's number is its position here. */
    documents: readonly CorpusDocument[]
    corpus: CorpusCounts
  },
  deps: { complete?: AnswerComplete; mocked?: boolean } = {},
): Promise<ResearchResult> {
  const { caseContext, round, note, documents } = input
  const mocked = deps.mocked ?? mockProvidersEnabled()
  const complete = deps.complete ?? completeForProject(input.projectId)
  const corpus = renderCorpus(documents)
  // Every pass, not only the brief: a note about the claims is lost if only
  // the brief hears it (spec 5.5).
  const noted = (request: LLMTaskRequest) => (note ? withNote(request, note) : request)
  const stopped = (gate: Record<string, unknown>): ResearchResult => ({
    ...empty(input.entity, input.corpus),
    budgetGate: gate,
  })

  const brief = await steps.run(
    `research-brief-${round}`,
    async (): Promise<Guarded<CaseBrief>> => {
      if (mocked) return { ok: true, value: mockBrief(caseContext) }
      return guarded('The research brief could not be written', () =>
        callForAnswer({
          request: noted(buildBriefRequest(caseContext, corpus)),
          parse: parseBrief,
          complete,
        }),
      )
    },
  )
  if (!brief.ok) return stopped(brief.gate)

  const scenes = await steps.run(
    `research-scenes-${round}`,
    async (): Promise<Guarded<Scene[]>> => {
      if (mocked) return { ok: true, value: mockScenes() }
      return guarded('The scenes could not be written', () =>
        callForAnswer({
          request: noted(buildScenesRequest(caseContext, corpus, brief.value)),
          parse: parseScenes,
          complete,
        }),
      )
    },
  )
  if (!scenes.ok) return stopped(scenes.gate)

  const claims = await steps.run(
    `research-claims-${round}`,
    async (): Promise<Guarded<ResearchClaim[]>> => {
      if (mocked) return { ok: true, value: mockClaims() }
      return guarded('The claims could not be extracted', () =>
        callForAnswer({
          request: noted(buildClaimsRequest(caseContext, corpus, brief.value, scenes.value)),
          parse: parseClaims,
          complete,
        }),
      )
    },
  )
  if (!claims.ok) return stopped(claims.gate)

  // Pass 4 (decision 201): the brief's own open questions, answered from the
  // documents. Skipped when the brief raised none: there is nothing to spend on.
  const answers: Guarded<ResearchAnswers> =
    brief.value.openQuestions.length === 0
      ? { ok: true, value: { answers: [], claims: [] } }
      : await steps.run(
          `research-answers-${round}`,
          async (): Promise<Guarded<ResearchAnswers>> => {
            if (mocked) return { ok: true, value: mockAnswers(brief.value) }
            return guarded('The open questions could not be answered', () =>
              callForAnswer({
                request: noted(buildAnswersRequest(caseContext, corpus, brief.value, scenes.value)),
                parse: parseAnswers,
                complete,
              }),
            )
          },
        )
  if (!answers.ok) return stopped(answers.gate)

  // Read with a default: a run parked before the deploy replays step results
  // stored without `repairs` (spec 5.1).
  const passRepairs: Repair[] = [
    ...(brief.repairs ?? []),
    ...(scenes.repairs ?? []),
    ...(claims.repairs ?? []),
    ...(answers.repairs ?? []),
  ]

  // Grounding folds every document once and searches it for every quote, so it
  // runs in a step of its own: a replay reads the result instead of redoing it.
  const grounded = await steps.run(`research-ground-${round}`, async () => {
    const repairs: Repair[] = []
    const result = groundResearch(
      {
        entity: input.entity,
        brief: brief.value,
        scenes: scenes.value,
        // Facts surfaced while answering join the claim list, minus any the
        // claims pass already extracted: the model repeats itself often enough
        // that the review would otherwise show one assertion as two rows.
        claims: [...claims.value, ...dedupeAgainst(claims.value, answers.value.claims)],
        answers: answers.value.answers,
        documents,
        corpus: input.corpus,
      },
      (repair) => {
        repairs.push(repair)
      },
    )
    return { ...result, repairs }
  })

  return {
    research: grounded.research,
    claims: grounded.claims,
    repairs: [...passRepairs, ...grounded.repairs],
  }
}

const fold = (text: string) => foldText(text).folded

/** Answer-pass claims minus the ones the claims pass already produced. */
function dedupeAgainst(existing: readonly ResearchClaim[], candidates: readonly ResearchClaim[]) {
  const seen = new Set(existing.map((claim) => fold(claim.text)))
  return candidates.filter((claim) => {
    const key = fold(claim.text)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function empty(entity: ResearchEntity, corpus: CorpusCounts): Omit<ResearchResult, 'budgetGate'> {
  return {
    research: {
      entity,
      brief: { summary: '', turningPoint: '', cast: [], toldAlready: [], openQuestions: [] },
      scenes: [],
      answers: [],
      corpus,
    },
    claims: [],
    repairs: [],
  }
}

export interface LoadedCorpus {
  documents: CorpusDocument[]
  corpus: CorpusCounts
}

/**
 * A project's corpus as the passes read it. The rows keep their whole text and
 * nothing on them records the cut, so the per-document cap the ranker budgeted
 * with is applied again here; without it one long filing would blow the
 * corpus budget the ranking was built to hold.
 */
export async function loadCorpus(db: Database, projectId: string): Promise<LoadedCorpus> {
  const rows = await listDossierDocuments(db, projectId)
  const ranked = rows
    .flatMap((row) => (row.rank === null ? [] : [{ row, rank: row.rank }]))
    .sort((a, b) => a.rank - b.rank)
  const failed = rows.filter((row) => row.failure !== null).length

  return {
    documents: ranked.map(({ row }) => ({
      id: row.id,
      url: row.url,
      kind: row.kind,
      title: row.title,
      publishedAt: row.publishedAt,
      text: truncateAtParagraph(row.text, DOSSIER_DOCUMENT_TOKENS).text,
      archivedUrl: row.archivedUrl,
      httpStatus: row.httpStatus,
    })),
    corpus: { read: ranked.length, unread: rows.length - ranked.length - failed, failed },
  }
}

/** The grounded claims as rows: a support's URLs are its document's, so they stay there. */
export function toDraftClaims(claims: readonly GroundedClaim[]): DraftClaimInput[] {
  return claims.map((claim) => ({
    text: claim.text,
    sourceUrl: claim.sourceUrl,
    sourceType: claim.sourceType,
    confidence: claim.confidence,
    legalStatus: claim.legalStatus,
    legalStatusDate: claim.legalStatusDate,
    legalStatusDocumentId: claim.legalStatusDocumentId,
    series: claim.series,
    supports: claim.supports.map((support) => ({
      documentId: support.documentId,
      rank: support.rank,
      quote: support.quote,
      found: support.found,
      offset: support.offset,
      locatorSeconds: support.locatorSeconds,
    })),
  }))
}

/**
 * Whether every claim's primary support rests on a document that was really
 * fetched: a 2xx answer, or a Wayback copy. A claim with no support fails it.
 * Returns how many claims do not, so the gate can say why it parked.
 */
export function unfetchedClaims(
  claims: readonly GroundedClaim[],
  documents: readonly Pick<CorpusDocument, 'id' | 'httpStatus'>[],
): number {
  const status = new Map(documents.map((doc) => [doc.id, doc.httpStatus]))
  return claims.filter((claim) => {
    const primary = claim.supports[0]
    if (!primary) return true
    if (primary.archivedUrl !== null) return false
    const code = status.get(primary.documentId) ?? null
    return code === null || code < 200 || code > 299
  }).length
}

/** The gate's counts: the saved rows' claim counts, and how many rest on an unfetched page. */
export function gateCounts(
  rows: readonly ClaimRow[],
  claims: readonly GroundedClaim[],
  documents: readonly Pick<CorpusDocument, 'id' | 'httpStatus'>[],
): ClaimCounts & { unfetched: number } {
  return { ...countClaims(rows), unfetched: unfetchedClaims(claims, documents) }
}

/**
 * Whether a replayed `load-case` result was stored before the corpus existed:
 * it has no `competitorLinks`. Takes `object` so the check is not narrowed
 * away by today's type, which always has the key.
 */
export function predatesCorpus(loaded: object): boolean {
  return !('competitorLinks' in loaded)
}

/** The one-line context the gate card shows (spec sections 7 and 11.3). */
export function gateSummary(
  counts: { total: number; unverified: number; quarantined: number; unfetched?: number },
  corpus: CorpusCounts,
): string {
  const parts = [`Dossier ready · ${counts.total} claims`]

  if (counts.unverified > 0) parts.push(`${counts.unverified} unsourced`)
  if (counts.quarantined > 0) parts.push(`${counts.quarantined} quarantined`)
  if (counts.unfetched !== undefined && counts.unfetched > 0) {
    parts.push(`${counts.unfetched} resting on a document that was not fetched`)
  }

  if (counts.total > 0 && counts.unverified / counts.total > UNVERIFIED_CLAIM_WARNING_RATIO) {
    // Saying so at the gate beats handing over forty amber rows in silence.
    parts.push('research quality is poor — consider re-running')
  }

  parts.push(
    `${corpus.read} documents read, ${corpus.unread} gathered not read, ${corpus.failed} could not be fetched`,
  )

  return parts.join(' · ')
}
