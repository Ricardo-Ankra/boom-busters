import {
  channelForProject,
  getProject,
  latestScriptParagraphSources,
  listLogos,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import {
  buildCriticRequest,
  buildGraphicRequest,
  estimatedWords,
  exemplarFor,
  parseCriticReport,
  parseGraphicCode,
  techniqueFor,
  wordsInSlot,
  type CriticPlan,
  type CriticReference,
  type GraphicDesignInput,
  type LLMTaskRequest,
  type MsgImage,
  type ReviewFrame,
  type ScriptClaim,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  DEFAULT_MOTION_IDENTITY,
  graphicIntentOf,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  BibleInUse,
  CriticReport,
  MotionIdentity,
  ChartBrief,
  DesignableBrief,
  GraphicCode,
  LogoIndex,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import type { GraphicProps } from '@boom-busters/compositions/graphic-code-pure'
import { NonRetriableError } from 'inngest'
import { callForAnswer, type AnswerComplete } from '@/lib/answer'
import { dryRunProps, graphicCodeIssue } from '@/lib/graphic-code/check'
import {
  denseMoments,
  FramesUnavailable,
  INSPECT_MAX_MS,
  type FrameShot,
  type FramesResult,
  type GraphicFrames,
} from '@/lib/graphic-code/frames'
import { motionMetrics } from '@/lib/graphic-code/motion-metrics'
import { ensureGraphicCompiler } from '@/lib/graphic-code/compile'
import { ensureDryRunRuntime } from '@/lib/graphic-code/dry-run'
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
 * source and title, and the preamble version it carries, whose absence tells
 * the designer the design predates the motion tokens (decision 301). Its facts
 * are not passed; the designer cites claims afresh from the numbered list, and
 * the checks hold it to them.
 */
function currentDesign(code: GraphicCode): NonNullable<GraphicDesignInput['current']> {
  return {
    source: code.source,
    title: code.title,
    ...(code.motion !== undefined ? { motion: code.motion } : {}),
  }
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
/**
 * What an inspection leaves of the deadline, for the step to write its
 * outcome; with less than `FRAMES_MIN_MS` to spend, no inspection starts and
 * the design is kept on the dry run's word.
 */
const FRAMES_MARGIN_MS = 20_000
const FRAMES_MIN_MS = 10_000

const frameLabel = (shot: FrameShot) =>
  `${shot.orientation === 'landscape' ? '16:9' : '9:16'} at ${(shot.atMs / 1000).toFixed(1)} s`

/** The facts as the designer cites them, by number in the claim list, from the ids a design stores. */
function plannedFacts(
  code: GraphicCode,
  context: GraphicDesignContext,
): PlannedGraphicCode['facts'] {
  return code.facts.map((fact) => ({
    text: fact.text,
    claim: context.claims.findIndex((claim) => claim.id === fact.claimId) + 1,
  }))
}

const CUT_OFF_ISSUE = "the designer's answer was cut off at its length limit"
// A graphic's card says Redesign graphic and a chart's Redesign chart.
const TOO_LONG_ISSUE = 'the designer took too long; press Redesign to try again'

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

/** What every graphics call shares for a slot: the request's base and what the checks read. */
function designInput(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: { bible: BibleInUse; motion?: MotionIdentity; guidance?: string; redesign?: boolean },
): {
  base: GraphicDesignInput
  checkSlot: { brief: DesignableBrief; durationMs: number; words: { text: string; atMs: number }[] }
} {
  const { brief } = slot
  const motion = options.motion ?? DEFAULT_MOTION_IDENTITY
  const { intent, intentRefs } = slotIntent(context, brief)
  const narration = slotNarration(context, slot)
  // The same words the prompt lists, as the dry run hands them to the code.
  const words = narration.words.map((word) => ({ text: word.text, atMs: word.offsetMs }))

  // The slot's exemplar (decision 305): the technique from the brief, the
  // logo titles and the steer; absent while the corpus holds no design for it.
  const exemplar = exemplarFor(
    techniqueFor({
      type: brief.type,
      ...(brief.type === 'chart'
        ? {
            chartKind: brief.chartKind,
            seriesCount: brief.series.length,
            xLabels: brief.series[0]?.points.map((point) => point.x) ?? [],
          }
        : {}),
      intent,
      description: brief.description,
      coversText: brief.coversText,
      logos: context.logos.map((logo) => logo.title),
      techniques: motion.techniques,
      ...(options.guidance ? { guidance: options.guidance } : {}),
    }),
  )

  const base: GraphicDesignInput = {
    bible: options.bible,
    motion,
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
    ...(exemplar ? { exemplar } : {}),
    // A scene from before decision 295 is not shown: the designer writes code
    // from the intent, and the scene stays on the brief untouched.
    ...(options.redesign && brief.code ? { current: currentDesign(brief.code) } : {}),
    ...(options.guidance ? { guidance: options.guidance } : {}),
  }
  return { base, checkSlot: { brief, durationMs: slot.durationMs, words } }
}

/** What the browser options are, for the design and the review alike (decision 389). */
interface FramesOptions {
  /**
   * The browser: with it, a design must also pass the layout check, and the
   * review can see it. Without it, or when it cannot start, the design is
   * kept on the dry run's word, as before.
   */
  frames?: GraphicFrames
  /** The project's brand, so the browser measures the type in the film's faces; the house brand otherwise. */
  brand?: GraphicProps['brand']
  /**
   * Told each refusal, review outcome, skip and failure, one line each, so the
   * app's logs say what the designer did (decision 389's follow-up).
   */
  log?: (line: string) => void
}

/**
 * The browser for one design or one review, until it fails once: then the
 * rest goes on without it, logged. Each inspection is bounded by the
 * deadline, less a margin for the step to write its outcome; with too little
 * left, none starts.
 */
function inspector(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming,
  checkSlot: ReturnType<typeof designInput>['checkSlot'],
  options: FramesOptions,
  deadline: number,
) {
  let framesDown = !options.frames
  return async (
    code: GraphicCode,
    mode: {
      shots: boolean
      measure: boolean | 'findings'
      dense?: readonly number[]
      sheets?: boolean
    },
  ): Promise<FramesResult | null> => {
    if (framesDown || !options.frames) return null
    const left = deadline - Date.now() - FRAMES_MARGIN_MS
    if (left < FRAMES_MIN_MS) return null
    try {
      return await options.frames.inspect({
        compiled: code.compiled,
        props: dryRunProps(context, checkSlot, options.brand),
        durationMs: slot.durationMs,
        ...mode,
        timeoutMs: Math.min(INSPECT_MAX_MS, left),
      })
    } catch (error) {
      if (!(error instanceof FramesUnavailable)) throw error
      framesDown = true
      options.log?.(`without the browser: ${error.message}`)
      return null
    }
  }
}

/**
 * The whole real-model path: the attempts, the cut-off doubling, the
 * deadline and the checks. `complete` is injected, so the tests drive every
 * branch without a model and the app hands it the ledgered `callLlm`; it is
 * handed the deadline's abort signal. The review is not here: it runs in a
 * step of its own (`reviewGraphicWith`), since a design and its retry can use
 * most of this step's time on their own.
 */
export async function designGraphicWith(
  complete: GraphicCompleteFn,
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: {
    bible: BibleInUse
    /** The channel's motion identity (spec 2026-11-04): the prompt's taste, the tokens and the still limit; the house one when absent. */
    motion?: MotionIdentity
    guidance?: string
    redesign?: boolean
  } & FramesOptions,
): Promise<GraphicDesignResult> {
  // The checks load React, react-dom/server and Remotion at run time and
  // compile with esbuild's native binary. A host that cannot do either is
  // found here, before any model call, and not retried: a retry would pay the
  // model again to fail on the same require or the same missing binary.
  try {
    ensureDryRunRuntime()
    ensureGraphicCompiler()
  } catch (error) {
    throw new NonRetriableError(error instanceof Error ? error.message : String(error))
  }
  const { base, checkSlot } = designInput(context, slot, options)

  const deadline = Date.now() + GRAPHIC_DESIGN_DEADLINE_MS
  const call: AnswerComplete = async (request, label) => {
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) throw new DesignEnded(TOO_LONG_ISSUE)
    return complete(request, {
      signal: AbortSignal.timeout(remaining),
      ...(label === 'answer' ? {} : { purpose: label }),
    })
  }
  const inspect = inspector(context, slot, checkSlot, options, deadline)
  const refuse = (issue: string): never => {
    options.log?.(`refused: ${issue}`)
    throw new ValidationError(issue, { field: 'graphic code' })
  }

  try {
    // At most two calls (decision 292): the checks refuse a design inside the
    // parse (scan, compile, dry run, facts; decision 295; then the browser's
    // layout, decision 389), so a refusal is retried once with its reason and
    // a cut-off once at double the budget, then the design stops. A trimmed
    // title is reported through `note` (decision 293).
    const answer = await callForAnswer({
      request: buildGraphicRequest(base),
      parse: async (text, note) => {
        const checked = graphicCodeIssue(parseGraphicCode(text, note), context, checkSlot, {
          motion: options.motion ?? DEFAULT_MOTION_IDENTITY,
        })
        if ('issue' in checked) return refuse(checked.issue)
        const inspected = await inspect(checked.code, { shots: false, measure: true })
        if (inspected?.layoutIssue) return refuse(inspected.layoutIssue)
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

/** What a review made of a design: kept or revised, the design to store; or why it did not run. */
export type GraphicReviewResult =
  { outcome: 'kept' | 'revised'; code: GraphicCode } | { outcome: 'skipped'; reason: string }

export type { CriticReference }

/** The fix call starts only with this much of the deadline left: a designer's answer takes a minute or more. */
const FIX_MIN_MS = 60_000

/** The producer's steer for the fix: the redesign's own steer first, then the critic's fixes in order. */
export function criticSteer(fixes: readonly string[], guidance?: string): string {
  const listed = fixes.map((fix, index) => `${index + 1}. ${fix}`).join(' ')
  const critic = `The critic's fixes, in order: ${listed}`
  return guidance ? `${guidance}\n${critic}` : critic
}

/**
 * The review (decision 389), a critic since spec 2026-11-04 section 10.4,
 * in a step of its own after the design is stored: the design photographed
 * in the browser at the moments a viewer reads it and through its moves,
 * its motion measured, then one call to the critic on its own route, shown
 * the plan, the numbers, the findings, the channel's look references and
 * the pictures. A keep stores the report; a report with fixes is applied by
 * one designer call with the fixes as the producer's steer, checked as any
 * design is (the layout included), and replaces the design only if it
 * passes, marked `revised`. Nothing here can lose a stored design: no
 * browser, a failed call, a malformed report, a budget stop or the clock
 * leave it as it was, and the reason is logged and returned.
 */
export async function reviewGraphicWith(
  complete: GraphicCompleteFn,
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: {
    bible: BibleInUse
    motion?: MotionIdentity
    guidance?: string
    /** The channel's look references the critic is shown, at most two, loaded by the app. */
    references?: readonly CriticReference[]
  } & FramesOptions,
): Promise<GraphicReviewResult> {
  const skipped = (reason: string): GraphicReviewResult => {
    options.log?.(`review skipped: ${reason}`)
    return { outcome: 'skipped', reason }
  }
  const code = slot.brief.code
  if (!code) return skipped('the slot has no design')
  try {
    ensureDryRunRuntime()
    ensureGraphicCompiler()
  } catch (error) {
    return skipped(error instanceof Error ? error.message : String(error))
  }
  const motion = options.motion ?? DEFAULT_MOTION_IDENTITY
  const { base, checkSlot } = designInput(context, slot, options)
  const deadline = Date.now() + GRAPHIC_DESIGN_DEADLINE_MS
  const inspect = inspector(context, slot, checkSlot, options, deadline)
  const image = (data: string): MsgImage => ({ mimeType: 'image/jpeg', data })

  try {
    // Photographed only: a design stored before the layout check is still
    // shown its frames, and the review is where it gets fixed. The dense set
    // and the sheets are best effort; the rest shots are what the critic needs.
    const photographed = await inspect(code, {
      shots: true,
      measure: 'findings',
      dense: denseMoments(slot.durationMs),
      sheets: true,
    })
    if (!photographed || photographed.shots.length === 0) return skipped('no frames to show')
    const metrics = await motionMetrics(photographed.dense, slot.durationMs, motion.stillMaxMs)
    const frames: ReviewFrame[] = photographed.shots.map((shot) => ({
      label: frameLabel(shot),
      image: image(shot.jpeg),
    }))
    const plan: CriticPlan = {
      ...(code.concept ? { concept: code.concept } : {}),
      ...(code.storyboard ? { storyboard: code.storyboard } : {}),
      title: code.title,
      facts: plannedFacts(code, context),
      ...(code.mechanisms ? { mechanisms: code.mechanisms } : {}),
    }
    let remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) return skipped('no time left for the call')
    const reply = await complete(
      buildCriticRequest({
        motion,
        plan,
        slot: { durationMs: slot.durationMs, intent: base.intent, words: base.words },
        metrics,
        findings: photographed.findings,
        sheets: {
          ...(photographed.sheets.landscape
            ? { landscape: image(photographed.sheets.landscape) }
            : {}),
          ...(photographed.sheets.portrait
            ? { portrait: image(photographed.sheets.portrait) }
            : {}),
        },
        frames,
        references: options.references ?? [],
      }),
      { signal: AbortSignal.timeout(remaining), purpose: 'critic' },
    )
    let report: CriticReport
    try {
      report = parseCriticReport(reply.text)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      options.log?.(`review kept the design: the critic's report was malformed: ${error.message}`)
      return { outcome: 'kept', code: { ...code, review: 'kept' } }
    }
    const kept = (why: string): GraphicReviewResult => {
      options.log?.(`review kept the design: ${why}`)
      return { outcome: 'kept', code: { ...code, review: 'kept', critique: report } }
    }
    if (report.keep || report.fixes.length === 0) return kept('the critic kept it')
    remaining = deadline - Date.now()
    if (remaining < FIX_MIN_MS) return kept('no time left for the fix')
    // The fix call is held short of the deadline by what its browser check
    // needs, so a passing fix is always checked (final review, issue 4); a
    // call that fails for any reason keeps the design and its paid report
    // (final review, issue 10).
    let fixReply: Awaited<ReturnType<GraphicCompleteFn>>
    try {
      fixReply = await complete(
        buildGraphicRequest({
          ...base,
          current: currentDesign(code),
          guidance: criticSteer(report.fixes, options.guidance),
        }),
        {
          signal: AbortSignal.timeout(
            Math.max(MIN_CALL_MS, remaining - FRAMES_MARGIN_MS - FRAMES_MIN_MS),
          ),
          purpose: 'fix',
        },
      )
    } catch (error) {
      return kept(`the fix call failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    let checked: ReturnType<typeof graphicCodeIssue>
    try {
      checked = graphicCodeIssue(parseGraphicCode(fixReply.text), context, checkSlot, { motion })
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      return kept(`the fix was refused: ${error.message}`)
    }
    if ('issue' in checked) return kept(`the fix was refused: ${checked.issue}`)
    const inspected = await inspect(checked.code, { shots: false, measure: true })
    if (inspected === null) return kept('the fix could not be checked in the browser')
    if (inspected.layoutIssue) return kept(`the fix was refused: ${inspected.layoutIssue}`)
    options.log?.('review revised the design')
    return { outcome: 'revised', code: { ...checked.code, review: 'revised', critique: report } }
  } catch (error) {
    return skipped(`the review failed: ${error instanceof Error ? error.message : String(error)}`)
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
  const { channelId, format } = await channelForProject(database, projectId)
  const [sources, takes, claims, logos] = await Promise.all([
    latestScriptParagraphSources(database, projectId),
    listVoiceTakes(database, projectId),
    scriptableClaims(database, projectId),
    listLogos(database, channelId),
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
    paragraphs: timedParagraphs({
      chapters: sources.chapters,
      takes,
      wordsPerMinute: format.wordsPerMinute,
    }),
    chapterTitle: chapter?.title ?? '',
  }
}
