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
  parseGraphicCode,
  wordsInSlot,
  type GraphicDesignInput,
  type LLMTaskRequest,
  type ScriptClaim,
} from '@boom-busters/providers'
import { BudgetExceededError, graphicIntentOf, ValidationError } from '@boom-busters/schemas'
import type { ChartBrief, DesignableBrief, GraphicCode, LogoIndex } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { callForAnswer, type AnswerComplete } from '@/lib/answer'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { timedParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * The graphics designer's own logic (decisions 289 and 295), with no
 * database connection of its own, no ledgered model call and no
 * `server-only` import: the model call and the connection are parameters.
 * That keeps it testable against a stubbed call, with the attempts, the
 * cut-off doubling, the deadline and the checks in one place.
 * `graphic-design.ts` binds it to the app's `db` and `callLlm`.
 *
 * Since decision 295 the designer writes the graphic as code: one React
 * component, which `graphicCodeIssue` scans, compiles, dry-runs and checks
 * against the cited claims before it is stored as `code` on the brief. A
 * chart is designed the same way, around its brief's own series.
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

export type GraphicDesignResult = { ok: true; code: GraphicCode } | { ok: false; issue: string }

/**
 * Whatever completes a request: the app's ledgered `callLlm`, or a test's
 * stub. `purpose` labels a retry in the ledger (decision 292).
 */
export type GraphicCompleteFn = (
  request: LLMTaskRequest,
  options: { signal?: AbortSignal; purpose?: string },
) => Promise<{ text: string; truncated?: boolean }>

/** The paragraphs a slot overlaps, and its words on the slot clock, as the prompt and the dry run read them. */
export function slotNarration(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
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

/** The slot's words as the code reads them, `props.words` (decision 295). */
export function slotWords(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
): { text: string; atMs: number }[] {
  return slotNarration(context, slot).words.map((word) => ({
    text: word.text,
    atMs: word.offsetMs,
  }))
}

/** What a chart's code reads as `props.data` (decision 295): its series, takeaway and annotations. */
export function chartData(brief: ChartBrief): NonNullable<GraphicDesignInput['data']> {
  return {
    series: brief.series,
    takeaway: brief.takeaway,
    ...(brief.annotations !== undefined ? { annotations: brief.annotations } : {}),
  }
}

/**
 * A stored design as a redesign shows it to the designer (ruling 9): its
 * source and title only. Its facts are not passed; the designer cites claims
 * afresh from the numbered list, and the checks hold it to them.
 */
function currentDesign(code: GraphicCode): NonNullable<GraphicDesignInput['current']> {
  return { source: code.source, title: code.title }
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

/**
 * The intent a slot is designed from, and its claim numbers into the prompt's
 * claim list. A chart's intent is its takeaway, resting on the claims its
 * series come from (decision 295).
 */
export function slotIntent(
  context: GraphicDesignContext,
  brief: DesignableBrief,
): { intent: string; intentRefs: number[] } {
  const claimIds = context.claims.map((claim) => claim.id)
  const { intent, claimIds: intentClaimIds } =
    brief.type === 'chart'
      ? { intent: brief.takeaway, claimIds: brief.dataRefs }
      : graphicIntentOf(brief)
  const intentRefs = intentClaimIds.map((id) => claimIds.indexOf(id) + 1).filter((n) => n > 0)
  return { intent, intentRefs }
}

/**
 * The whole real-model path: the attempts, the cut-off doubling, the
 * deadline and the checks. `complete` is injected, so the tests drive every
 * branch without a model and the app hands it the ledgered `callLlm`; it is
 * handed the deadline's abort signal.
 */
export async function designGraphicWith(
  complete: GraphicCompleteFn,
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  const { brief } = slot
  const { intent, intentRefs } = slotIntent(context, brief)
  const narration = slotNarration(context, slot)
  // The same words the prompt lists, as the dry run hands them to the code.
  const words = narration.words.map((word) => ({ text: word.text, atMs: word.offsetMs }))

  const base: GraphicDesignInput = {
    caseTitle: context.caseTitle,
    claims: context.claims,
    logos: context.logos.map((logo) => logo.title),
    chapterTitle: context.chapterTitle,
    coversText: brief.coversText,
    ...narration,
    durationMs: slot.durationMs,
    intent,
    intentRefs,
    ...(brief.type === 'chart' ? { data: chartData(brief) } : {}),
    // A scene from before decision 295 is not shown: the designer writes code
    // from the intent, and the scene stays on the brief untouched.
    ...(options.redesign && brief.code ? { current: currentDesign(brief.code) } : {}),
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
    // At most two calls (decision 292): the checks refuse a design inside the
    // parse (scan, compile, dry run, facts; decision 295), so a refusal is
    // retried once with its reason and a cut-off once at double the budget,
    // then the design stops. A trimmed title is reported through `note`
    // (decision 293).
    const answer = await callForAnswer({
      request: buildGraphicRequest(base),
      parse: (text, note) => {
        const checked = graphicCodeIssue(parseGraphicCode(text, note), context, {
          brief,
          durationMs: slot.durationMs,
          words,
        })
        if ('issue' in checked) {
          throw new ValidationError(checked.issue, { field: 'graphic code' })
        }
        return checked.code
      },
      complete: call,
      // The designer's request carries the reason before the producer's
      // steer, which stays the last thing the model reads.
      retryWithReason: (reason) => buildGraphicRequest({ ...base, rejection: reason }),
      cutOffIssue: CUT_OFF_ISSUE,
    })
    return answer.ok ? { ok: true, code: answer.value } : { ok: false, issue: answer.issue }
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
 * What a side job (Redesign, retype) needs to design one graphic or chart,
 * read from the connection it is handed, so this module imports no
 * `server-only` database of its own.
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
    // Each mark's recorded size, null when none was (Task 1, ruling 25): the
    // dry run hands the code only the marks the render can size.
    logos: logos.map((row) => ({
      id: row.id,
      title: row.title ?? '',
      width: row.width,
      height: row.height,
    })),
    paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
    chapterTitle: chapter?.title ?? '',
  }
}
