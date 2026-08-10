import { createHash } from 'node:crypto'
import { ContentPolicyError, RateLimitError, TransientProviderError } from '@boom-busters/schemas'
import type { LlmProvider } from '@boom-busters/schemas'
import type { CallOptions, KnownModel, LLMProvider, LLMResult, LLMTaskRequest } from './types'

/**
 * The adapter every test and every `MOCK_PROVIDERS=1` run talks to.
 *
 * CLAUDE.md rule 6: nothing calls a paid API during development unless the
 * human asks for it. So the mock is not a stub bolted on beside the real
 * adapters — it implements the same `LLMProvider` interface and is selected by
 * the same registry, which means the code path under test in CI is the code
 * path that runs in production, minus the vendor.
 *
 * Determinism is the point. Output is a pure function of the request, so a
 * fixture project produces byte-identical dossiers and scripts on every run and
 * a golden test can assert on them. There is no `Math.random()` and no
 * `Date.now()` anywhere in this file.
 */

export interface MockScript {
  /**
   * Answer a request. Return a string for the completion text, or throw to
   * exercise a failure path. `undefined` falls through to the default
   * deterministic filler.
   */
  respond?: (request: LLMTaskRequest, model: string) => string | undefined
  /**
   * Fail the first N calls with this error before answering normally — the
   * router's retry and fallback tests are built on it.
   */
  failFirst?: { times: number; error: () => Error }
  /** Reject every key except these, for pre-flight tests. */
  validKeys?: readonly string[]
}

export interface MockLLM extends LLMProvider {
  /** Every request this adapter has been handed, in order. */
  readonly calls: { request: LLMTaskRequest; model: string }[]
  reset(): void
}

const MOCK_MODELS: readonly KnownModel[] = [
  { id: 'mock-large', label: 'Mock Large', tier: 0, inputPerMTok: 15, outputPerMTok: 75, supportsBatch: true },
  { id: 'mock-medium', label: 'Mock Medium', tier: 1, inputPerMTok: 3, outputPerMTok: 15, supportsBatch: true },
  { id: 'mock-small', label: 'Mock Small', tier: 2, inputPerMTok: 1, outputPerMTok: 5, supportsBatch: false },
]

/** Stable pseudo-randomness: same request in, same number out, forever. */
function digest(input: string): number {
  return parseInt(createHash('sha256').update(input).digest('hex').slice(0, 8), 16)
}

function fingerprint(request: LLMTaskRequest, model: string): string {
  return [
    request.task,
    model,
    request.system,
    ...request.messages.map((m) => `${m.role}:${m.content}`),
  ].join('\n')
}

/**
 * Filler that is obviously filler.
 *
 * It would be easy to make this read like real narration, and that would be a
 * mistake: mock output that looks real ends up screenshotted, pasted into a
 * review, or mistaken for a working pipeline. Every mock answer says what it
 * is, so nobody is ever fooled by it — the same reason the M2 demo pipeline's
 * gate cards say "nothing was actually researched".
 */
function defaultResponse(request: LLMTaskRequest, model: string): string {
  const seed = digest(fingerprint(request, model))
  return [
    `[mock ${model}] ${request.task} response`,
    '',
    `Nothing was sent to a provider. This text is generated locally from a hash`,
    `of the request (${seed.toString(16)}) so that re-running produces exactly`,
    `the same words.`,
  ].join('\n')
}

/**
 * Token counts that move with the input, because a mock that always reports
 * the same usage would make the cost guard's arithmetic untestable and would
 * hide a runaway prompt in development.
 */
function usageFor(request: LLMTaskRequest, text: string) {
  const promptChars =
    request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0)
  const cacheable = request.cacheablePrefixMessages ?? 0
  const cachedChars = request.messages
    .slice(0, cacheable)
    .reduce((n, m) => n + m.content.length, 0)

  // ~4 characters per token is the usual rule of thumb and close enough that
  // mock-mode cost figures land in the right order of magnitude.
  return {
    inputTokens: Math.ceil(promptChars / 4),
    outputTokens: Math.ceil(text.length / 4),
    cachedInputTokens: cachedChars > 0 ? Math.ceil(cachedChars / 4) : undefined,
  }
}

export function createMockLLM(
  script: MockScript = {},
  id: LlmProvider = 'anthropic',
): MockLLM {
  const calls: { request: LLMTaskRequest; model: string }[] = []
  let failuresLeft = script.failFirst?.times ?? 0

  return {
    id,
    models: MOCK_MODELS,
    calls,

    reset() {
      calls.length = 0
      failuresLeft = script.failFirst?.times ?? 0
    },

    async complete(request: LLMTaskRequest, options: CallOptions): Promise<LLMResult> {
      calls.push({ request, model: options.model })

      if (failuresLeft > 0) {
        failuresLeft -= 1
        throw script.failFirst?.error() ?? new TransientProviderError(id, 'mock failure')
      }

      const text = script.respond?.(request, options.model) ?? defaultResponse(request, options.model)
      const usage = usageFor(request, text)

      return {
        text,
        usage,
        provider: id,
        model: options.model,
        truncated: usage.outputTokens > request.maxTokens,
      }
    },

    async verifyKey(apiKey: string): Promise<void> {
      const valid = script.validKeys
      if (valid && !valid.includes(apiKey)) {
        throw new ContentPolicyError(id, 'mock rejected this key')
      }
    },
  }
}

/** Ready-made failures for router and retry tests. */
export const mockFailures = {
  overloaded: () => new TransientProviderError('mock', 'overloaded', { status: 529 }),
  serverError: () => new TransientProviderError('mock', 'internal error', { status: 500 }),
  rateLimited: () => new RateLimitError('mock', 'slow down', { status: 429, retryAfterMs: 1_000 }),
  refused: () => new ContentPolicyError('mock', 'refused the prompt'),
}
