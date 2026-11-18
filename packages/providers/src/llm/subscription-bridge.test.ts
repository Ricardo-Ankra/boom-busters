import {
  BridgeAnswerPending,
  isGated,
  isRetriable,
  SubscriptionBridgeUnavailableError,
  TransientProviderError,
  ValidationError,
} from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_TIMESTAMP_HEADER,
  verifyBridgeSignature,
  type BridgeCompleteResponse,
} from './bridge-protocol'
import { createMockLLM } from './mock'
import { resetBridgeHealthCache, withSubscriptionBridge } from './subscription-bridge'
import type { LLMTaskRequest } from './types'

const URL_BASE = 'https://my-pc.tailnet.ts.net'
const SECRET = 'a-secret-that-is-long-enough-for-hmac-0123'

const request: LLMTaskRequest = {
  task: 'research',
  system: 'You research collapses.',
  messages: [
    { role: 'user', content: 'Enron' },
    { role: 'assistant', content: '{"brief":1}' },
    { role: 'user', content: 'Now the scenes.' },
  ],
  maxTokens: 4000,
  cacheablePrefixMessages: 1,
}

const answer: BridgeCompleteResponse = {
  text: '{"scenes":[]}',
  usage: { inputTokens: 1200, outputTokens: 300, cachedInputTokens: 1000 },
  model: 'claude-opus-5',
  truncated: false,
}

interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

/**
 * A fetch that answers the health check and the completion separately. Each
 * handler gets what was sent; `null` for health means "the PC is off".
 */
function fakeFetch(handlers: {
  health?: (() => Response) | null
  complete?: (seen: Seen) => Response
}) {
  const seen: Seen[] = []
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    const entry: Seen = {
      url,
      method: init?.method ?? 'GET',
      headers: { ...(init?.headers as Record<string, string>) },
      body: typeof init?.body === 'string' ? init.body : '',
    }
    seen.push(entry)
    if (url.endsWith('/health')) {
      if (handlers.health === null) throw new TypeError('fetch failed')
      return handlers.health ? handlers.health() : Response.json({ ok: true })
    }
    return handlers.complete ? handlers.complete(entry) : Response.json(answer)
  })
  return { impl: impl as unknown as typeof fetch, seen, calls: impl }
}

function bridged(fetchImpl: typeof fetch, base = createMockLLM({}, 'anthropic')) {
  return {
    base,
    adapter: withSubscriptionBridge(base, { url: URL_BASE, secret: SECRET, fetchImpl }),
  }
}

const options = { apiKey: 'sk-ant-api-key-never-used', model: 'claude-opus-5' }

beforeEach(() => resetBridgeHealthCache())

describe('withSubscriptionBridge (decision 469)', () => {
  it('answers through the PC, signed, and marks the call as subscription-billed', async () => {
    const { impl, seen } = fakeFetch({})
    const { base, adapter } = bridged(impl)

    const result = await adapter.complete(request, options)

    expect(result).toEqual({
      text: answer.text,
      usage: answer.usage,
      provider: 'anthropic',
      model: 'claude-opus-5',
      truncated: false,
      billing: 'subscription',
    })
    // The API key path was never touched.
    expect(base.calls).toHaveLength(0)

    const post = seen.find((s) => s.url === `${URL_BASE}/complete`)!
    expect(JSON.parse(post.body)).toEqual({
      model: 'claude-opus-5',
      request: {
        task: 'research',
        system: request.system,
        messages: request.messages,
        maxTokens: 4000,
        cacheablePrefixMessages: 1,
      },
    })
    // The API key never crosses the wire to the PC.
    expect(post.body).not.toContain(options.apiKey)
    expect(JSON.stringify(post.headers)).not.toContain(options.apiKey)
    expect(
      verifyBridgeSignature(SECRET, {
        method: 'POST',
        path: '/complete',
        body: post.body,
        timestamp: post.headers[BRIDGE_TIMESTAMP_HEADER],
        signature: post.headers[BRIDGE_SIGNATURE_HEADER],
      }),
    ).toBe('ok')
  })

  it('parks the run when the PC does not answer, and never falls back to the API key', async () => {
    const { impl, seen } = fakeFetch({ health: null })
    const { base, adapter } = bridged(impl)

    const error = await adapter.complete(request, options).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(SubscriptionBridgeUnavailableError)
    expect(error).toMatchObject({
      reason: 'offline',
      provider: 'anthropic',
      operation: 'llm.research',
    })
    // Parks on the budget gate every runner already has, and the router
    // must not walk on to another provider's paid model.
    expect(isGated(error)).toBe(true)
    expect(isRetriable(error)).toBe(false)
    expect(seen.map((s) => s.url)).toEqual([`${URL_BASE}/health`])
    expect(base.calls).toHaveLength(0)
  })

  it('parks when the health check answers with an error status', async () => {
    const { impl } = fakeFetch({ health: () => new Response('bad gateway', { status: 502 }) })
    const { adapter } = bridged(impl)

    await expect(adapter.complete(request, options)).rejects.toMatchObject({ reason: 'offline' })
  })

  it('parks with a fix-the-secret message when the PC refuses the signature', async () => {
    const { impl } = fakeFetch({ health: () => new Response('', { status: 401 }) })
    const { adapter } = bridged(impl)

    const error = await adapter.complete(request, options).catch((e: unknown) => e)
    expect(error).toMatchObject({ reason: 'auth' })
    expect((error as Error).message).toContain('LLM_BRIDGE_SECRET')
  })

  it('parks when the Claude plan limit is spent', async () => {
    const { impl } = fakeFetch({
      complete: () =>
        Response.json(
          { error: { kind: 'plan-limit', message: 'five_hour limit is reached' } },
          { status: 429 },
        ),
    })
    const { adapter } = bridged(impl)

    const error = await adapter.complete(request, options).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SubscriptionBridgeUnavailableError)
    expect(error).toMatchObject({ reason: 'plan-limit' })
    expect((error as Error).message).toContain('five_hour limit is reached')
  })

  it('parks with a setup-token message when Claude refuses the subscription token', async () => {
    const { impl } = fakeFetch({
      complete: () =>
        Response.json({ error: { kind: 'auth', message: 'OAuth token expired' } }, { status: 403 }),
    })
    const { adapter } = bridged(impl)

    const error = await adapter.complete(request, options).catch((e: unknown) => e)
    expect(error).toMatchObject({ reason: 'auth' })
    expect((error as Error).message).toContain('claude setup-token')
  })

  it('reports a malformed request as a validation error, not worth retrying', async () => {
    const { impl } = fakeFetch({
      complete: () =>
        Response.json({ error: { kind: 'invalid', message: 'model not found' } }, { status: 400 }),
    })
    const { adapter } = bridged(impl)

    await expect(adapter.complete(request, options)).rejects.toBeInstanceOf(ValidationError)
  })

  it('reports an overloaded Anthropic as transient, so the router retries', async () => {
    const { impl } = fakeFetch({
      complete: () =>
        Response.json({ error: { kind: 'upstream', message: 'overloaded' } }, { status: 502 }),
    })
    const { adapter } = bridged(impl)

    const error = await adapter.complete(request, options).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TransientProviderError)
    expect(isRetriable(error)).toBe(true)
  })

  it('treats a dropped connection mid-call as transient and asks the PC again next time', async () => {
    let completes = 0
    const { impl, seen } = fakeFetch({
      complete: () => {
        completes += 1
        if (completes === 1) throw new TypeError('socket hang up')
        return Response.json(answer)
      },
    })
    const { adapter } = bridged(impl)

    await expect(adapter.complete(request, options)).rejects.toBeInstanceOf(TransientProviderError)
    await adapter.complete(request, options)

    expect(seen.filter((s) => s.url.endsWith('/health'))).toHaveLength(2)
  })

  it('trusts a good health check for a while instead of asking before every call', async () => {
    const { impl, seen } = fakeFetch({})
    const { adapter } = bridged(impl)

    await adapter.complete(request, options)
    await adapter.complete(request, options)

    expect(seen.filter((s) => s.url.endsWith('/health'))).toHaveLength(1)
    expect(seen.filter((s) => s.url.endsWith('/complete'))).toHaveLength(2)
  })

  it('names a too-small maxTokens when the answer is empty and cut off, as the API adapter does', async () => {
    const { impl } = fakeFetch({
      complete: () => Response.json({ ...answer, text: '', truncated: true }),
    })
    const { adapter } = bridged(impl)

    await expect(adapter.complete(request, options)).rejects.toMatchObject({ field: 'maxTokens' })
  })

  it('leaves Verify on the stored API key and keeps the adapter’s own model list', async () => {
    const base = createMockLLM({}, 'anthropic')
    const verify = vi.spyOn(base, 'verifyKey')
    const { impl, calls } = fakeFetch({})
    const adapter = withSubscriptionBridge(base, { url: URL_BASE, secret: SECRET, fetchImpl: impl })

    await adapter.verifyKey('sk-ant-stored')

    expect(verify).toHaveBeenCalledWith('sk-ant-stored', undefined)
    expect(calls).not.toHaveBeenCalled()
    expect(adapter.models).toBe(base.models)
  })
})

describe('a call run as a job (decision 472)', () => {
  const jobOf = (seen: Seen[]) =>
    (JSON.parse(seen.find((s) => s.url.endsWith('/complete'))!.body) as { job?: unknown }).job

  it('sends no job when the caller asks for none, as before', async () => {
    const { impl, seen } = fakeFetch({})
    await bridged(impl).adapter.complete(request, options)
    expect(jobOf(seen)).toBeUndefined()
  })

  it('keys the job on the attempt and the model, and passes the hold', async () => {
    const { impl, seen } = fakeFetch({})
    const { adapter } = bridged(impl)
    const bridgeJob = { scope: 'run-1/graphic-0-0:answer', holdMs: 165_000 }

    const result = await adapter.complete(request, { ...options, bridgeJob })

    expect(result.text).toBe(answer.text)
    const job = jobOf(seen) as { key: string; holdMs: number }
    expect(job.holdMs).toBe(165_000)
    expect(job.key).toBe('run-1/graphic-0-0:answer@claude-opus-5')

    // A request rebuilt in a later step from replayed, key-sorted data is the
    // same attempt: it must collect the same job, not start another.
    await adapter.complete({ ...request, system: 'Rebuilt.' }, { ...options, bridgeJob })
    await adapter.complete(request, {
      ...options,
      bridgeJob: { ...bridgeJob, scope: 'run-1/graphic-0-0-retry:retry: refused' },
    })
    const keys = seen
      .filter((s) => s.url.endsWith('/complete'))
      .map((s) => (JSON.parse(s.body) as { job: { key: string } }).job.key)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it('caps the hold at what the bridge accepts', async () => {
    const { impl, seen } = fakeFetch({})
    await bridged(impl).adapter.complete(request, {
      ...options,
      bridgeJob: { scope: 's', holdMs: 900_000 },
    })
    expect((jobOf(seen) as { holdMs: number }).holdMs).toBe(280_000)
  })

  it('throws BridgeAnswerPending on a 202, which nothing retries or parks', async () => {
    const { impl } = fakeFetch({
      complete: () => Response.json({ pending: true }, { status: 202 }),
    })
    const { adapter } = bridged(impl)

    const error = await adapter
      .complete(request, { ...options, bridgeJob: { scope: 'run-1:answer', holdMs: 1000 } })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BridgeAnswerPending)
    expect((error as BridgeAnswerPending).jobKey).toBe('run-1:answer@claude-opus-5')
    expect(isRetriable(error)).toBe(false)
    expect(isGated(error)).toBe(false)
  })
})
