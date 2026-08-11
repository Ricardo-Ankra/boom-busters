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
 * Google Gemini adapter.
 *
 * PRICES ARE PROVISIONAL — see the note in `anthropic.ts`. Confirm against the
 * current price list before the first live run.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export const GOOGLE_MODELS: readonly KnownModel[] = [
  {
    id: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    tier: 0,
    inputPerMTok: 5,
    outputPerMTok: 15,
    cachedInputPerMTok: 1.25,
    supportsBatch: true,
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3 Flash',
    tier: 1,
    inputPerMTok: 0.5,
    outputPerMTok: 2,
    cachedInputPerMTok: 0.125,
    supportsBatch: true,
  },
]

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    cachedContentTokenCount?: number
  }
}

export const google: LLMProvider = {
  id: 'google',
  models: GOOGLE_MODELS,

  async complete(request: LLMTaskRequest, options: CallOptions): Promise<LLMResult> {
    const doFetch = options.fetchImpl ?? fetch

    let response: Response
    try {
      response = await doFetch(`${BASE}/${options.model}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Header rather than the ?key= query parameter: an API key in a URL
          // ends up in access logs and error reports.
          'x-goog-api-key': options.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: request.messages.map((m) => ({
            // Gemini calls the assistant "model"; every other vendor does not.
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
          generationConfig: { maxOutputTokens: request.maxTokens },
        }),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    } catch (cause) {
      throw mapNetworkError('google', cause)
    }

    if (!response.ok) await throwForResponse('google', response)

    const payload = (await response.json()) as GeminiResponse
    const candidate = payload.candidates?.[0]
    const text = (candidate?.content?.parts ?? []).map((p) => p.text ?? '').join('')
    const cached = payload.usageMetadata?.cachedContentTokenCount ?? 0

    return {
      text,
      usage: {
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        ...(cached > 0 ? { cachedInputTokens: cached } : {}),
      },
      provider: 'google',
      model: options.model,
      truncated: candidate?.finishReason === 'MAX_TOKENS',
    }
  },

  async verifyKey(apiKey: string, options: VerifyOptions = {}): Promise<void> {
    await this.complete(
      { task: 'digest', system: '', messages: [{ role: 'user', content: 'ping' }], maxTokens: 1 },
      {
        apiKey,
        model: GOOGLE_MODELS[GOOGLE_MODELS.length - 1]!.id,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      },
    )
  },
}
