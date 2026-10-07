import type { Database } from '@boom-busters/db'
import { mockGraphicScene, mockProvidersEnabled } from '@boom-busters/providers'
import type { GraphicBrief } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import {
  designGraphicWith,
  loadGraphicContextFrom,
  sceneIssue,
  slotIntent,
  type GraphicDesignContext,
  type GraphicDesignResult,
  type GraphicSlotTiming,
} from '@/lib/graphic-design-core'

/**
 * The graphics designer, as the app calls it (decision 289): the pipeline's
 * per-graphic step, Redesign graphic and a retype to graphic all come here,
 * so a graphic is designed one way whichever button asked.
 *
 * The attempts, deadline and checks live in `graphic-design-core.ts`, which
 * takes the model call as a parameter so the live harness can run the same
 * path under its own spend cap. This file binds that path to the app's
 * ledgered `callLlm` and its database.
 */

export {
  designGraphicWith,
  GRAPHIC_DESIGN_DEADLINE_MS,
  type GraphicCompleteFn,
  type GraphicDesignContext,
  type GraphicDesignResult,
  type GraphicSlotTiming,
} from '@/lib/graphic-design-core'

export async function designGraphic(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: GraphicBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  if (mockProvidersEnabled()) {
    const { intentRefs } = slotIntent(context, slot.brief)
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

  return designGraphicWith(
    (request, callOptions) => callLlm(request, { projectId: context.projectId, ...callOptions }),
    context,
    slot,
    options,
  )
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

/**
 * What a side job (Redesign, retype) needs to design one graphic, read fresh.
 * `database` defaults to the app's connection; the live harness passes its
 * read-only one.
 */
export async function loadGraphicContext(
  projectId: string,
  chapterId: string,
  database: Database = db,
): Promise<GraphicDesignContext> {
  return loadGraphicContextFrom(database, projectId, chapterId)
}
