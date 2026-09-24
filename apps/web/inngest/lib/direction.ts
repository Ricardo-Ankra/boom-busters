import {
  getLatestScript,
  getProject,
  getSettings,
  listCastMembers,
  retypeShotSlot,
  scriptableClaims,
  seedCastFromPrincipals,
  seedSetsFromLocations,
  setProjectDirection,
  updateSlotBrief,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import {
  buildDirectorsBookRequest,
  buildShotListRequest,
  buildShotRepairRequest,
  MAX_OUTPUT_TOKENS,
  mockDirectorsBook,
  mockProvidersEnabled,
  mockShotList,
  parseDirectorsBook,
  parseShotList,
  parseShotRepair,
  stillStyleAnchors,
  withoutBannedWords,
} from '@boom-busters/providers'
import type {
  DirectionCastInput,
  DirectionChapterInput,
  ScriptClaim,
} from '@boom-busters/providers'
import {
  claimCarriesArticle,
  craftFindings,
  DirectorsBookSchema,
  findingContext,
  repairTargets,
  resolvePlannedBrief,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  DirectorsBook,
  FindingContext,
  LogoIndex,
  PlannedSlot,
  ShotBrief,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { z } from 'zod'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { plannedToRows, promptParagraphs, type TimedParagraph } from './shot-list'

/**
 * The Director's Book and per-chapter planning, shared by the visuals-runner
 * and the visuals-replanner (decision 252). Both loop over chapters and call
 * `planChapterSlots` inside their own Inngest steps, so a chapter stays the
 * unit of retry and of spend, and neither function owns a copy of the logic.
 */

/**
 * The same split the voice stage uses for paragraphs (decision 202): blank
 * lines separate them, and a block that is nothing but a bracketed narration
 * tag is not a paragraph.
 */
function splitParagraphs(contentMd: string): string[] {
  return contentMd
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !/^\[[^\]]+\]$/.test(block))
}

/**
 * Only the tension fields, read leniently. The full `OutlineSchema` is the
 * drafting contract (two to twenty chapters, word targets); an outline that
 * fails it for an unrelated reason must not cost the book its central
 * question, because these lines are hints, never requirements.
 */
const tension = z.string().trim().min(1).max(500).optional().catch(undefined)
const OutlineTensionSchema = z
  .object({
    centralQuestion: tension,
    chapters: z.array(z.object({ question: tension, withhold: tension }).loose()).catch([]),
  })
  .loose()

export async function loadDirectionInputs(projectId: string): Promise<{
  caseTitle: string
  centralQuestion: string | undefined
  chapters: DirectionChapterInput[]
  claims: ScriptClaim[]
  styleAnchors: string
  /** The project's cast (decision 253): each becomes a likeness principal. */
  cast: DirectionCastInput[]
  /**
   * Exact names of cast members who have a reference photograph. The shot
   * list needs them (decision 253, amended): their prompts must name them
   * and carry no physical description, because the photograph is the
   * likeness and a written description argues with it.
   */
  photographed: string[]
}> {
  const project = await getProject(db, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const script = await getLatestScript(db, projectId)
  if (!script || script.chapters.length === 0) {
    throw new NonRetriableError('There is no script to direct. Approve a script and voice first.')
  }
  const outline = OutlineTensionSchema.safeParse(script.script.outline ?? {})
  const outlineChapters = outline.success ? outline.data.chapters : []

  const chapters: DirectionChapterInput[] = script.chapters.map((chapter, index) => ({
    title: chapter.title,
    paragraphs: splitParagraphs(chapter.contentMd),
    question: outlineChapters[index]?.question,
    withhold: outlineChapters[index]?.withhold,
  }))

  const claims = (await scriptableClaims(db, projectId)).map((claim) => ({
    id: claim.id,
    text: claim.text,
    sourceUrl: claim.sourceUrl,
    confidence: claim.confidence,
    // Which claims a headline card may cite (decision 257).
    sourceType: claim.sourceType,
  }))
  const settings = await getSettings(db)
  const members = await listCastMembers(db, projectId)
  const cast = members.map((member) => ({
    name: member.name,
    role: member.role,
    identityString: member.identityString,
  }))
  const photographed = members
    .filter((member) => member.photos.length > 0)
    .map((member) => member.name)
  return {
    caseTitle: project.title,
    centralQuestion: outline.success ? outline.data.centralQuestion : undefined,
    // (An outline with no chapters array still yields its central question.)
    chapters,
    claims,
    styleAnchors: stillStyleAnchors(settings.brandKit),
    cast,
    photographed,
  }
}

/**
 * Draft the book (one call, or the mock) and store it. Replaces whatever was
 * there. Every named principal the book introduces is then added to the cast
 * with its role, identity string and guardrail (decision 253 (j)), so the
 * producer's remaining job is the photograph; members already present, and
 * anyone the producer removed, are left as they are.
 */
export async function draftDirectorsBook(projectId: string): Promise<DirectorsBook> {
  const inputs = await loadDirectionInputs(projectId)
  const book = mockProvidersEnabled()
    ? mockDirectorsBook({
        caseTitle: inputs.caseTitle,
        chapterCount: inputs.chapters.length,
        cast: inputs.cast,
      })
    : parseDirectorsBook(
        (await callLlm(buildDirectorsBookRequest(inputs), { projectId })).text,
        inputs.chapters.length,
      )
  await setProjectDirection(db, projectId, book)
  await seedCastFromPrincipals(db, projectId, book.principals)
  // The book's locations are the film's sets, exactly as its principals are
  // the film's cast (decision 264). Seeded once; the producer's removals stick.
  await seedSetsFromLocations(db, projectId, book.locations)
  return book
}

/**
 * The stored book when it parses (the owner may have edited it on the plan
 * screen, and a re-run of the stage must not throw that away); a fresh draft
 * otherwise.
 */
export async function loadOrDraftDirectorsBook(projectId: string): Promise<DirectorsBook> {
  const project = await getProject(db, projectId)
  const stored = DirectorsBookSchema.safeParse(project?.direction)
  if (!stored.success) return draftDirectorsBook(projectId)
  // A book drafted before the cast or the sets existed still names the
  // film's people and rooms, and a re-run of the stage is the only time the
  // runner reads it again (decision 265). Both seeders skip what is there
  // and what the producer removed, so this is free when nothing changed.
  await seedCastFromPrincipals(db, projectId, stored.data.principals)
  await seedSetsFromLocations(db, projectId, stored.data.locations)
  return stored.data
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
  request: ReturnType<typeof buildShotListRequest>,
  options: { projectId: string },
): Promise<ReturnType<typeof parseShotList>> {
  try {
    return parseShotList((await callLlm(request, options)).text)
  } catch (error) {
    const cutOff = error instanceof ValidationError && error.field === 'maxTokens'
    if (!cutOff || request.maxTokens >= MAX_OUTPUT_TOKENS) throw error
    const bigger = { ...request, maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2) }
    return parseShotList((await callLlm(bigger, options)).text)
  }
}

/**
 * The shot-list request for one chapter, or null when the chapter has no
 * narration to plan. Shared by planning and by the Fix button (decision 271),
 * so a repair is asked under exactly the rules and context the plan was.
 */
export function chapterShotListRequest(input: {
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  claims: readonly ScriptClaim[]
  styleAnchors: string
  direction: DirectorsBook | null
  photographed?: readonly string[]
  sets?: readonly { name: string; look: string; layout?: string }[]
  logos?: readonly LogoIndex[]
}): ReturnType<typeof buildShotListRequest> | null {
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
 * One automatic repair of a freshly planned chapter (decision 271).
 *
 * Only `auto` findings are sent, so a clean chapter, or one whose only
 * findings are the producer's to weigh, costs nothing. `parseShotRepair`
 * refuses any change of type here, so this can never turn a free slot into a
 * paid one unasked. Any failure, budget included, keeps the plan exactly as
 * planned: an unrepaired plan is still a valid plan, and the Fix button can
 * repair it later.
 */
async function repairPlannedChapter(input: {
  projectId: string
  request: ReturnType<typeof buildShotListRequest>
  slots: PlannedSlot[]
  chapterNumber: number
  context: FindingContext
}): Promise<PlannedSlot[]> {
  const findings = craftFindings(
    input.slots.map((slot) => ({ brief: slot.brief, chapter: `chapter ${input.chapterNumber}` })),
    input.context,
  )
  const targets = repairTargets(findings, ['auto'])
  if (targets.length === 0) return input.slots
  const originals = targets.map((target) => input.slots[target.slotIndex]!.brief)
  try {
    const answer = await callLlm(
      buildShotRepairRequest(
        input.request,
        targets.map((target, at) => ({
          brief: originals[at],
          problems: target.findings.map((finding) => finding.message),
        })),
        { allowStockToStill: false },
      ),
      { projectId: input.projectId },
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

/**
 * One chapter's slots, planned and converted to rows. Throws
 * `BudgetExceededError` through; the caller decides whether that parks the
 * stage or fails the side job.
 */
export async function planChapterSlots(input: {
  projectId: string
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  /**
   * The claim list IN PROMPT ORDER: its positions are the numbers the model
   * cites, and its source types decide which claims may back a headline card.
   */
  claims: readonly ScriptClaim[]
  styleAnchors: string
  direction: DirectorsBook | null
  /** Cast members with a reference photograph (decision 253, amended). */
  photographed?: readonly string[]
  /** The project's sets (decision 264), threaded exactly like `photographed`. */
  sets?: readonly { name: string; look: string; layout?: string }[]
  /**
   * The logo library (decision 268, Plan B): titles name the marks in the
   * prompt and the mock; ids resolve a graphic's "logo" to its asset. Gathered
   * by the caller, since this function reads no table of its own.
   */
  logos?: readonly LogoIndex[]
}): Promise<{ rows: NewShotSlot[]; rejected: number }> {
  const paragraphs = promptParagraphs(input.paragraphs, input.chapter.id)
  if (paragraphs.length === 0) return { rows: [], rejected: 0 }

  let slots: PlannedSlot[]
  // Slots the model planned but that could not be used (malformed shapes,
  // charts citing claims that do not exist) are dropped and counted rather
  // than fatal: a gap on the board is repairable from a card.
  let dropped = 0
  if (mockProvidersEnabled()) {
    slots = mockShotList({
      paragraphs,
      claimCount: input.claims.length,
      claimTexts: input.claims.map((claim) => claim.text),
      logoTitles: input.logos?.map((logo) => logo.title),
      newsClaimRefs: input.claims
        .map((claim, at) => (claimCarriesArticle(claim) ? at + 1 : 0))
        .filter((ref) => ref > 0),
    }).slots
  } else {
    const request = chapterShotListRequest(input)
    if (!request) return { rows: [], rejected: 0 }
    const parsed = await planWithBudgetEscalation(request, { projectId: input.projectId })
    dropped = parsed.malformed.length
    slots = await repairPlannedChapter({
      projectId: input.projectId,
      request,
      slots: parsed.slots.map((slot) => ({ ...slot, brief: withoutBannedWords(slot.brief) })),
      chapterNumber: input.chapter.number,
      context: findingContext({
        direction: input.direction,
        // Only a photographed member can carry an auto finding, and this pass
        // acts on nothing else, so the photographed names are all it needs.
        cast: (input.photographed ?? []).map((name) => ({ name, photographed: true })),
        sets: (input.sets ?? []).map((set) => ({
          name: set.name,
          look: set.look,
          layout: set.layout,
        })),
      }),
    })
  }

  const conversion = plannedToRows({
    chapterId: input.chapter.id,
    planned: slots,
    paragraphs: input.paragraphs,
    claims: input.claims,
    logos: input.logos,
  })
  return { rows: conversion.rows, rejected: dropped + conversion.rejected.length }
}

/**
 * The Fix button's rewrite of stored briefs (decision 271): one call for one
 * chapter's flagged slots, `auto` and `manual` findings both, because pressing
 * the button is the producer's consent to what the automatic pass would not
 * spend on alone. A stock brief may come back as a still only when its target
 * is cleared for it (`mayBecomeStill`, the rule behind the button's "N become
 * stills"); nothing else may change type. Each accepted replacement is stored with `updateSlotBrief`, or
 * with `retypeShotSlot` when stock became a still (the type column and the
 * brief move together, and the old candidates clear), so a slot pre-fetched
 * for its old brief owes a fetch for its new one. Returns how many briefs
 * were rewritten.
 *
 * Unlike the automatic pass this throws: the producer asked for the fix and
 * must hear when it did not happen. Mock mode makes no call and rewrites
 * nothing.
 */
export async function rewriteStoredBriefs(input: {
  projectId: string
  request: ReturnType<typeof buildShotListRequest>
  targets: readonly {
    id: string
    brief: ShotBrief
    problems: readonly string[]
    /** Whether this stock slot may come back as a generated still. */
    mayBecomeStill: boolean
  }[]
  claims: readonly ScriptClaim[]
  logos: readonly LogoIndex[]
}): Promise<number> {
  if (input.targets.length === 0 || mockProvidersEnabled()) return 0
  const originals = input.targets.map((target) => ({
    type: target.brief.type,
    coversText: target.brief.coversText,
    mayBecomeStill: target.mayBecomeStill,
  }))
  const answer = await callLlm(
    buildShotRepairRequest(
      input.request,
      input.targets.map((target) => ({ brief: target.brief, problems: target.problems })),
      { allowStockToStill: true },
    ),
    { projectId: input.projectId },
  )
  const replacements = parseShotRepair(answer.text, originals, { allowStockToStill: true })
  let written = 0
  for (const [at, target] of input.targets.entries()) {
    const planned = replacements[at]
    if (!planned) continue
    const stored = resolvePlannedBrief(withoutBannedWords(planned), input.claims, input.logos)
    if (!stored) continue
    if (stored.type === target.brief.type) await updateSlotBrief(db, target.id, stored)
    else await retypeShotSlot(db, target.id, stored.type, stored)
    written += 1
  }
  return written
}
