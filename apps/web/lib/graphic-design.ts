import { graphicBrand } from '@boom-busters/compositions/graphic-code-pure'
import { approvedExemplar, channelForProject } from '@boom-busters/db'
import { requireCompleteBible } from '@/inngest/lib/channel'
import {
  exemplarFor,
  mockGraphicCode,
  mockProvidersEnabled,
  type Exemplar,
} from '@boom-busters/providers'
import { resolveBrandKit, resolveMotionIdentity } from '@boom-busters/schemas'
import type { DesignableBrief, TechniqueKey } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { criticReferencesFor } from '@/lib/critic-references'
import { channelTechniquesInUse, exemplarFromApproved } from '@/lib/exemplar-entries'
import { slotTechnique } from '@/lib/graphic-design-core'
import { callLlm } from '@/lib/llm'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { browserFrames } from '@/lib/graphic-code/frames'
import {
  chartData,
  designGraphicWith,
  loadGraphicContextFrom,
  reviewGraphicWith,
  slotIntent,
  slotWords,
  type GraphicCompleteFn,
  type GraphicDesignContext,
  type GraphicDesignResult,
  type GraphicReviewResult,
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
  reviewGraphicWith,
  slotTechnique,
  type GraphicCompleteFn,
  type GraphicDesignContext,
  type GraphicDesignResult,
  type GraphicReviewResult,
  type GraphicSlotTiming,
} from '@/lib/graphic-design-core'

/**
 * The designer's log for one slot (decision 389's follow-up): every refusal,
 * review outcome, skip and failure as one `[graphics]` line naming the slot,
 * at error level when something failed and warning level otherwise (the lint
 * allows no other), so `vercel logs` can find it.
 */
function graphicsLog(context: GraphicDesignContext, slot: GraphicSlotTiming) {
  const at = `${context.projectId} ${slot.chapterId} at ${(slot.startMs / 1000).toFixed(1)} s`
  return (line: string) => {
    const text = `[graphics] ${at}: ${line}`
    if (/failed|without the browser/.test(line)) console.error(text)
    else console.warn(text)
  }
}

/** The ledgered model call, for the project and its channel. */
function ledgered(projectId: string, channelId: string): GraphicCompleteFn {
  return (request, callOptions) => callLlm(request, { projectId, channelId, ...callOptions })
}

/** The browser, unless GRAPHIC_FRAMES=off (the runners' tests). */
const framesOn = () => process.env['GRAPHIC_FRAMES'] !== 'off'

/**
 * The exemplar the designer is shown for a technique (spec 2026-11-04,
 * section 8.3): the channel's approved version when it has one, with the
 * mechanisms its plan named, else the house design.
 */
export async function channelExemplarFor(
  channelId: string,
  technique: TechniqueKey,
): Promise<Exemplar | undefined> {
  const approved = await approvedExemplar(db, channelId, technique)
  // A channel's own key has no house design (spec 8.5): nothing before approval.
  return approved ? exemplarFromApproved(approved) : exemplarFor(technique)
}

export async function designGraphic(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  // Read here, inside the step that designs, so the bible is the project's frozen one and never
  // an earlier step's memoised copy. The gate sits before the mock branch.
  const channel = await channelForProject(db, context.projectId)
  const inUse = requireCompleteBible(channel)
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
    const checked = graphicCodeIssue(
      planned,
      context,
      { brief, durationMs: slot.durationMs, words: slotWords(context, slot) },
      { motion: resolveMotionIdentity(channel.settings) },
    )
    return 'code' in checked
      ? { ok: true, code: checked.code }
      : { ok: false, issue: checked.issue }
  }

  const motion = resolveMotionIdentity(channel.settings)
  // The channel's own techniques (spec 8.5): a steer phrase of theirs picks one.
  const own = await channelTechniquesInUse(db, inUse.channelId, motion)
  return designGraphicWith(ledgered(context.projectId, inUse.channelId), context, slot, {
    ...options,
    bible: inUse,
    motion,
    exemplar: await channelExemplarFor(
      inUse.channelId,
      slotTechnique(context, slot, motion, options.guidance, own),
    ),
    // The browser's layout check (decision 389), in the channel's own faces
    // and colours. The review is a step of its own: `reviewGraphic`.
    ...(framesOn() ? { frames: browserFrames() } : {}),
    brand: graphicBrand(resolveBrandKit(channel.settings)),
    log: graphicsLog(context, slot),
  })
}

/**
 * The review of a stored design (decision 389; the critic since spec
 * 2026-11-04, section 10.4), called in a step of its own after the design's
 * step, so it has a step's whole time to itself. Skipped, with the reason,
 * when Settings has it off, in mock mode, with the browser off, or on a slot
 * with no design; otherwise `reviewGraphicWith` decides, shown the channel's
 * first two look references.
 */
export async function reviewGraphic(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: { guidance?: string } = {},
): Promise<GraphicReviewResult> {
  const channel = await channelForProject(db, context.projectId)
  const inUse = requireCompleteBible(channel)
  const log = graphicsLog(context, slot)
  const skipped = (reason: string): GraphicReviewResult => {
    log(`review skipped: ${reason}`)
    return { outcome: 'skipped', reason }
  }
  if (mockProvidersEnabled()) return { outcome: 'skipped', reason: 'mock providers' }
  if (!channel.settings.features.graphicReview) return skipped('switched off in Settings')
  if (!framesOn()) return skipped('the browser is off')
  const motion = resolveMotionIdentity(channel.settings)
  // The same technique the design was built on (final review, issue 4): the
  // channel's own phrases count here as they do in `designGraphic`.
  const own = await channelTechniquesInUse(db, inUse.channelId, motion)
  return reviewGraphicWith(ledgered(context.projectId, inUse.channelId), context, slot, {
    ...options,
    bible: inUse,
    motion,
    exemplar: await channelExemplarFor(
      inUse.channelId,
      slotTechnique(context, slot, motion, options.guidance, own),
    ),
    references: await criticReferencesFor(inUse.channelId),
    frames: browserFrames(),
    brand: graphicBrand(resolveBrandKit(channel.settings)),
    log,
  })
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
