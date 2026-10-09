import { MAX_OUTPUT_TOKENS } from '@boom-busters/providers'
import type { LLMTaskRequest, Note, Repair } from '@boom-busters/providers'
import { AnswerDeclined, ContentPolicyError, ValidationError } from '@boom-busters/schemas'
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
 *
 * Decision 293: a parser reports each repair it makes through `note`, and an
 * answer carries the repairs of the attempt that succeeded, for the card it
 * lands on. A deliberate decline and a provider's content refusal are final:
 * the same request would be declined again. `callForText` is the plain-text
 * sibling, where a truncated reply is always a cut-off.
 */

export type AnswerCall = 'answer' | 'retry: cut off' | 'retry: refused'

export type AnswerComplete = (
  request: LLMTaskRequest,
  call: AnswerCall,
) => Promise<{ text: string; truncated?: boolean }>

export type Answer<T> =
  | { ok: true; value: T; calls: 1 | 2; repairs?: Repair[] }
  | { ok: false; issue: string; calls: 1 | 2; declined?: true }

export const ANSWER_CUT_OFF = 'the answer was cut off at its length limit'

export const EMPTY_ANSWER = 'the answer was empty'

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

type Attempt<T> =
  | { ok: true; value: T; repairs: Repair[] }
  | { ok: false; cutOff: boolean; final: boolean; declined: boolean; issue: string }

type AnswerInput<T> = {
  request: LLMTaskRequest
  /** Repairs (reporting each through `note`), then validates; throws `ValidationError` for an answer it cannot use. */
  parse: (text: string, note: Note) => T
  complete: AnswerComplete
  /** Rebuilds the request for the retry after a refusal; by default the reason is added last. */
  retryWithReason?: (reason: string) => LLMTaskRequest
  /** What a final cut-off reports; `ANSWER_CUT_OFF` by default. */
  cutOffIssue?: string
  /** Plain text: a reply flagged as truncated is a cut-off even when it parses. */
  truncatedIsCutOff?: boolean
}

const refused = (issue: string, cutOff = false): Attempt<never> => ({
  ok: false,
  cutOff,
  final: false,
  declined: false,
  issue,
})

async function attempt<T>(
  input: AnswerInput<T>,
  request: LLMTaskRequest,
  call: AnswerCall,
): Promise<Attempt<T>> {
  let reply: { text: string; truncated?: boolean }
  try {
    reply = await input.complete(request, call)
  } catch (error) {
    // Only a cut-off from the call is the answer's fault; anything else the
    // call throws (a rejected key, a budget stop, a provider error) is not.
    if (isCutOff(error)) return refused(error.message, true)
    // The provider refused the content: the identical request is refused again.
    if (error instanceof ContentPolicyError) {
      return { ok: false, cutOff: false, final: true, declined: false, issue: error.message }
    }
    // A call-side ValidationError (a rejected key, an exhausted balance, a
    // preflight miss) is wrapped as spec 2.1 says: Inngest would retry it blind.
    if (error instanceof ValidationError) {
      throw new NonRetriableError(error.message, { cause: error })
    }
    throw error
  }
  if (input.truncatedIsCutOff && reply.truncated === true) return refused(ANSWER_CUT_OFF, true)
  const repairs: Repair[] = []
  try {
    const value = input.parse(reply.text, (repair) => {
      repairs.push(repair)
    })
    return { ok: true, value, repairs }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    if (error instanceof AnswerDeclined) {
      return { ok: false, cutOff: false, final: true, declined: true, issue: error.message }
    }
    return refused(error.message, isCutOff(error) || reply.truncated === true)
  }
}

function landed<T>(attempted: { value: T; repairs: Repair[] }, calls: 1 | 2): Answer<T> {
  return attempted.repairs.length > 0
    ? { ok: true, value: attempted.value, calls, repairs: attempted.repairs }
    : { ok: true, value: attempted.value, calls }
}

function stopped(issue: string, calls: 1 | 2, declined: boolean): Answer<never> {
  return declined ? { ok: false, issue, calls, declined: true } : { ok: false, issue, calls }
}

export async function callForAnswer<T>(input: AnswerInput<T>): Promise<Answer<T>> {
  const cutOffIssue = input.cutOffIssue ?? ANSWER_CUT_OFF
  const first = await attempt(input, input.request, 'answer')
  if (first.ok) return landed(first, 1)
  if (first.final) return stopped(first.issue, 1, first.declined)

  let retry: LLMTaskRequest
  let call: AnswerCall
  if (first.cutOff) {
    // The same budget is cut off at the same place; only a bigger one can help.
    if (input.request.maxTokens >= MAX_OUTPUT_TOKENS) return stopped(cutOffIssue, 1, false)
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

  const second = await attempt(input, retry, call)
  if (second.ok) return landed(second, 2)
  return stopped(second.cutOff ? cutOffIssue : second.issue, 2, second.declined)
}

/**
 * A plain-text answer (a chapter, the weekly digest, a rewritten passage):
 * the same two calls, but a truncated reply is always a cut-off, so nothing
 * half-written is kept, and an empty reply is refused once with its reason.
 */
export function callForText(input: {
  request: LLMTaskRequest
  complete: AnswerComplete
  cutOffIssue?: string
}): Promise<Answer<string>> {
  return callForAnswer({
    ...input,
    parse: (text) => {
      if (text.trim() === '') throw new ValidationError(EMPTY_ANSWER, { field: 'text' })
      return text
    },
    truncatedIsCutOff: true,
  })
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
