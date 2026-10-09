import type { AnswerComplete } from '@/lib/answer'
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
  return (request, call) =>
    callLlm(request, { projectId, ...(call === 'answer' ? firstCall : { purpose: call }) })
}
