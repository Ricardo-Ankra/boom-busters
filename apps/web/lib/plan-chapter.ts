import {
  BANNED_PROMPT_WORDS,
  buildShotListRequest,
  buildShotRepairRequest,
  MAX_OUTPUT_TOKENS,
  parseShotList,
  parseShotRepair,
  withoutBannedWords,
} from '@boom-busters/providers'
import type { LLMTaskRequest, ScriptClaim } from '@boom-busters/providers'
import {
  craftFindings,
  findingContext,
  repairTargets,
  ValidationError,
} from '@boom-busters/schemas'
import type { DirectorsBook, FindingContext, LogoIndex, PlannedSlot } from '@boom-busters/schemas'
import { promptParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * One chapter's shot list, planned through whatever completes a request
 * (decision 285). The app passes its ledgered `callLlm`; the live harness
 * passes a Google call held under its own spend cap. Both then plan under
 * exactly the same request, retry and repair rules.
 */
export type CompleteFn = (
  request: LLMTaskRequest,
  purpose: 'plan' | 'plan-retry' | 'repair',
) => Promise<{ text: string }>

export interface PlanChapterInput {
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  claims: readonly ScriptClaim[]
  styleAnchors: string
  direction: DirectorsBook | null
  photographed?: readonly string[]
  sets?: readonly { name: string; look: string; layout?: string }[]
  logos?: readonly LogoIndex[]
}

/**
 * The shot-list request for one chapter, or null when the chapter has no
 * narration to plan. Shared by planning and by the Fix button (decision 271),
 * so a repair is asked under exactly the rules and context the plan was.
 */
export function chapterShotListRequest(input: PlanChapterInput): LLMTaskRequest | null {
  const paragraphs = promptParagraphs(input.paragraphs, input.chapter.id)
  if (paragraphs.length === 0) return null
  return buildShotListRequest({
    caseTitle: input.caseTitle,
    chapterTitle: input.chapter.title,
    chapterNumber: input.chapter.number,
    paragraphs,
    claims: input.claims,
    styleAnchors: input.styleAnchors,
    ...(input.direction ? { direction: input.direction } : {}),
    ...(input.photographed && input.photographed.length > 0
      ? { photographed: input.photographed }
      : {}),
    ...(input.sets && input.sets.length > 0
      ? {
          sets: input.sets.map((set) => ({
            name: set.name,
            look: set.look,
            layout: set.layout,
          })),
        }
      : {}),
    logos: input.logos?.map((logo) => logo.title),
  })
}

/**
 * Call the shot-list model, and if the answer was cut off at max_tokens, call
 * once more with double the budget before giving up.
 *
 * A truncated JSON answer is the one failure an Inngest retry cannot help
 * with: the same request at the same budget is cut off at the same place,
 * so the four blind retries the runner allows were four identical paid
 * failures (first live run under the Director's Book, 2026-09-15). The retry
 * that can succeed is a bigger one, and one doubling is the whole ladder: a
 * budget that fails twice is a chapter that needs splitting, not more room.
 * Every other error passes straight through to the runner's handling.
 */
async function planWithBudgetEscalation(
  complete: CompleteFn,
  request: LLMTaskRequest,
): Promise<ReturnType<typeof parseShotList>> {
  try {
    return parseShotList((await complete(request, 'plan')).text)
  } catch (error) {
    const cutOff = error instanceof ValidationError && error.field === 'maxTokens'
    if (!cutOff || request.maxTokens >= MAX_OUTPUT_TOKENS) throw error
    const bigger = { ...request, maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2) }
    return parseShotList((await complete(bigger, 'plan-retry')).text)
  }
}

/**
 * One automatic repair of a freshly planned chapter (decision 271).
 *
 * Only `auto` findings are sent, so a clean chapter, or one whose only
 * findings are the producer's to weigh, costs nothing. `parseShotRepair`
 * refuses any change of type here, so this can never turn a free slot into a
 * paid one unasked. Any failure, budget included, keeps the plan exactly as
 * planned: an unrepaired plan is still a valid plan, and the Fix button can
 * repair it later.
 */
async function repairPlannedChapter(
  complete: CompleteFn,
  input: {
    request: LLMTaskRequest
    slots: PlannedSlot[]
    chapterNumber: number
    context: FindingContext
  },
): Promise<PlannedSlot[]> {
  const findings = craftFindings(
    input.slots.map((slot) => ({ brief: slot.brief, chapter: `chapter ${input.chapterNumber}` })),
    input.context,
  )
  const targets = repairTargets(findings, ['auto'])
  if (targets.length === 0) return input.slots
  const originals = targets.map((target) => input.slots[target.slotIndex]!.brief)
  try {
    const answer = await complete(
      buildShotRepairRequest(
        input.request,
        targets.map((target, at) => ({
          brief: originals[at],
          problems: target.findings.map((finding) => finding.message),
        })),
        { allowStockToStill: false },
      ),
      'repair',
    )
    const replacements = parseShotRepair(answer.text, originals, { allowStockToStill: false })
    const repaired = [...input.slots]
    targets.forEach((target, at) => {
      const brief = replacements[at]
      if (brief) {
        repaired[target.slotIndex] = {
          ...repaired[target.slotIndex]!,
          brief: withoutBannedWords(brief),
        }
      }
    })
    return repaired
  } catch (error) {
    console.warn('[visuals] chapter repair skipped; the plan is kept as planned', error)
    return input.slots
  }
}

export async function planChapterWith(
  complete: CompleteFn,
  input: PlanChapterInput,
): Promise<{ slots: PlannedSlot[]; malformed: number } | null> {
  const request = chapterShotListRequest(input)
  if (!request) return null
  const parsed = await planWithBudgetEscalation(complete, request)
  const slots = await repairPlannedChapter(complete, {
    request,
    slots: parsed.slots.map((slot) => ({ ...slot, brief: withoutBannedWords(slot.brief) })),
    chapterNumber: input.chapter.number,
    context: findingContext({
      direction: input.direction,
      cast: (input.photographed ?? []).map((name) => ({ name, photographed: true })),
      sets: (input.sets ?? []).map((set) => ({
        name: set.name,
        look: set.look,
        layout: set.layout,
      })),
      bannedWords: BANNED_PROMPT_WORDS,
    }),
  })
  return { slots, malformed: parsed.malformed.length }
}
