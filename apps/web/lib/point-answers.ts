import {
  buildPointPlanRequest,
  buildPointScriptRequest,
  buildTalkingPointsRequest,
  parsePointPlan,
  parsePointScript,
  parseTalkingPoints,
} from '@boom-busters/providers'
import type { PlannedPointShot, Repair } from '@boom-busters/providers'
import type { PointScript, TalkingPointDraft } from '@boom-busters/schemas'
import { answerOrStop, callForAnswer, type AnswerComplete } from '@/lib/answer'

/**
 * The playbook Shorts stage's structured answers (design 3.2 to 3.4), on the
 * same footing as the script stage's (decision 292): each costs at most two
 * calls and then stops with its reason, as a `NonRetriableError`. Kept out of
 * the runners so they can be tested without Inngest.
 */

/**
 * The talking points, with what the parser repaired in them (decision 293).
 * `expect` is `set` for a whole proposal and `single` for the redo of one
 * point or an added one, where the answer is one point whatever else it said.
 */
export async function proposeTalkingPointsWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildTalkingPointsRequest>[0],
  expect: 'set' | 'single',
  chapterCount: number,
): Promise<{ points: TalkingPointDraft[]; repairs: Repair[] }> {
  const answer = await callForAnswer({
    request: buildTalkingPointsRequest(input),
    parse: (text, note) => parseTalkingPoints(text, chapterCount, expect, note),
    complete,
  })
  const points = answerOrStop(answer, 'The talking points could not be proposed')
  return { points, repairs: answer.ok ? (answer.repairs ?? []) : [] }
}

/** One point's narration script. */
export async function writePointScriptWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildPointScriptRequest>[0],
  chapterCount: number,
): Promise<{ script: PointScript; repairs: Repair[] }> {
  const answer = await callForAnswer({
    request: buildPointScriptRequest(input),
    parse: (text, note) => parsePointScript(text, chapterCount, note),
    complete,
  })
  const script = answerOrStop(answer, 'The point script could not be written')
  return { script, repairs: answer.ok ? (answer.repairs ?? []) : [] }
}

/** One point's shot plan over the long form's numbered library. */
export async function planPointShotsWith(
  complete: AnswerComplete,
  input: Parameters<typeof buildPointPlanRequest>[0],
): Promise<{ shots: PlannedPointShot[]; repairs: Repair[] }> {
  const answer = await callForAnswer({
    request: buildPointPlanRequest(input),
    parse: (text, note) =>
      parsePointPlan(
        text,
        { wordCount: input.words.length, libraryCount: input.library.length },
        note,
      ),
    complete,
  })
  const shots = answerOrStop(answer, 'The point shots could not be planned')
  return { shots, repairs: answer.ok ? (answer.repairs ?? []) : [] }
}
