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
 *
 * **The ids are not provisional any more.** They were, and they were wrong:
 * `gemini-3-pro` and `gemini-3-flash` never existed, so the first real key ever
 * pointed at this adapter got a 404 from the Verify button — a key that was
 * perfectly good, reported as refused. The list below was read off
 * `GET /v1beta/models` with a live key on 2026-08-13.
 *
 * **Stable ids only, no `-preview`.** The catalogue is full of previews, and
 * `gemini-3.1-pro-preview` is the most capable model on offer — but a preview
 * id is withdrawn without notice, and the failure mode is exactly the one this
 * comment exists because of: a routing matrix that was valid when it was saved
 * and 404s months later, mid-run. A stable model that is one notch less capable
 * is worth more than a preview that stops existing.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export const GOOGLE_MODELS: readonly KnownModel[] = [
  /**
   * An alias, not a pinned id, and the only one in this file.
   *
   * Google offers no *stable* concrete Pro: every one in the catalogue is
   * either a `-preview` or, like `gemini-2.5-pro`, listed by `GET /models` and
   * then answering `generateContent` with "no longer available to new users".
   * A listing is not an offer, which is worth knowing — the model list cannot
   * be trusted on its own.
   *
   * So the top tier tracks whatever Google currently calls Pro. The cost is
   * that its price can move under the estimate; the alternative was pinning an
   * id that is already 404ing or one that vanishes without notice.
   */
  {
    id: 'gemini-pro-latest',
    label: 'Gemini Pro (latest)',
    tier: 0,
    inputPerMTok: 1.25,
    outputPerMTok: 10,
    cachedInputPerMTok: 0.31,
    supportsBatch: true,
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    tier: 1,
    inputPerMTok: 0.5,
    outputPerMTok: 2,
    cachedInputPerMTok: 0.125,
    supportsBatch: true,
  },
  {
    id: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    tier: 2,
    inputPerMTok: 0.35,
    outputPerMTok: 1.5,
    cachedInputPerMTok: 0.09,
    supportsBatch: true,
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite',
    tier: 3,
    inputPerMTok: 0.1,
    outputPerMTok: 0.4,
    cachedInputPerMTok: 0.025,
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
