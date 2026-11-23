import { ValidationError } from '@boom-busters/schemas'
import type { PointScript, TeaserScript } from '@boom-busters/schemas'
import type { LLMTaskRequest } from '../llm/types'
import { parsePointScript } from './point-script'
import { ignoreRepairs } from './repair'
import type { Note } from './repair'
import { parseTeaser } from './script'

/**
 * A Short's script rewritten by the model on the owner's note (decision 478).
 * The rewrite is the writer's own request (the same rules, bible and
 * chapters) with the stored script and the note added last, so a rewrite can
 * never be held to a looser standard than the first draft was. It returns a
 * proposal; the studio saves it only when the owner accepts it.
 *
 * Three shapes:
 * - one paragraph (`target` set): only that paragraph's words change; every
 *   other paragraph is kept from the stored script, whatever the model said.
 * - the whole script, shape kept (a teaser): new words in every beat, the
 *   same beats in the same order on the same chapters, because the teaser's
 *   shot picks are stored per beat.
 * - the whole script, free (a point Short): the model may restructure within
 *   the rule book, since Re-plan shots plans over the new words afterwards.
 */

export const REWRITE_NOTE_MAX = 500

export type RewriteTarget = number | null

interface RewriteParagraph {
  text: string
  chapterIndex: number
  phase?: string
}

export function buildShortRewriteRequest(input: {
  /** The writer's request for this kind of Short, built from the same inputs as the first draft. */
  base: LLMTaskRequest
  current: { title: string; paragraphs: readonly RewriteParagraph[] }
  note: string
  target: RewriteTarget
  /** Keep the paragraph count, order and chapters (a teaser). */
  keepShape: boolean
}): LLMTaskRequest {
  const { current, target } = input
  const count = current.paragraphs.length
  const note = input.note.trim()
  const scope =
    target !== null
      ? `Rewrite only paragraph ${target + 1}` +
        (current.paragraphs[target]?.phase
          ? ` (the ${current.paragraphs[target]!.phase} paragraph)`
          : '') +
        `. Return the whole script with the same ${count} paragraphs in the same order, every other paragraph exactly as it is, word for word.`
      : input.keepShape
        ? `Rewrite the words of every paragraph. Keep exactly ${count} paragraphs, in this order, each with its chapterIndex unchanged.`
        : 'Rewrite the whole script. You may change how the paragraphs are divided, within the rules above.'

  return {
    ...input.base,
    messages: [
      ...input.base.messages,
      {
        role: 'user',
        content: [
          'This script is already written. Rewrite it as the owner asks below. Every rule and limit above still holds, and every fact still comes from the chapters.',
          `Current script:\n${JSON.stringify({ title: current.title, paragraphs: current.paragraphs })}`,
          note === ''
            ? "The owner's note: none. Write it again, sharper, in a different way."
            : `The owner's note: ${note}`,
          scope,
          'Return the same JSON shape as before, title included.',
        ].join('\n\n'),
      },
    ],
  }
}

/**
 * What a rewrite's answer must keep from the stored script, or null when it
 * keeps it. Thrown as a `ValidationError` from the parse, so the answer helper
 * tells the model and asks once more.
 */
export function rewriteShapeIssue(
  current: readonly RewriteParagraph[],
  answer: readonly RewriteParagraph[],
  target: RewriteTarget,
  keepShape: boolean,
): string | null {
  if (target === null && !keepShape) return null
  if (answer.length !== current.length) {
    return `the rewrite must keep the ${current.length} paragraphs, but it has ${answer.length}`
  }
  const at = target === null ? null : target
  for (const [index, paragraph] of current.entries()) {
    if (at !== null && index !== at) continue
    const given = answer[index]!
    if (paragraph.phase !== undefined && given.phase !== paragraph.phase) {
      return `paragraph ${index + 1} must stay the ${paragraph.phase} paragraph`
    }
    if (keepShape && given.chapterIndex !== paragraph.chapterIndex) {
      return `paragraph ${index + 1} must stay on chapter ${paragraph.chapterIndex}`
    }
  }
  return null
}

/** The proposal: the stored script with the rewrite's words placed as its shape allows. */
export function spliceRewrite<P extends RewriteParagraph>(
  current: readonly P[],
  answer: readonly P[],
  target: RewriteTarget,
  keepShape: boolean,
): P[] {
  if (target !== null) {
    return current.map((paragraph, index) =>
      index === target ? { ...paragraph, text: answer[index]!.text } : paragraph,
    )
  }
  if (keepShape) {
    return current.map((paragraph, index) => ({ ...paragraph, text: answer[index]!.text }))
  }
  return [...answer]
}

function checkTarget(target: RewriteTarget, count: number): void {
  if (target !== null && (!Number.isInteger(target) || target < 0 || target >= count)) {
    throw new ValidationError(`there is no paragraph ${target + 1} to rewrite`, { field: 'target' })
  }
}

/** A point Short's rewrite: parsed and checked as a first draft is, then spliced. */
export function parsePointRewrite(
  text: string,
  input: { current: PointScript['paragraphs']; target: RewriteTarget; chapterCount: number },
  note: Note = ignoreRepairs,
): PointScript['paragraphs'] {
  checkTarget(input.target, input.current.length)
  const script = parsePointScript(text, input.chapterCount, note)
  const issue = rewriteShapeIssue(input.current, script.paragraphs, input.target, false)
  if (issue) throw new ValidationError(issue, { field: 'point rewrite' })
  return spliceRewrite(input.current, script.paragraphs, input.target, false)
}

/** A teaser's rewrite: the same beats on the same chapters, new words. */
export function parseTeaserRewrite(
  text: string,
  input: { current: TeaserScript['paragraphs']; target: RewriteTarget; chapterCount: number },
  note: Note = ignoreRepairs,
): TeaserScript['paragraphs'] {
  checkTarget(input.target, input.current.length)
  const script = parseTeaser(text, input.chapterCount, note)
  const issue = rewriteShapeIssue(input.current, script.paragraphs, input.target, true)
  if (issue) throw new ValidationError(issue, { field: 'teaser rewrite' })
  return spliceRewrite(input.current, script.paragraphs, input.target, true)
}

/** Deterministic, so mock runs and the E2E suite see a rewrite without a provider. */
export function mockShortRewrite<P extends RewriteParagraph>(
  current: readonly P[],
  target: RewriteTarget,
): P[] {
  return current.map((paragraph, index) =>
    target === null || index === target
      ? { ...paragraph, text: `MOCK REWRITE: ${paragraph.text}`.slice(0, 400) }
      : paragraph,
  )
}
