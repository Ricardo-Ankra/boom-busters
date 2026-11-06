import {
  buildRateAnglesRequest,
  mockProvidersEnabled,
  mockRateAngles,
  parseRateAngles,
} from '@boom-busters/providers'
import type { AngleRating, RateAnglesInput } from '@boom-busters/providers'
import { angleDemand } from '@boom-busters/schemas'
import type { BibleInUse, SearchBrief } from '@boom-busters/schemas'
import { callForAnswer } from '@/lib/answer'
import type { AnswerComplete } from '@/lib/answer'

/**
 * The model's pick among a brief's angle options, shared by the research run
 * and the owner's Rate the angles button. The brief passed must already carry
 * its split term lists, so `angleDemand` can tell a searched title from a keyword.
 */

/** Each option with its Demand, as the rating prompt reads it. */
export function rateAnglesInput(brief: SearchBrief, bible: BibleInUse): RateAnglesInput {
  return {
    bible,
    subject: brief.subject,
    options: brief.angleOptions.map((option) => {
      const demand = angleDemand(option, brief)
      return {
        angle: option.angle,
        gap: option.gap,
        keyword: option.keyword,
        servesSearchedTerm: demand.servesSearchedTerm,
        demand: demand.score,
        keywordOverall: demand.keywordOverall,
        answers: demand.answers,
        evidence: option.evidence ?? [],
        themeBacked: option.themeBacked ?? 0,
      }
    }),
    searchedQuestions: brief.searchedQuestions,
    toldAlready: brief.toldAlready,
    commentThemes: (brief.commentThemes ?? []).map((t) => ({ theme: t.theme, count: t.count })),
  }
}

/**
 * A model problem is a returned error, never a throw, so a rating failure
 * cannot lose a research run; an unexpected error still propagates.
 */
export async function rateAngles(
  brief: SearchBrief,
  bible: BibleInUse,
  complete: AnswerComplete,
): Promise<{ ok: true; rating: AngleRating } | { ok: false; error: string }> {
  const input = rateAnglesInput(brief, bible)
  if (input.options.length < 2)
    return { ok: false, error: 'There are fewer than two angles to rate' }
  if (mockProvidersEnabled()) return { ok: true, rating: mockRateAngles(input) }
  const request = buildRateAnglesRequest(input)
  const answer = await callForAnswer({
    request,
    parse: (text, note) => parseRateAngles(text, input, note),
    complete,
  })
  return answer.ok ? { ok: true, rating: answer.value } : { ok: false, error: answer.issue }
}
