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
    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('')

    const cached = payload.usage?.cache_read_input_tokens ?? 0

    return {
      text,
      usage: {
        // Anthropic reports cache reads separately from `input_tokens`;
        // priceOf() expects the total, so add them back together here rather
        // than making every caller remember which vendor splits them.
        inputTokens: (payload.usage?.input_tokens ?? 0) + cached,
        outputTokens: payload.usage?.output_tokens ?? 0,
        ...(cached > 0 ? { cachedInputTokens: cached } : {}),
      },
      provider: 'anthropic',
      model: options.model,
      truncated: payload.stop_reason === 'max_tokens',
    }
  },

  async verifyKey(apiKey: string, options: VerifyOptions = {}): Promise<void> {
    // One token from the cheapest model: enough to prove the key, small enough
    // that the Verify button in Settings costs nothing worth measuring.
    await this.complete(
      { task: 'digest', system: '', messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
      {
        apiKey,
        model: ANTHROPIC_MODELS[ANTHROPIC_MODELS.length - 1]!.id,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      },
    )
  },
}
