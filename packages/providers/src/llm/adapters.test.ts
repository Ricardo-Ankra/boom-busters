import {
  ContentPolicyError,
  RateLimitError,
  TransientProviderError,
  ValidationError,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { anthropic } from './anthropic'
import { google } from './google'
import { openai } from './openai'
import { parseRetryAfter } from './http'
import { LLM_MODELS, knownModel, llmAdapters, topModel } from './registry'
import type { LLMProvider, LLMTaskRequest } from './types'

/**
 * Adapters are tested against recorded response bodies (spec section 13), not
 * against the live APIs: a suite that needed network access would cost money
 * to run and would go red when a vendor had an outage.
 */

const request: LLMTaskRequest = {
  task: 'research',
  system: 'Be precise.',
  messages: [{ role: 'user', content: 'Enron' }],
  maxTokens: 100,
}

function respondWith(body: unknown, init: ResponseInit = {}): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })) as unknown as typeof fetch
}

/** Recorded shapes, trimmed to the fields the adapters actually read. */
const FIXTURES = {
  anthropic: {
    content: [{ type: 'text', text: 'Enron collapsed in 2001.' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 900, output_tokens: 40, cache_read_input_tokens: 100 },
  },
  openai: {
    choices: [{ message: { content: 'Enron collapsed in 2001.' }, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 40,
      prompt_tokens_details: { cached_tokens: 100 },
    },
  },
  google: {
    candidates: [
      { content: { parts: [{ text: 'Enron collapsed in 2001.' }] }, finishReason: 'STOP' },
    ],
    usageMetadata: {
      promptTokenCount: 1000,
      candidatesTokenCount: 40,
      cachedContentTokenCount: 100,
    },
  },
}

const CASES: { name: string; adapter: LLMProvider; fixture: unknown; truncatedFixture: unknown }[] =
  [
    {
      name: 'anthropic',
      adapter: anthropic,
      fixture: FIXTURES.anthropic,
      truncatedFixture: { ...FIXTURES.anthropic, stop_reason: 'max_tokens' },
    },
    {
      name: 'openai',
      adapter: openai,
      fixture: FIXTURES.openai,
      truncatedFixture: {
        ...FIXTURES.openai,
        choices: [{ message: { content: 'x' }, finish_reason: 'length' }],
      },
    },
    {
      name: 'google',
      adapter: google,
      fixture: FIXTURES.google,
      truncatedFixture: {
        ...FIXTURES.google,
        candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'MAX_TOKENS' }],
      },
    },
  ]

describe.each(CASES)('$name adapter', ({ adapter, fixture, truncatedFixture }) => {
  const model = adapter.models[0]!.id

  it('reads the completion text out of its own response shape', async () => {
    const result = await adapter.complete(request, {
      apiKey: 'k',
      model,
      fetchImpl: respondWith(fixture),
    })

    expect(result.text).toBe('Enron collapsed in 2001.')
    expect(result.provider).toBe(adapter.id)
    expect(result.model).toBe(model)
  })

  it('normalises usage so input tokens always mean the same thing', async () => {
    const result = await adapter.complete(request, {
      apiKey: 'k',
      model,
      fetchImpl: respondWith(fixture),
    })

    // Anthropic reports cache reads outside `input_tokens`; the others include
    // them. Every adapter must end up reporting the total, or the same prompt
    // would cost different amounts depending on who answered.
    expect(result.usage.inputTokens).toBe(1000)
    expect(result.usage.outputTokens).toBe(40)
    expect(result.usage.cachedInputTokens).toBe(100)
  })

  it('flags a truncated answer', async () => {
    const result = await adapter.complete(request, {
      apiKey: 'k',
      model,
      fetchImpl: respondWith(truncatedFixture),
    })

    expect(result.truncated).toBe(true)
  })

  it('maps 5xx to a retriable error', async () => {
    await expect(
      adapter.complete(request, {
        apiKey: 'k',
        model,
        fetchImpl: respondWith('upstream exploded', { status: 503 }),
      }),
    ).rejects.toThrow(TransientProviderError)
  })

  it('maps 429 to a rate limit carrying retry-after', async () => {
    const failing = (async () =>
      new Response('slow down', {
        status: 429,
        headers: { 'retry-after': '3' },
      })) as unknown as typeof fetch

    const error = await adapter
      .complete(request, { apiKey: 'k', model, fetchImpl: failing })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(RateLimitError)
    expect((error as RateLimitError).retryAfterMs).toBe(3000)
  })

  it('maps 401 to a non-retriable error pointing at Connections', async () => {
    const error = await adapter
      .complete(request, {
        apiKey: 'bad',
        model,
        fetchImpl: respondWith('unauthorized', { status: 401 }),
      })
      .catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as Error).message).toMatch(/Settings → Connections/)
  })

  it('maps a content refusal to ContentPolicyError, not a retry', async () => {
    await expect(
      adapter.complete(request, {
        apiKey: 'k',
        model,
        fetchImpl: respondWith('{"error":"blocked by safety filters"}', { status: 400 }),
      }),
    ).rejects.toThrow(ContentPolicyError)
  })

  it('treats an unreachable network as transient', async () => {
    const broken = (async () => {
      throw new Error('ECONNRESET')
    }) as unknown as typeof fetch

    await expect(
      adapter.complete(request, { apiKey: 'k', model, fetchImpl: broken }),
    ).rejects.toThrow(TransientProviderError)
  })

  it('sends the API key in a header, never in the URL', async () => {
    let seenUrl = ''
    let seenHeaders: Record<string, string> = {}
    const capture = (async (url: string, init: RequestInit) => {
      seenUrl = String(url)
      seenHeaders = (init.headers ?? {}) as Record<string, string>
      return new Response(JSON.stringify(fixture), { status: 200 })
    }) as unknown as typeof fetch

    await adapter.complete(request, { apiKey: 'secret-key', model, fetchImpl: capture })

    expect(seenUrl).not.toContain('secret-key')
    expect(JSON.stringify(seenHeaders)).toContain('secret-key')
  })

  it('verifies a key with its cheapest model and a one-token request', async () => {
    let seenBody: Record<string, unknown> = {}
    let seenUrl = ''
    const capture = (async (url: string, init: RequestInit) => {
      seenUrl = String(url)
      seenBody = JSON.parse(String(init.body)) as Record<string, unknown>
      return new Response(JSON.stringify(fixture), { status: 200 })
    }) as unknown as typeof fetch

    await adapter.verifyKey('k', { fetchImpl: capture })

    const cheapest = adapter.models[adapter.models.length - 1]!
    // Gemini names the model in the path; the other two put it in the body.
    expect(`${seenUrl} ${JSON.stringify(seenBody)}`).toContain(cheapest.id)
    // A Verify button that quietly spends real money on every click is not a
    // free health check, so assert the token cap as well as the model.
    expect(
      seenBody['max_tokens'] ??
        seenBody['max_completion_tokens'] ??
        (seenBody['generationConfig'] as { maxOutputTokens?: number })?.maxOutputTokens,
    ).toBe(1)
  })

  it('surfaces a bad key from verifyKey without retrying it', async () => {
    await expect(
      adapter.verifyKey('bad', {
        fetchImpl: respondWith('unauthorized', { status: 401 }),
      }),
    ).rejects.toThrow(ValidationError)
  })
})

describe('the package as a whole', () => {
  /**
   * Written after a test in this file called Anthropic, OpenAI and Google for
   * real, because `verifyKey` had no way to inject `fetch`. The keys were
   * rubbish so nothing was charged, but the suite reached three paid APIs
   * across the network, which CLAUDE.md rule 6 forbids outright.
   *
   * Injectability is therefore not a testing convenience here — it is the
   * mechanism that keeps that from happening again, so it is asserted.
   */
  it('routes every outbound call through an injectable fetch', async () => {
    const forbidden = (() => {
      throw new Error('a test reached the network')
    }) as unknown as typeof fetch

    for (const { adapter } of CASES) {
      const intercepted = (async () =>
        new Response(JSON.stringify(FIXTURES.anthropic), {
          status: 200,
        })) as unknown as typeof fetch

      const original = globalThis.fetch
      globalThis.fetch = forbidden
      try {
        await adapter.complete(request, {
          apiKey: 'k',
          model: adapter.models[0]!.id,
          fetchImpl: intercepted,
        })
        await adapter.verifyKey('k', { fetchImpl: intercepted })
      } finally {
        globalThis.fetch = original
      }
    }
  })
})

describe('parseRetryAfter', () => {
  it('reads seconds', () => {
    expect(parseRetryAfter('12', 0)).toBe(12_000)
  })

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000)
  })

  it('never returns a negative wait for a date already past', () => {
    const now = Date.parse('2026-01-01T00:01:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0)
  })

  it('is undefined when the header is missing or nonsense', () => {
    expect(parseRetryAfter(null, 0)).toBeUndefined()
    expect(parseRetryAfter('soon', 0)).toBeUndefined()
  })
})

describe('the adapter registry', () => {
  it('serves mocks only when MOCK_PROVIDERS is exactly 1', () => {
    expect(llmAdapters({ MOCK_PROVIDERS: '1' }).anthropic.models[0]?.id).toMatch(/^mock-/)
    expect(llmAdapters({ MOCK_PROVIDERS: 'true' }).anthropic.models[0]?.id).not.toMatch(/^mock-/)
    expect(llmAdapters({}).anthropic.models[0]?.id).not.toMatch(/^mock-/)
  })

  it('offers the live model line-up to Settings even in mock mode', () => {
    // Settings outlives a test run; writing "mock-large" into the routing
    // matrix would leave nonsense behind after the mocks were switched off.
    expect(
      Object.values(LLM_MODELS)
        .flat()
        .map((m) => m.id),
    ).not.toContain('mock-large')
  })

  it('gives every provider at least two tiers, so a tier-down exists', () => {
    for (const models of Object.values(LLM_MODELS)) {
      expect(models.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('has no duplicate tiers within a provider', () => {
    for (const models of Object.values(LLM_MODELS)) {
      const tiers = models.map((m) => m.tier)
      expect(new Set(tiers).size).toBe(tiers.length)
    }
  })

  it('prices every listed model — an unpriced model walks through every cap', () => {
    for (const models of Object.values(LLM_MODELS)) {
      for (const model of models) {
        expect(model.inputPerMTok).toBeGreaterThan(0)
        expect(model.outputPerMTok).toBeGreaterThan(0)
      }
    }
  })

  it('never prices cached input above fresh input', () => {
    for (const models of Object.values(LLM_MODELS)) {
      for (const model of models) {
        if (model.cachedInputPerMTok === undefined) continue
        expect(model.cachedInputPerMTok).toBeLessThanOrEqual(model.inputPerMTok)
      }
    }
  })

  it('looks a model up and finds the top of each line-up', () => {
    expect(knownModel('anthropic', 'claude-opus-5')?.tier).toBe(0)
    expect(knownModel('anthropic', 'nope')).toBeUndefined()
    expect(topModel('google').tier).toBe(0)
  })
})
