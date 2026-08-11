import { ContentPolicyError, ValidationError } from '@boom-busters/schemas'
import type { ModelRouting } from '@boom-busters/schemas'
import { describe, expect, it, vi } from 'vitest'
import { createMockLLM, mockFailures } from './mock'
import { fallbackPath, preflight, route } from './router'
import type { Downgrade, RouterConfig } from './router'
import type { LLMTaskRequest } from './types'

const routing: ModelRouting = {
  research: { provider: 'anthropic', model: 'mock-large' },
  scripting: { provider: 'anthropic', model: 'mock-medium' },
  editing: { provider: 'anthropic', model: 'mock-small' },
  shotlist: { provider: 'anthropic', model: 'mock-small' },
  metadata: { provider: 'anthropic', model: 'mock-small' },
  digest: { provider: 'anthropic', model: 'mock-small' },
}

const request: LLMTaskRequest = {
  task: 'research',
  system: 'You research collapses.',
  messages: [{ role: 'user', content: 'Enron' }],
  maxTokens: 1000,
}

// Never actually wait: the router's backoff is real time, and a suite that
// honours it would spend seconds sleeping to prove arithmetic.
const noSleep = vi.fn(async () => {})

function config(overrides: Partial<RouterConfig> = {}): RouterConfig {
  return {
    routing,
    adapters: { anthropic: createMockLLM() },
    credentials: { anthropic: 'key-a' },
    sleepImpl: noSleep,
    randomImpl: () => 0.5,
    ...overrides,
  }
}

describe('preflight', () => {
  it('refuses before spending when the provider has no key', () => {
    const call = () => preflight(config({ credentials: {} }), 'research')

    expect(call).toThrow(ValidationError)
    // The message has to say where to fix it — spec section 6 requires the
    // pointer at Settings -> Connections, not merely a failure.
    expect(call).toThrow(/Settings → Connections/)
  })

  it('names the task whose routing is broken, not just the provider', () => {
    expect(() => preflight(config({ credentials: {} }), 'research')).toThrow(/"research"/)
  })

  it('refuses a model the adapter does not price', () => {
    const bad = config({
      routing: { ...routing, research: { provider: 'anthropic', model: 'mock-enormous' } },
    })

    expect(() => preflight(bad, 'research')).toThrow(/budget guard cannot estimate/)
  })

  it('refuses a provider with no adapter built', () => {
    const bad = config({
      routing: { ...routing, research: { provider: 'openai', model: 'mock-large' } },
      credentials: { anthropic: 'key-a', openai: 'key-o' },
    })

    expect(() => preflight(bad, 'research')).toThrow(/No adapter is built for openai/)
  })

  it('passes a fully configured task through', () => {
    const { choice } = preflight(config(), 'research')
    expect(choice).toEqual({ provider: 'anthropic', model: 'mock-large' })
  })
})

describe('fallbackPath', () => {
  it('is the configured model, then one tier down, then the chain', () => {
    const path = fallbackPath(
      config({
        adapters: { anthropic: createMockLLM(), google: createMockLLM({}, 'google') },
        credentials: { anthropic: 'key-a', google: 'key-g' },
        fallbackChain: ['google'],
      }),
      'research',
    )

    expect(path).toEqual([
      { provider: 'anthropic', model: 'mock-large' },
      { provider: 'anthropic', model: 'mock-medium' },
      { provider: 'google', model: 'mock-large' },
    ])
  })

  it('stops at the provider when no fallback chain is configured', () => {
    expect(fallbackPath(config(), 'research')).toHaveLength(2)
  })

  it('has no tier-down when already on the bottom model', () => {
    const path = fallbackPath(config(), 'editing')
    expect(path).toEqual([{ provider: 'anthropic', model: 'mock-small' }])
  })

  it('skips a chain provider with no key rather than refusing to run', () => {
    // The backup being unconfigured must not stop the primary from working.
    const path = fallbackPath(
      config({
        adapters: { anthropic: createMockLLM(), google: createMockLLM({}, 'google') },
        credentials: { anthropic: 'key-a' },
        fallbackChain: ['google'],
      }),
      'research',
    )

    expect(path.every((c) => c.provider === 'anthropic')).toBe(true)
  })

  it('never revisits the provider it started on', () => {
    const path = fallbackPath(
      config({ fallbackChain: ['anthropic'], credentials: { anthropic: 'key-a' } }),
      'research',
    )

    expect(path).toHaveLength(2)
  })
})

describe('route', () => {
  it('returns the answer and its cost without downgrading when all is well', async () => {
    const result = await route(config(), request)

    expect(result.downgrades).toEqual([])
    expect(result.model).toBe('mock-large')
    expect(result.costUsd).toBeGreaterThan(0)
    expect(result.requested).toEqual({ provider: 'anthropic', model: 'mock-large' })
  })

  it('retries the same model before giving up on it', async () => {
    const adapter = createMockLLM({ failFirst: { times: 2, error: mockFailures.overloaded } })

    const result = await route(config({ adapters: { anthropic: adapter } }), request)

    expect(adapter.calls).toHaveLength(3)
    expect(adapter.calls.every((c) => c.model === 'mock-large')).toBe(true)
    // Three attempts on one model is not a downgrade — nothing changed.
    expect(result.downgrades).toEqual([])
  })

  it('steps one tier down within the provider once retries are exhausted', async () => {
    const adapter = createMockLLM({ failFirst: { times: 3, error: mockFailures.overloaded } })

    const result = await route(config({ adapters: { anthropic: adapter } }), request)

    expect(result.model).toBe('mock-medium')
    expect(result.downgrades).toEqual([
      expect.objectContaining({
        kind: 'same-provider-tier-down',
        from: { provider: 'anthropic', model: 'mock-large' },
        to: { provider: 'anthropic', model: 'mock-medium' },
      }),
    ])
  })

  it('crosses to the fallback provider only after the tier-down also fails', async () => {
    const anthropic = createMockLLM({ failFirst: { times: 6, error: mockFailures.serverError } })
    const google = createMockLLM({}, 'google')

    const result = await route(
      config({
        adapters: { anthropic, google },
        credentials: { anthropic: 'key-a', google: 'key-g' },
        fallbackChain: ['google'],
      }),
      request,
    )

    expect(result.provider).toBe('google')
    expect(anthropic.calls).toHaveLength(6)
    expect(result.downgrades.map((d) => d.kind)).toEqual([
      'same-provider-tier-down',
      'cross-provider',
    ])
  })

  it('reports every downgrade as it happens, so run_events can record it', async () => {
    const seen: Downgrade[] = []
    const adapter = createMockLLM({ failFirst: { times: 3, error: mockFailures.overloaded } })

    await route(
      config({ adapters: { anthropic: adapter }, onDowngrade: (d) => void seen.push(d) }),
      request,
    )

    expect(seen).toHaveLength(1)
    expect(seen[0]?.reason).toMatch(/overloaded/)
    expect(seen[0]?.task).toBe('research')
  })

  it('does not downgrade on a refusal — another model would refuse too', async () => {
    const adapter = createMockLLM({ failFirst: { times: 1, error: mockFailures.refused } })

    await expect(route(config({ adapters: { anthropic: adapter } }), request)).rejects.toThrow(
      ContentPolicyError,
    )
    // One call, not three: a content refusal is not worth retrying either.
    expect(adapter.calls).toHaveLength(1)
  })

  it('honours retry-after instead of its own backoff', async () => {
    const slept: number[] = []
    const adapter = createMockLLM({ failFirst: { times: 1, error: mockFailures.rateLimited } })

    await route(
      config({
        adapters: { anthropic: adapter },
        sleepImpl: async (ms) => void slept.push(ms),
      }),
      request,
    )

    expect(slept).toEqual([1_000])
  })

  it('throws the last error when every model in the path is down', async () => {
    const adapter = createMockLLM({ failFirst: { times: 99, error: mockFailures.overloaded } })

    await expect(route(config({ adapters: { anthropic: adapter } }), request)).rejects.toThrow(
      /overloaded/,
    )
  })

  it('resolves routing at call time, so a settings change lands on the next call', async () => {
    const adapter = createMockLLM()
    const live = config({ adapters: { anthropic: adapter } })

    await route(live, request)
    live.routing = { ...routing, research: { provider: 'anthropic', model: 'mock-small' } }
    await route(live, request)

    expect(adapter.calls.map((c) => c.model)).toEqual(['mock-large', 'mock-small'])
  })
})
