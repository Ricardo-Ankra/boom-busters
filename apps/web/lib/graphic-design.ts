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
  type ScriptClaim,
} from '@boom-busters/providers'
import {
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

async function complete(context: GraphicDesignContext, input: GraphicDesignInput): Promise<string> {
  const request = buildGraphicRequest(input)
  try {
    return (await callLlm(request, { projectId: context.projectId })).text
  } catch (error) {
    // The shot list's rule (plan-chapter.ts): a cut-off answer is retried
    // once at double the room, because the same budget is cut off again.
    const cutOff = error instanceof ValidationError && error.field === 'maxTokens'
    if (!cutOff || request.maxTokens >= MAX_OUTPUT_TOKENS) throw error
    const bigger = { ...request, maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2) }
    return (await callLlm(bigger, { projectId: context.projectId })).text
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

  let rejection: string | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await complete(context, rejection ? { ...base, rejection } : base)
    let checked: { scene: GraphicScene } | { issue: string }
    try {
      checked = sceneIssue(parseGraphicScene(text), context, slot.durationMs)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      checked = { issue: error.message }
    }
    if ('scene' in checked) return { ok: true, scene: checked.scene }
    rejection = checked.issue
  }
  return { ok: false, issue: rejection! }
}

/** A brief with the design's outcome on it: a scene, or the reason there is none. */
export function withDesign(brief: GraphicBrief, result: GraphicDesignResult): GraphicBrief {
  const { designIssue: _old, ...rest } = brief
  return result.ok ? { ...rest, scene: result.scene } : { ...rest, designIssue: result.issue }
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
