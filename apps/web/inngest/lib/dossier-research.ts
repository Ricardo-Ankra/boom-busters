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
import type { CorpusDocument, LLMTaskRequest, PassPart, Repair } from '@boom-busters/providers'
import type {
  CaseBrief,
  GroundedClaim,
  GroundedResearch,
  ResearchAnswer,
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
 * The claims and answers passes run as two such answers each (`PARTS`).
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
 * How many steps the claims and answers passes each run as. One step writing
 * forty quoted claims took up to 319 s in the first live back-test, over the
 * 300 s an Inngest step has; half the output per step brings each inside it.
 */
const PARTS = 2

/**
 * `count` items numbered 1..count as `parts` contiguous ranges, inclusive,
 * the earlier ranges one longer where the count does not divide evenly. Fewer
 * ranges when there are fewer items than parts, so no part is asked about
 * nothing, and none for no items.
 */
export function splitRange(count: number, parts: number): { from: number; to: number }[] {
  const ranges = Math.max(0, Math.min(count, parts))
  const out: { from: number; to: number }[] = []
  let from = 1
  for (let at = 0; at < ranges; at++) {
    const size = Math.floor(count / ranges) + (at < count % ranges ? 1 : 0)
    out.push({ from, to: from + size - 1 })
    from += size
  }
  return out
}

/**
 * A pass run as one step per range, in order, each step's value kept apart
 * with the part that wrote it, for the caller to merge. A budget gate from
 * any part stops the rest, as it stops the passes after a gated one. Repairs
 * keep part order.
 */
async function inParts<T>(
  ranges: readonly { from: number; to: number }[],
  step: (part: PassPart) => Promise<Guarded<T>>,
): Promise<Guarded<{ part: PassPart; value: T }[]>> {
  const values: { part: PassPart; value: T }[] = []
  const repairs: Repair[] = []
  for (const [at, range] of ranges.entries()) {
    const part = { index: at + 1, of: ranges.length, ...range }
    const result = await step(part)
    if (!result.ok) return result
    values.push({ part, value: result.value })
    // Read with a default, as every pass's repairs are (spec 5.1).
    repairs.push(...(result.repairs ?? []))
  }
  return { ok: true, value: values, repairs }
}

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
    async (): Promise<Guarded<CaseBrief> & { split?: boolean }> => {
      const result: Guarded<CaseBrief> = mocked
        ? { ok: true, value: mockBrief(caseContext) }
        : await guarded('The research brief could not be written', () =>
            callForAnswer({
              request: noted(buildBriefRequest(caseContext, corpus)),
              parse: parseBrief,
              complete,
            }),
          )
      return { ...result, split: true }
    },
  )
  if (!brief.ok) return stopped(brief.gate)

  // A brief stored before the claims and answers passes were split has no
  // `split` mark. Its run (one parked at the gate across the deploy) stored
  // one step per pass, so it replays those ids: new part ids would call the
  // model again for results the stored grounding then ignores.
  const split = brief.split === true
  const parts = split ? PARTS : 1
  const stepId = (pass: 'claims' | 'answers', part: PassPart) =>
    split ? `research-${pass}-${round}-${part.index}` : `research-${pass}-${round}`

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

  // Each part owns the claims whose first support lies in its share of the
  // documents, so the parts rarely overlap; what overlap there is goes below.
  const claimParts = await inParts(splitRange(documents.length, parts), (part) =>
    steps.run(stepId('claims', part), async (): Promise<Guarded<ResearchClaim[]>> => {
      // The mock claims cite every mock document, so the first part has them all.
      if (mocked) return { ok: true, value: part.index === 1 ? mockClaims() : [] }
      return guarded('The claims could not be extracted', () =>
        callForAnswer({
          request: noted(buildClaimsRequest(caseContext, corpus, brief.value, scenes.value, part)),
          parse: parseClaims,
          complete,
        }),
      )
    }),
  )
  if (!claimParts.ok) return stopped(claimParts.gate)
  // A later part's claims minus any an earlier part already wrote: a claim
  // whose first support was misnumbered can come back from both.
  const [firstClaims = [], ...laterClaims] = claimParts.value.map(({ value }) => value)
  const claims = laterClaims.reduce(
    (merged, next) => [...merged, ...dedupeAgainst(merged, next)],
    firstClaims,
  )
  // An empty part is an answer; an empty pass is not. A dossier with no claim
  // would count as clean at the gate and auto-approve, so the stage stops,
  // worded as `guarded` words a pass that failed so the notice reads alike.
  if (claims.length === 0 && !mocked) {
    throw new NonRetriableError(
      'The claims could not be extracted: no part found a claim in the documents',
    )
  }

  // Pass 4 (decision 201): the brief's own open questions, answered from the
  // documents, split by question. No step when the brief raised none: there
  // is nothing to spend on.
  const answerParts = await inParts(splitRange(brief.value.openQuestions.length, parts), (part) =>
    steps.run(stepId('answers', part), async (): Promise<Guarded<ResearchAnswers>> => {
      if (mocked) {
        // Each part answers only its own questions, as a real part is told to.
        const mock = mockAnswers(brief.value)
        const own = (index: number | undefined) =>
          index !== undefined && index >= part.from && index <= part.to
        return {
          ok: true,
          value: {
            answers: mock.answers.filter((answer) => own(answer.index)),
            claims: part.index === 1 ? mock.claims : [],
          },
        }
      }
      return guarded('The open questions could not be answered', () =>
        callForAnswer({
          request: noted(buildAnswersRequest(caseContext, corpus, brief.value, scenes.value, part)),
          parse: parseAnswers,
          complete,
        }),
      )
    }),
  )
  if (!answerParts.ok) return stopped(answerParts.gate)
  const answers: ResearchAnswers = {
    answers: answerParts.value.flatMap(({ part, value }) =>
      value.answers.map((answer) => placeable(answer, part)),
    ),
    claims: answerParts.value.flatMap(({ value }) => value.claims),
  }

  // Read with a default: a run parked before the deploy replays step results
  // stored without `repairs` (spec 5.1).
  const passRepairs: Repair[] = [
    ...(brief.repairs ?? []),
    ...(scenes.repairs ?? []),
    ...(claimParts.repairs ?? []),
    ...(answerParts.repairs ?? []),
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
        claims: [...claims, ...dedupeAgainst(claims, answers.claims)],
        answers: answers.answers,
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

/**
 * An answer numbered outside its part's questions answered one it was not
 * given, or numbered its own list from 1. Either way the number would place
 * it under the wrong question, so it is dropped and the renderer places the
 * answer by its question text instead.
 */
function placeable(answer: ResearchAnswer, part: PassPart): ResearchAnswer {
  if (answer.index === undefined || (answer.index >= part.from && answer.index <= part.to)) {
    return answer
  }
  const { index, ...rest } = answer
  void index
  return rest
}

/** Claims from a later call minus the ones an earlier call already produced. */
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
      brief: {
        currentStatus: null,
        summary: '',
        turningPoint: '',
        cast: [],
        toldAlready: [],
        openQuestions: [],
      },
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
 * The stop when nothing could be read. Four passes over an empty corpus would
 * spend on a dossier with nothing to cite, so the stage fails and says why.
 */
export const EMPTY_CORPUS_MESSAGE =
  'No documents could be gathered for this case. Add competitor links or check the case title.'

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
