import { channelForProject } from '@boom-busters/db'
import type { AnswerComplete } from '@/lib/answer'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'

/**
 * `callForAnswer`'s call for the app (decision 292): the ledgered `callLlm`,
 * with a retry labelled in the cost ledger. Kept out of `answer.ts`, which
 * the live harnesses import and which must not pull in the database.
 *
 * `firstCall.estimateOutputTokens` narrows the first call's budget estimate
 * for a task that knows how long its answer runs (a chapter, the title
 * options; decision 293). A retry keeps the full-budget estimate: it exists
 * because an answer ran long or went wrong, and an estimate that is too low
 * is the one that walks through a cap.
 */
export function completeForProject(
  projectId: string,
  firstCall: { estimateOutputTokens?: number } = {},
): AnswerComplete {
  return async (request, call) => {
    const { channelId } = await channelForProject(db, projectId)
    return callLlm(request, {
      projectId,
      channelId,
      ...(call === 'answer' ? firstCall : { purpose: call }),
    })
  }
}

/**
 * `completeForProject` for a call charged to a channel and no project: the
 * Motion tab's reading and identity draft (spec 2026-11-04), as the bible
 * drafter's calls are.
 */
export function completeForChannel(
  channelId: string,
  firstCall: { estimateOutputTokens?: number } = {},
): AnswerComplete {
  return async (request, call) =>
    callLlm(request, {
      channelId,
      ...(call === 'answer' ? firstCall : { purpose: call }),
    })
}
