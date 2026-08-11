import { ValidationError } from '@boom-busters/schemas'
import { mapNetworkError, throwForResponse } from './http'
import type {
  CallOptions,
  KnownModel,
  LLMProvider,
  LLMResult,
  LLMTaskRequest,
  VerifyOptions,
} from './types'

/**
 * Anthropic adapter.
 *
 * PRICES ARE PROVISIONAL. The figures below are carried over from the M2
 * placeholder table and have not been checked against Anthropic's current
 * price list. They are good enough to exercise the budget guard's arithmetic
 * and wrong enough that they must be confirmed before the first live run —
 * a cap enforced against stale prices is a cap that does not hold.
 */

const API = 'https://api.anthropic.com/v1/messages'
const VERSION = '2023-06-01'

export const ANTHROPIC_MODELS: readonly KnownModel[] = [
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    tier: 0,
    inputPerMTok: 15,
    outputPerMTok: 75,
    cachedInputPerMTok: 1.5,
    supportsBatch: true,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    tier: 1,
    inputPerMTok: 3,
    outputPerMTok: 15,
    cachedInputPerMTok: 0.3,
    supportsBatch: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    tier: 2,
    inputPerMTok: 1,
    outputPerMTok: 5,
    cachedInputPerMTok: 0.1,
    supportsBatch: true,
  },
]

interface AnthropicContentBlock {
  type: string
  text?: string
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  stop_reason?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_read_input_tokens?: number
  }
}

/**
 * Anthropic marks a cached prefix with `cache_control` on the *last* block
 * that should be cached, so a prefix of N messages becomes a marker on message
 * N-1 rather than N separate flags.
 */
function buildMessages(request: LLMTaskRequest) {
  const cacheUpTo = (request.cacheablePrefixMessages ?? 0) - 1

  return request.messages.map((message, index) => ({
    role: message.role,
    content: [
      {
        type: 'text' as const,
        text: message.content,
        ...(index === cacheUpTo ? { cache_control: { type: 'ephemeral' as const } } : {}),
      },
    ],
  }))
}

export const anthropic: LLMProvider = {
  id: 'anthropic',
  models: ANTHROPIC_MODELS,

  async complete(request: LLMTaskRequest, options: CallOptions): Promise<LLMResult> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': options.apiKey,
          'anthropic-version': VERSION,
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: buildMessages(request),
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('anthropic', cause)
    }

    if (!response.ok) await throwForResponse('anthropic', response)

    const payload = (await response.json()) as AnthropicResponse
    const blocks = payload.content ?? []
    const text = blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')

    const cached = payload.usage?.cache_read_input_tokens ?? 0
    const outputTokens = payload.usage?.output_tokens ?? 0

    /**
     * The model spent its whole output budget and wrote nothing we can read.
     *
     * This is not "the model returned no JSON" — it answered, at full price,
     * and the answer never reached a text block. In practice that means
     * `max_tokens` was too small for the model to think and then write:
     * reasoning blocks consume the same budget, so a generous-looking 1,300
     * tokens can be exhausted before the first character of the reply.
     *
     * Reported here rather than left to the JSON parser, because the parser
     * can only say "no JSON" and send you looking at the prompt — which is not
     * where the problem is. `ValidationError` because it is not worth
     * retrying: the identical request truncates identically.
     */
    if (text.trim() === '' && payload.stop_reason === 'max_tokens') {
      const kinds = [...new Set(blocks.map((block) => block.type))]
      throw new ValidationError(
        `anthropic/${options.model} used all ${outputTokens} output tokens without producing ` +
          `any text${kinds.length > 0 ? ` (it returned only: ${kinds.join(', ')})` : ''}. ` +
          `maxTokens was ${request.maxTokens} — raise it for this task.`,
        { field: 'maxTokens' },
      )
    }

    return {
      text,
      usage: {
        // Anthropic reports cache reads separately from `input_tokens`;
        // priceOf() expects the total, so add them back together here rather
        // than making every caller remember which vendor splits them.
        inputTokens: (payload.usage?.input_tokens ?? 0) + cached,
        outputTokens,
        ...(cached > 0 ? { cachedInputTokens: cached } : {}),
      },
      provider: 'anthropic',
      model: options.model,
      truncated: payload.stop_reason === 'max_tokens',
    }
  },

  /**
   * Prove the key, and deliberately ignore the answer.
   *
   * It does not go through `complete()`, because a one-token request always
   * stops at `max_tokens` with nothing written — which `complete()` now treats
   * as a broken call, correctly, and which would make Verify fail on a
   * perfectly good key. What is being tested here is authentication, so the
   * only thing that matters is whether the request was accepted.
   */
  async verifyKey(apiKey: string, options: VerifyOptions = {}): Promise<void> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': VERSION,
        },
        body: JSON.stringify({
          // The cheapest model and a single token: a health check nobody can
          // afford to press is not a health check.
          model: ANTHROPIC_MODELS[ANTHROPIC_MODELS.length - 1]!.id,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('anthropic', cause)
    }

    if (!response.ok) await throwForResponse('anthropic', response)
  },
}
