import {
  buildOutlineRequest,
  buildSelfCheckRequest,
  buildShortsRequest,
  parseOutline,
  parseSelfCheck,
  parseShortsCandidates,
} from '@boom-busters/providers'
import { answerOrStop, callForAnswer, type AnswerComplete } from '@/lib/answer'

/**
 * The script stage's structured answers (decision 292): the outline, each
 * chapter's self-check and the Shorts marking. Each used to be thrown out of
 * its step on a bad answer and re-run blind by the function's retries, five
 * identical calls; now each costs at most two and then stops the stage with
 * its reason. Kept out of the runners so they can be tested without Inngest.
 */

export async function draftOutlineWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildOutlineRequest>[0],
) {
  return answerOrStop(
    await callForAnswer({ request: buildOutlineRequest(input), parse: parseOutline, complete }),
    'The outline could not be drafted',
  )
}

export async function selfCheckWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildSelfCheckRequest>[0],
) {
  return answerOrStop(
    await callForAnswer({ request: buildSelfCheckRequest(input), parse: parseSelfCheck, complete }),
    `The self-check of "${input.chapterTitle}" could not be read`,
  )
}

export async function markShortsWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildShortsRequest>[0],
) {
  return answerOrStop(
    await callForAnswer({
      request: buildShortsRequest(input),
      parse: parseShortsCandidates,
      complete,
    }),
    'The Shorts segments could not be marked',
  )
}
