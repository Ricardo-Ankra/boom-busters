import {
  BANNED_PROMPT_WORDS,
  buildShotListRequest,
  buildShotRepairRequest,
  parseShotList,
  parseShotRepair,
  withoutBannedWords,
} from '@boom-busters/providers'
import type { LLMTaskRequest, ScriptClaim } from '@boom-busters/providers'
import { craftFindings, findingContext, repairTargets } from '@boom-busters/schemas'
import type { DirectorsBook, FindingContext, LogoIndex, PlannedSlot } from '@boom-busters/schemas'
import { answerOrStop, callForAnswer } from '@/lib/answer'
import { promptParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * One chapter's shot list, planned through whatever completes a request
 * (decision 287). The app passes its ledgered `callLlm`; the live harness
 * passes a Google call held under its own spend cap. Both then plan under
 * exactly the same request, retry and repair rules.
 */
export type CompleteFn = (
  request: LLMTaskRequest,
  purpose: 'plan' | 'repair' | 'retry: cut off' | 'retry: refused',
) => Promise<{ text: string; truncated?: boolean }>

export interface PlanChapterInput {
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  claims: readonly ScriptClaim[]
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
  // At most two calls (decision 292): a cut-off asked once more at double the
  // budget, a refusal once more with its reason, then the chapter stops with
  // the reason. The step never restarts the ladder: the stop is non-retriable.
  const parsed = answerOrStop(
    await callForAnswer({
      request,
      parse: parseShotList,
      complete: (asked, call) => complete(asked, call === 'answer' ? 'plan' : call),
    }),
    `Chapter ${input.chapter.number} could not be planned`,
  )
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
