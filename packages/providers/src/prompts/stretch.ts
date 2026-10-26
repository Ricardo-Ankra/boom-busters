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
 * Mock answer for a stretch: stock slots, at most two. A quote never joins
 * text across a paragraph boundary. With two or more pieces the first slot
 * quotes the first piece's sentences and the second starts at the second
 * piece's first sentence and quotes that piece's; with one piece the first
 * slot quotes its first sentence and the second the rest. Either way no
 * sentence is quoted twice.
 */
export function mockStretchPlan(input: Pick<StretchRequestInput, 'pieces'>): {
  slots: PlannedSlot[]
} {
  const totalSeconds = input.pieces.reduce((sum, piece) => sum + piece.seconds, 0)
  const [firstPiece, secondPiece] = input.pieces
  const only = (text: string, paragraphIndex: number): { slots: PlannedSlot[] } => ({
    slots: [{ paragraphIndex, seconds: totalSeconds, brief: mockStockBrief(text, 0) }],
  })
  if (!firstPiece) return only('[mock] empty stretch', 0)

  if (secondPiece) {
    const firstText = splitSentences(firstPiece.text).join(' ')
    const secondText = splitSentences(secondPiece.text).join(' ')
    if (firstText && secondText) {
      return {
        slots: [
          {
            paragraphIndex: firstPiece.paragraphIndex,
            seconds: firstPiece.seconds,
            brief: mockStockBrief(firstText, 0),
          },
          {
            paragraphIndex: secondPiece.paragraphIndex,
            // Any pieces past the second add their time to this slot.
            seconds: totalSeconds - firstPiece.seconds,
            brief: mockStockBrief(secondText, 1),
          },
        ],
      }
    }
  }

  const [first, ...rest] = splitSentences(firstPiece.text)
  if (!first) return only('[mock] empty stretch', firstPiece.paragraphIndex)
  if (rest.length === 0) return only(first, firstPiece.paragraphIndex)
  const restText = rest.join(' ')
  const share = first.length / (first.length + restText.length)
  return {
    slots: [
      {
        paragraphIndex: firstPiece.paragraphIndex,
        seconds: totalSeconds * share,
        brief: mockStockBrief(first, 0),
      },
      {
        paragraphIndex: firstPiece.paragraphIndex,
        seconds: totalSeconds * (1 - share),
        brief: mockStockBrief(restText, 1),
      },
    ],
  }
}
