import { mockGraphicCode, mockProvidersEnabled } from '@boom-busters/providers'
import type { DesignableBrief } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import {
  chartData,
  designGraphicWith,
  loadGraphicContextFrom,
  slotIntent,
  slotWords,
  type GraphicDesignContext,
  type GraphicDesignResult,
  type GraphicSlotTiming,
} from '@/lib/graphic-design-core'

/**
 * The graphics designer, as the app calls it (decisions 289 and 295): the
 * pipeline's per-design step, Redesign graphic, Redesign chart and a retype
 * to graphic or chart all come here, so a design is made one way whichever
 * button asked.
 *
 * The attempts, deadline and checks live in `graphic-design-core.ts`, which
 * takes the model call and the connection as parameters: it imports nothing
 * `server-only`, so its tests run it against a stubbed call. This file binds
 * that path to the app's ledgered `callLlm` and its database.
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
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  if (mockProvidersEnabled()) {
    // The fixture component (decision 295), through the same scan, compile,
    // dry run and facts as a real answer, so the runners, the retyper and the
    // rebriefer exercise every check without spending. Its figure is the
    // cited claim's own digits, or none (ruling 11), so it passes on any seed.
    const { brief } = slot
    const { intentRefs } = slotIntent(context, brief)
    const planned = mockGraphicCode({
      claimTexts: context.claims.map((claim) => claim.text),
      intentRefs: intentRefs.length > 0 ? intentRefs : [1],
      ...(options.guidance ? { guidance: options.guidance } : {}),
      durationMs: slot.durationMs,
      ...(brief.type === 'chart' ? { data: chartData(brief) } : {}),
    })
    const checked = graphicCodeIssue(planned, context, {
      brief,
      durationMs: slot.durationMs,
      words: slotWords(context, slot),
    })
    return 'code' in checked
      ? { ok: true, code: checked.code }
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

/**
 * A brief with the design's outcome on it (decision 295; ruling 8): a
 * success sets `code` and clears any old `designIssue`; a failure sets
 * `designIssue` and leaves a stored `code` where it is, so a refused
 * redesign keeps the graphic the card already plays.
 */
export function withDesign<B extends DesignableBrief>(brief: B, result: GraphicDesignResult): B {
  if (!result.ok) return { ...brief, designIssue: designIssueText(result.issue) }
  const { designIssue: _old, ...rest } = brief
  // Spreading the rest loses the generic; it is still a B, now with its code.
  return { ...rest, code: result.code } as unknown as B
}

/** What a side job (Redesign, retype) needs to design one graphic or chart, read fresh. */
export async function loadGraphicContext(
  projectId: string,
  chapterId: string,
): Promise<GraphicDesignContext> {
  return loadGraphicContextFrom(db, projectId, chapterId)
}
