import type { AnswerComplete } from '@/lib/answer'
import { callLlm } from '@/lib/llm'

/**
 * `callForAnswer`'s call for the app (decision 292): the ledgered `callLlm`,
 * with a retry labelled in the cost ledger. Kept out of `answer.ts`, which
 * the live harnesses import and which must not pull in the database.
 */
export function completeForProject(projectId: string): AnswerComplete {
  return (request, call) =>
    callLlm(request, { projectId, ...(call === 'answer' ? {} : { purpose: call }) })
}
