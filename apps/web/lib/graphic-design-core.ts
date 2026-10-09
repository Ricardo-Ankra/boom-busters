import {
  getProject,
  latestScriptParagraphSources,
  listLogos,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import {
  buildGraphicRequest,
  estimatedWords,
  parseGraphicScene,
  wordsInSlot,
  type GraphicDesignInput,
  type LLMTaskRequest,
  type ScriptClaim,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  graphicIntentOf,
  resolvePlannedScene,
  sceneTimingIssue,
  toPlannedScene,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  GraphicBrief,
  GraphicScene,
  LogoIndex,
  PlannedGraphicScene,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { callForAnswer, type AnswerComplete } from '@/lib/answer'
import { timedParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * The graphics designer's own logic (decision 289), with no database
 * connection, no ledgered model call and no `server-only` import of its own.
 * `graphic-design.ts` binds it to the app's `db` and `callLlm`; the live
 * harness (`scripts/live-graphic-test.ts`) binds it to a read-only connection
 * and a capped Anthropic call, so the harness measures exactly the attempts,
 * cut-off escalation, deadline and checks the pipeline runs.
 */

export interface GraphicDesignContext {
  projectId: string
  caseTitle: string
  claims: readonly ScriptClaim[]
  logos: readonly LogoIndex[]
  paragraphs: readonly TimedParagraph[]
  chapterTitle: string
}

export interface GraphicSlotTiming {
  chapterId: string
  startMs: number
  durationMs: number
}

export type GraphicDesignResult = { ok: true; scene: GraphicScene } | { ok: false; issue: string }

/**
 * Whatever completes a request: the app's ledgered `callLlm`, or a harness's
 * capped call. `purpose` labels a retry in the ledger (decision 292).
 */
export type GraphicCompleteFn = (
  request: LLMTaskRequest,
  options: { signal?: AbortSignal; purpose?: string },
) => Promise<{ text: string; truncated?: boolean }>

/**
 * The paragraphs a slot overlaps, and its words on the slot clock. Exported for
 * the live harness's still measure (decision 290).
 */
export function slotNarration(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: GraphicBrief },
) {
  const end = slot.startMs + slot.durationMs
  const overlapping = context.paragraphs.filter(
    (p) =>
      p.chapterId === slot.chapterId && p.startMs < end && p.startMs + p.durationMs > slot.startMs,
  )
  const timed = wordsInSlot(
    overlapping.flatMap((p) => p.words),
    slot.startMs,
    slot.durationMs,
  )
  return {
    paragraphText: overlapping.map((p) => p.text).join('\n\n') || slot.brief.coversText,
    words: timed.length > 0 ? timed : estimatedWords(slot.brief.coversText, slot.durationMs),
    wordsEstimated: timed.length === 0,
  }
}

/** Why a parsed scene cannot be stored, in the words the retry and the card read. */
export function sceneIssue(
  scene: PlannedGraphicScene,
  context: GraphicDesignContext,
  durationMs: number,
): { scene: GraphicScene } | { issue: string } {
  // Every timing rule (decision 290), stage 1's late entrance first.
  const timing = sceneTimingIssue(scene, durationMs)
  if (timing !== null) return { issue: timing }
  return resolvePlannedScene(scene, context.claims, context.logos)
}

/**
 * The wall time one graphic's design may take, from its start (final review
 * I3). The route's `maxDuration` is 300 s and the worst ladder is two Opus
 * calls (decision 292); a killed invocation is retried and buys every call
 * again, so the ladder stops itself with room left to write the outcome.
 */
export const GRAPHIC_DESIGN_DEADLINE_MS = 240_000
/** Less than this left: a call would only be aborted, so none is started. */
const MIN_CALL_MS = 15_000

const CUT_OFF_ISSUE = "the designer's answer was cut off at its length limit"
const TOO_LONG_ISSUE = 'the designer took too long; press Redesign graphic to try again'

/** The design is over with this issue; no further call can help. */
class DesignEnded extends Error {
  constructor(readonly issue: string) {
    super(issue)
  }
}

/** The intent a slot is designed from, and its claim numbers into the prompt's claim list. */
export function slotIntent(
  context: GraphicDesignContext,
  brief: GraphicBrief,
): { intent: string; intentRefs: number[] } {
  const claimIds = context.claims.map((claim) => claim.id)
  const { intent, claimIds: intentClaimIds } = graphicIntentOf(brief)
  const intentRefs = intentClaimIds.map((id) => claimIds.indexOf(id) + 1).filter((n) => n > 0)
  return { intent, intentRefs }
}

/**
 * The whole real-model path: the attempts, the cut-off doubling, the
 * deadline and the checks. `complete` is the only thing that differs between
 * the app and the live harness; it is handed the deadline's abort signal.
 */
export async function designGraphicWith(
  complete: GraphicCompleteFn,
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: GraphicBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  const claimIds = context.claims.map((claim) => claim.id)
  const { intent, intentRefs } = slotIntent(context, slot.brief)

  const base: GraphicDesignInput = {
    caseTitle: context.caseTitle,
    claims: context.claims,
    logos: context.logos.map((logo) => logo.title),
    chapterTitle: context.chapterTitle,
    coversText: slot.brief.coversText,
    ...slotNarration(context, slot),
    durationMs: slot.durationMs,
    intent,
    intentRefs,
    ...(options.redesign && slot.brief.scene
      ? { current: toPlannedScene(slot.brief.scene, claimIds) }
      : {}),
    ...(options.guidance ? { guidance: options.guidance } : {}),
  }

  const deadline = Date.now() + GRAPHIC_DESIGN_DEADLINE_MS
  const call: AnswerComplete = async (request, label) => {
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) throw new DesignEnded(TOO_LONG_ISSUE)
    return complete(request, {
      signal: AbortSignal.timeout(remaining),
      ...(label === 'answer' ? {} : { purpose: label }),
    })
  }

  try {
    // At most two calls (decision 292): the designer's own checks refuse a
    // scene inside the parse, so a refusal is retried once with its reason
    // and a cut-off once at double the budget, then the design stops.
    const answer = await callForAnswer({
      request: buildGraphicRequest(base),
      parse: (text) => {
        const checked = sceneIssue(parseGraphicScene(text), context, slot.durationMs)
        if ('issue' in checked) {
          throw new ValidationError(checked.issue, { field: 'graphic scene' })
        }
        return checked.scene
      },
      complete: call,
      // The designer's request carries the reason before the producer's
      // steer, which stays the last thing the model reads.
      retryWithReason: (reason) => buildGraphicRequest({ ...base, rejection: reason }),
      cutOffIssue: CUT_OFF_ISSUE,
    })
    return answer.ok ? { ok: true, scene: answer.value } : { ok: false, issue: answer.issue }
  } catch (error) {
    if (error instanceof DesignEnded) return { ok: false, issue: error.issue }
    // A budget stop parks the run whenever it comes. Anything else once the
    // deadline has passed (the abort itself, or a failure that raced it) is
    // the clock's doing: a retried step would only buy the same calls again.
    if (error instanceof BudgetExceededError) throw error
    if (Date.now() >= deadline) return { ok: false, issue: TOO_LONG_ISSUE }
    // Inside the deadline any other failure (provider, a rejected key) goes through.
    throw error
  }
}

/**
 * What a side job (Redesign, retype) needs to design one graphic, read from
 * `database`: the app's connection, or the live harness's read-only one.
 */
export async function loadGraphicContextFrom(
  database: Database,
  projectId: string,
  chapterId: string,
): Promise<GraphicDesignContext> {
  const project = await getProject(database, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const [sources, takes, claims, logos] = await Promise.all([
    latestScriptParagraphSources(database, projectId),
    listVoiceTakes(database, projectId),
    scriptableClaims(database, projectId),
    listLogos(database),
  ])
  const chapter = sources.chapters.find((c) => c.id === chapterId)
  return {
    projectId,
    caseTitle: project.title,
    claims: claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceUrl: claim.sourceUrl,
      confidence: claim.confidence,
      sourceType: claim.sourceType,
    })),
    logos: logos.map((row) => ({ id: row.id, title: row.title ?? '' })),
    paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
    chapterTitle: chapter?.title ?? '',
  }
}
