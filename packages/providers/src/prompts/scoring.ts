import { CandidateScoresSchema } from '@boom-busters/schemas'
import type {
  ArchivalBrief,
  CandidateScores,
  SlotCandidate,
  StockBrief,
} from '@boom-busters/schemas'
import { parseJsonCompletion } from './json'
import { outputBudget } from '../llm/types'
import type { LLMTaskRequest } from '../llm/types'

/**
 * Candidate scoring (build spec section 6): after fetching, "a single Haiku
 * call scores all candidates for a slot against the brief and rejection
 * criteria (batched: one call per slot, not per candidate)".
 *
 * The model judges METADATA — alt text, tags, a Commons description,
 * dimensions, duration — because that is what the sources give us. That makes
 * scores a ranking aid, not a verdict: the board still shows thumbnails and a
 * human still chooses. The prompt says so, and the reason strings are shown
 * on the card so a wrong score is visibly wrong.
 */

/** Only fetched types get scored; charts, maps and stills are made, not found. */
export type ScorableBrief = StockBrief | ArchivalBrief

function criteria(brief: ScorableBrief): string {
  if (brief.type === 'stock') {
    return brief.rejectionCriteria.length > 0
      ? `Rejection criteria — any match scores AT MOST 20:\n${brief.rejectionCriteria
          .map((criterion) => `- ${criterion}`)
          .join('\n')}`
      : 'No explicit rejection criteria.'
  }

  return (
    `The image MUST show: ${brief.mustShow}. If the metadata does not indicate it, ` +
    `score at most 40.` +
    (brief.eraRange
      ? `\nAcceptable era: ${brief.eraRange}. Wrong-era results score at most 20.`
      : '')
  )
}

function candidateLine(candidate: SlotCandidate, index: number): string {
  const facts = [
    candidate.kind,
    candidate.width && candidate.height ? `${candidate.width}×${candidate.height}` : undefined,
    candidate.durationMs ? `${Math.round(candidate.durationMs / 1000)}s` : undefined,
    `licence: ${candidate.licence}`,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    `${index + 1}. (id: ${candidate.id}) [${facts}]\n` +
    `   ${candidate.summary ?? '(no description from the source)'}`
  )
}

export function buildScoringRequest(input: {
  brief: ScorableBrief
  candidates: readonly SlotCandidate[]
}): LLMTaskRequest {
  return {
    task: 'shotlist',
    system: `You are ranking fetched footage candidates for one slot of a
documentary. You see each candidate's METADATA only — no pixels — so score
what the metadata supports and say so in the reason when it is thin.

Score 0-100 for fit against the brief: subject match first, then mood/era/
composition as the metadata reveals them. A candidate whose metadata says
nothing relevant scores low — absence of evidence is a bad sign when the
description had every chance to mention the subject.

${criteria(input.brief)}

Return JSON, one entry per candidate, using each candidate's exact id:
{"scores": [{"id": string, "score": number, "reason": string}]}
Keep each reason to one sentence.`,
    messages: [
      {
        role: 'user',
        content:
          `The brief: ${input.brief.description}\n` +
          `It plays under the narration: "${input.brief.coversText}"`,
      },
      {
        role: 'user',
        content: `Candidates:\n${input.candidates
          .map((candidate, index) => candidateLine(candidate, index))
          .join('\n')}`,
      },
    ],
    maxTokens: outputBudget(Math.max(1500, input.candidates.length * 120)),
  }
}

export function parseScores(text: string): CandidateScores {
  return parseJsonCompletion(text, CandidateScoresSchema, 'candidate scores')
}

/**
 * Mock scores: deterministic, descending, and deliberately NOT uniform — the
 * board sorts by score, and a mock that scored everything 50 would leave the
 * ordering untested.
 */
export function mockScores(candidates: readonly SlotCandidate[]): CandidateScores {
  return {
    scores: candidates.map((candidate, index) => ({
      id: candidate.id,
      score: Math.max(5, 92 - index * 9),
      reason: '[mock] Nothing was judged; scores descend by fetch order.',
    })),
  }
}
