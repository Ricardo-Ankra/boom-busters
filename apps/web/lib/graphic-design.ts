import {
  getProject,
  latestScriptParagraphSources,
  listLogos,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import {
  buildGraphicRequest,
  estimatedWords,
  MAX_OUTPUT_TOKENS,
  mockGraphicScene,
  mockProvidersEnabled,
  parseGraphicScene,
  wordsInSlot,
  type GraphicDesignInput,
  type LLMTaskRequest,
  type ScriptClaim,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  graphicIntentOf,
  lateEntranceIssue,
  resolvePlannedScene,
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
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { timedParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * The graphics designer, as the app calls it (decision 289): the pipeline's
 * per-graphic step, Redesign graphic and a retype to graphic all come here,
 * so a graphic is designed one way whichever button asked.
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

/** The paragraphs a slot overlaps, and its words on the slot clock. */
function slotNarration(
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
function sceneIssue(
  scene: PlannedGraphicScene,
  context: GraphicDesignContext,
  durationMs: number,
): { scene: GraphicScene } | { issue: string } {
  const timing = lateEntranceIssue(scene, durationMs)
  if (timing !== null) return { issue: timing }
  return resolvePlannedScene(scene, context.claims, context.logos)
}

/**
 * The wall time one graphic's design may take, from its start (final review
 * I3). The route's `maxDuration` is 300 s and the worst ladder is four Opus
 * calls; a killed invocation is retried and buys every call again, so the
 * ladder stops itself with room left to write the outcome.
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

const isCutOff = (error: unknown) => error instanceof ValidationError && error.field === 'maxTokens'

type CallFn = (request: LLMTaskRequest) => Promise<string>
type Parsed = { scene: PlannedGraphicScene } | { issue: string }

/**
 * One call and its parse. A cut-off (an empty reply, which the adapter
 * throws, or a reply that stops inside its JSON, which the parser throws) is
 * passed up for the escalation; any other parse failure is a refusal with its
 * reason.
 */
async function callAndParse(call: CallFn, request: LLMTaskRequest): Promise<Parsed> {
  const text = await call(request)
  try {
    return { scene: parseGraphicScene(text) }
  } catch (error) {
    if (!(error instanceof ValidationError) || isCutOff(error)) throw error
    return { issue: error.message }
  }
}

/**
 * One attempt, with the shot list's cut-off rule (plan-chapter.ts parses
 * inside its escalation too): a cut-off answer is asked once more at double
 * the room, because the same budget is cut off again. A cut-off at the
 * doubled budget ends the design (final review I2): a reason-retry would be
 * cut off a third time and double the wall time.
 */
async function attemptDesign(call: CallFn, input: GraphicDesignInput): Promise<Parsed> {
  const request = buildGraphicRequest(input)
  try {
    return await callAndParse(call, request)
  } catch (error) {
    if (!isCutOff(error)) throw error
    if (request.maxTokens >= MAX_OUTPUT_TOKENS) throw new DesignEnded(CUT_OFF_ISSUE)
    const bigger = { ...request, maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2) }
    try {
      return await callAndParse(call, bigger)
    } catch (retryError) {
      if (isCutOff(retryError)) throw new DesignEnded(CUT_OFF_ISSUE)
      throw retryError
    }
  }
}

export async function designGraphic(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: GraphicBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  const claimIds = context.claims.map((claim) => claim.id)
  const { intent, claimIds: intentClaimIds } = graphicIntentOf(slot.brief)
  const intentRefs = intentClaimIds.map((id) => claimIds.indexOf(id) + 1).filter((n) => n > 0)

  if (mockProvidersEnabled()) {
    const scene = mockGraphicScene({
      claimTexts: context.claims.map((claim) => claim.text),
      intentRefs: intentRefs.length > 0 ? intentRefs : [1],
      logoTitles: context.logos.map((logo) => logo.title),
      ...(options.guidance ? { guidance: options.guidance } : {}),
      durationMs: slot.durationMs,
    })
    const checked = sceneIssue(scene, context, slot.durationMs)
    return 'scene' in checked
      ? { ok: true, scene: checked.scene }
      : { ok: false, issue: checked.issue }
  }

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
  const call: CallFn = async (request) => {
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) throw new DesignEnded(TOO_LONG_ISSUE)
    const options = { projectId: context.projectId, signal: AbortSignal.timeout(remaining) }
    return (await callLlm(request, options)).text
  }

  try {
    let rejection: string | undefined
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const parsed = await attemptDesign(call, rejection ? { ...base, rejection } : base)
      const checked =
        'scene' in parsed ? sceneIssue(parsed.scene, context, slot.durationMs) : parsed
      if ('scene' in checked) return { ok: true, scene: checked.scene }
      rejection = checked.issue
    }
    return { ok: false, issue: rejection! }
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

const DESIGN_ISSUE_MAX = 500

/**
 * An issue as a stored brief can hold it (`designIssue` is at most 500
 * characters; final review I1). A parse failure quoting five schema issues
 * runs longer, and a brief stored over the cap fails every later parse: the
 * card breaks and Redesign disappears. Cut at the last word boundary at or
 * before character 499 and mark the cut.
 */
export function designIssueText(issue: string): string {
  const text = issue.trim()
  if (text.length <= DESIGN_ISSUE_MAX) return text
  // The last whitespace among the first 500 characters: a cut there keeps
  // at most 499, which leaves room for the mark.
  const boundary = text.slice(0, DESIGN_ISSUE_MAX).search(/\s\S*$/)
  const cut = boundary > 0 ? text.slice(0, boundary).trimEnd() : text.slice(0, DESIGN_ISSUE_MAX - 1)
  return `${cut}…`
}

/** A brief with the design's outcome on it: a scene, or the reason there is none. */
export function withDesign(brief: GraphicBrief, result: GraphicDesignResult): GraphicBrief {
  const { designIssue: _old, ...rest } = brief
  return result.ok
    ? { ...rest, scene: result.scene }
    : { ...rest, designIssue: designIssueText(result.issue) }
}

/** What a side job (Redesign, retype) needs to design one graphic, read fresh. */
export async function loadGraphicContext(
  projectId: string,
  chapterId: string,
): Promise<GraphicDesignContext> {
  const project = await getProject(db, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const [sources, takes, claims, logos] = await Promise.all([
    latestScriptParagraphSources(db, projectId),
    listVoiceTakes(db, projectId),
    scriptableClaims(db, projectId),
    listLogos(db),
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
