import {
  getLatestScript,
  getProject,
  getSettings,
  listCastMembers,
  scriptableClaims,
  seedCastFromPrincipals,
  setProjectDirection,
} from '@boom-busters/db'
import type { NewShotSlot } from '@boom-busters/db'
import {
  buildDirectorsBookRequest,
  buildShotListRequest,
  MAX_OUTPUT_TOKENS,
  mockDirectorsBook,
  mockProvidersEnabled,
  mockShotList,
  parseDirectorsBook,
  parseShotList,
  stillStyleAnchors,
} from '@boom-busters/providers'
import type {
  DirectionCastInput,
  DirectionChapterInput,
  ScriptClaim,
} from '@boom-busters/providers'
import { DirectorsBookSchema, ValidationError } from '@boom-busters/schemas'
import type { DirectorsBook } from '@boom-busters/schemas'
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
  if (stored.success) return stored.data
  return draftDirectorsBook(projectId)
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
 * One chapter's slots, planned and converted to rows. Throws
 * `BudgetExceededError` through; the caller decides whether that parks the
 * stage or fails the side job.
 */
export async function planChapterSlots(input: {
  projectId: string
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  claims: readonly ScriptClaim[]
  claimIds: readonly string[]
  styleAnchors: string
  direction: DirectorsBook | null
  /** Cast members with a reference photograph (decision 253, amended). */
  photographed?: readonly string[]
}): Promise<{ rows: NewShotSlot[]; rejected: number }> {
  const paragraphs = promptParagraphs(input.paragraphs, input.chapter.id)
  if (paragraphs.length === 0) return { rows: [], rejected: 0 }

  let slots
  // Slots the model planned but that could not be used (malformed shapes,
  // charts citing claims that do not exist) are dropped and counted rather
  // than fatal: a gap on the board is repairable from a card.
  let dropped = 0
  if (mockProvidersEnabled()) {
    slots = mockShotList({ paragraphs, claimCount: input.claims.length }).slots
  } else {
    const request = buildShotListRequest({
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
    })
    const parsed = await planWithBudgetEscalation(request, { projectId: input.projectId })
    slots = parsed.slots
    dropped = parsed.malformed.length
  }

  const conversion = plannedToRows({
    chapterId: input.chapter.id,
    planned: slots,
    paragraphs: input.paragraphs,
    claimIds: input.claimIds,
  })
  return { rows: conversion.rows, rejected: dropped + conversion.rejected.length }
}
