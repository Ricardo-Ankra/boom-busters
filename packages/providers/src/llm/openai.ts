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
 * OpenAI adapter.
 *
 * PRICES ARE PROVISIONAL — see the note in `anthropic.ts`. Confirm against the
 * current price list before the first live run.
 */

const API = 'https://api.openai.com/v1/chat/completions'

export const OPENAI_MODELS: readonly KnownModel[] = [
  {
    id: 'gpt-5',
    label: 'GPT-5',
    tier: 0,
    inputPerMTok: 10,
    outputPerMTok: 30,
    cachedInputPerMTok: 1.25,
    supportsBatch: true,
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    tier: 1,
    inputPerMTok: 1,
    outputPerMTok: 4,
    cachedInputPerMTok: 0.125,
    supportsBatch: true,
  },
]

interface OpenAIResponse {
  choices?: { message?: { content?: string }; finish_reason?: string }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
}

export const openai: LLMProvider = {
  id: 'openai',
  models: OPENAI_MODELS,

  async complete(request: LLMTaskRequest, options: CallOptions): Promise<LLMResult> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          max_completion_tokens: request.maxTokens,
          // OpenAI has no separate system parameter on this endpoint; the
          // system prompt is the first message, which is also what makes its
          // automatic prefix caching cover it.
          messages: [
            { role: 'system', content: request.system },
            ...request.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('openai', cause)
    }

    if (!response.ok) await throwForResponse('openai', response)

    const payload = (await response.json()) as OpenAIResponse
    const choice = payload.choices?.[0]
    const cached = payload.usage?.prompt_tokens_details?.cached_tokens ?? 0

    return {
      text: choice?.message?.content ?? '',
      usage: {
        // `prompt_tokens` already includes the cached ones here — the opposite
        // of Anthropic's split, which is exactly why this normalisation lives
        // in the adapters rather than in the router.
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        ...(cached > 0 ? { cachedInputTokens: cached } : {}),
      },
      provider: 'openai',
      model: options.model,
      truncated: choice?.finish_reason === 'length',
    }
  },

  async verifyKey(apiKey: string, options: VerifyOptions = {}): Promise<void> {
    await this.complete(
      { task: 'digest', system: '', messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
      {
        apiKey,
        model: OPENAI_MODELS[OPENAI_MODELS.length - 1]!.id,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      },
    )
  },
}
