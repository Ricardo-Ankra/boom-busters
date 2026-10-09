import { MAX_OUTPUT_TOKENS } from '@boom-busters/providers'
import type { LLMTaskRequest } from '@boom-busters/providers'
import { ValidationError } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'

/**
 * One answer, at most two calls (decision 292). A refused or cut-off answer
 * used to be thrown out of its Inngest step, and the function's `retries`
 * re-ran the identical request: same prompt, same budget, no word of what
 * was wrong, so the same mistake was bought again (a Director's Book redraft
 * paid for three Opus calls and stored nothing).
 *
 * Here the task's parser repairs what it safely can and validates; a cut-off
 * is asked once more at double the budget, a refusal once more with its
 * reason; the second call's outcome is final. Pure: the call is injected, so
 * the app binds it to the ledgered `callLlm` (`completeForProject`) and a
 * live harness binds its own.
 *
 * A reply the provider flags as truncated whose parse then fails counts as a
 * cut-off, not a refusal: Gemini and OpenAI hand back empty or partial text
 * when reasoning eats the budget, and only a bigger budget can help.
 */

export type AnswerCall = 'answer' | 'retry: cut off' | 'retry: refused'

export type AnswerComplete = (
  request: LLMTaskRequest,
  call: AnswerCall,
) => Promise<{ text: string; truncated?: boolean }>

export type Answer<T> =
  { ok: true; value: T; calls: 1 | 2 } | { ok: false; issue: string; calls: 1 | 2 }

export const ANSWER_CUT_OFF = 'the answer was cut off at its length limit'

const isCutOff = (error: unknown): error is ValidationError =>
  error instanceof ValidationError && error.field === 'maxTokens'

/** The request a retry after a refusal sends by default: the same, with the reason last. */
export function withRefusal(request: LLMTaskRequest, reason: string): LLMTaskRequest {
  return {
    ...request,
    messages: [
      ...request.messages,
      {
        role: 'user',
        content: `Your previous answer was refused: ${reason}. Answer again in full with that fixed.`,
      },
    ],
  }
}

type Attempt<T> = { ok: true; value: T } | { ok: false; cutOff: boolean; issue: string }

async function attempt<T>(
  complete: AnswerComplete,
  parse: (text: string) => T,
  request: LLMTaskRequest,
  call: AnswerCall,
): Promise<Attempt<T>> {
  let reply: { text: string; truncated?: boolean }
  try {
    reply = await complete(request, call)
  } catch (error) {
    // Only a cut-off from the call is the answer's fault; anything else the
    // call throws (a rejected key, a budget stop, a provider error) is not.
    if (isCutOff(error)) return { ok: false, cutOff: true, issue: error.message }
    // A call-side ValidationError (a rejected key, an exhausted balance, a
    // preflight miss) is wrapped as spec 2.1 says: Inngest would retry it blind.
    if (error instanceof ValidationError) {
      throw new NonRetriableError(error.message, { cause: error })
    }
    throw error
  }
  try {
    return { ok: true, value: parse(reply.text) }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    return { ok: false, cutOff: isCutOff(error) || reply.truncated === true, issue: error.message }
  }
}

export async function callForAnswer<T>(input: {
  request: LLMTaskRequest
  /** Repairs, then validates; throws `ValidationError` for an answer it cannot use. */
  parse: (text: string) => T
  complete: AnswerComplete
  /** Rebuilds the request for the retry after a refusal; by default the reason is added last. */
  retryWithReason?: (reason: string) => LLMTaskRequest
  /** What a final cut-off reports; `ANSWER_CUT_OFF` by default. */
  cutOffIssue?: string
}): Promise<Answer<T>> {
  const cutOffIssue = input.cutOffIssue ?? ANSWER_CUT_OFF
  const first = await attempt(input.complete, input.parse, input.request, 'answer')
  if (first.ok) return { ok: true, value: first.value, calls: 1 }

  let retry: LLMTaskRequest
  let call: AnswerCall
  if (first.cutOff) {
    // The same budget is cut off at the same place; only a bigger one can help.
    if (input.request.maxTokens >= MAX_OUTPUT_TOKENS) {
      return { ok: false, issue: cutOffIssue, calls: 1 }
    }
    retry = {
      ...input.request,
      maxTokens: Math.min(MAX_OUTPUT_TOKENS, input.request.maxTokens * 2),
    }
    call = 'retry: cut off'
  } else {
    retry = input.retryWithReason
      ? input.retryWithReason(first.issue)
      : withRefusal(input.request, first.issue)
    call = 'retry: refused'
  }

  const second = await attempt(input.complete, input.parse, retry, call)
  if (second.ok) return { ok: true, value: second.value, calls: 2 }
  return { ok: false, issue: second.cutOff ? cutOffIssue : second.issue, calls: 2 }
}

/**
 * The value, or a stop Inngest will not retry: the reason reaches the stage's
 * failure card through the function's `onFailure`, and no blind re-run buys
 * the same answer again.
 */
export function answerOrStop<T>(answer: Answer<T>, what: string): T {
  if (answer.ok) return answer.value
  throw new NonRetriableError(`${what}: ${answer.issue}`)
}
