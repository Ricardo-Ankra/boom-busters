import { splitSentences } from '@boom-busters/schemas'
import type { PlannedSlot } from '@boom-busters/schemas'
import { MIN_SHOT_RULE } from './min-shot-rule'
import { mockStockBrief, shotListAnswerTokens } from './shotlist'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

export { MIN_SHOT_RULE }

export interface StretchRequestInput {
  pieces: readonly { paragraphIndex: number; text: string; seconds: number }[]
  opening: string
  before: unknown | null
  after: unknown | null
  headlineAllowed: boolean
  /** The owner's note from the bar; absent when the box was empty. */
  note?: string
  /** Why the app is re-planning it unasked (automatic repair, the stretch re-plan design). */
  reason?: string
}

/**
 * One call to re-plan a run of neighbouring shots.
 *
 * Built on the chapter's own shot-list request, as `buildShotRepairRequest`
 * is: the system prompt and the cacheable prefix (claims and the book) are
 * carried unchanged, so the stretch is planned under exactly the rules the
 * plan was and is served that prefix from cache. The answer is slots, for the
 * stretch only.
 */
export function buildStretchRequest(
  base: LLMTaskRequest,
  input: StretchRequestInput,
): LLMTaskRequest {
  const pieces = input.pieces
    .map(
      (piece) =>
        `[paragraph ${piece.paragraphIndex}, ${Math.round(piece.seconds)}s]\n${piece.text}`,
    )
    .join('\n\n')
  const lines = [
    'Re-plan ONLY the stretch below and nothing else in the chapter.',
    `The stretch:\n\n${pieces}`,
    'The shot before the stretch and the shot after it, for continuity only. Read them; do not change or repeat them.',
    `Before: ${JSON.stringify(input.before)}\nAfter: ${JSON.stringify(input.after)}`,
    `The first slot's "coversText" must start with "${input.opening}".`,
    'Quote the stretch in narration order, and every sentence is quoted by exactly one slot.',
    MIN_SHOT_RULE,
  ]
  if (!input.headlineAllowed) lines.push('Do not plan a headline shot.')
  if (input.note) lines.push(`Producer's note: ${input.note}`)
  if (input.reason) lines.push(`Why: ${input.reason}`)
  lines.push('Return JSON: {"slots": [...]}')

  return {
    ...base,
    messages: [...base.messages, { role: 'user', content: lines.join('\n\n') }],
    maxTokens: outputBudget(
      shotListAnswerTokens(
        input.pieces.map((piece) => ({
          index: piece.paragraphIndex,
          text: piece.text,
          seconds: piece.seconds,
        })),
      ),
    ),
  }
}

/**
 * Mock answer for a stretch: one stock slot per sentence, at most two. The
 * first quotes the first sentence, the second the rest from the second
 * sentence on, so the pair covers the stretch with no sentence quoted twice.
 */
export function mockStretchPlan(input: Pick<StretchRequestInput, 'pieces'>): {
  slots: PlannedSlot[]
} {
  const sentences = input.pieces.flatMap((piece) =>
    splitSentences(piece.text).map((text) => ({ text, paragraphIndex: piece.paragraphIndex })),
  )
  const totalSeconds = input.pieces.reduce((sum, piece) => sum + piece.seconds, 0)
  const firstPiece = input.pieces[0]?.paragraphIndex ?? 0
  const [first, ...rest] = sentences
  if (!first) {
    return {
      slots: [
        {
          paragraphIndex: firstPiece,
          seconds: totalSeconds,
          brief: mockStockBrief('[mock] empty stretch', 0),
        },
      ],
    }
  }
  if (rest.length === 0) {
    return {
      slots: [
        {
          paragraphIndex: first.paragraphIndex,
          seconds: totalSeconds,
          brief: mockStockBrief(first.text, 0),
        },
      ],
    }
  }
  const restText = rest.map((sentence) => sentence.text).join(' ')
  const share = first.text.length / (first.text.length + restText.length)
  return {
    slots: [
      {
        paragraphIndex: first.paragraphIndex,
        seconds: totalSeconds * share,
        brief: mockStockBrief(first.text, 0),
      },
      {
        paragraphIndex: rest[0]!.paragraphIndex,
        seconds: totalSeconds * (1 - share),
        brief: mockStockBrief(restText, 1),
      },
    ],
  }
}
