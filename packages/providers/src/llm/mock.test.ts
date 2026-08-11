import { describe, expect, it } from 'vitest'
import { createMockLLM } from './mock'
import { nextTierDown, priceOf } from './types'
import type { LLMTaskRequest } from './types'

const request: LLMTaskRequest = {
  task: 'scripting',
  system: 'Write plainly.',
  messages: [{ role: 'user', content: 'Chapter 1' }],
  maxTokens: 500,
}

const call = { apiKey: 'k', model: 'mock-large' }

describe('the mock adapter', () => {
  it('is deterministic — the same request always produces the same text', async () => {
    const a = await createMockLLM().complete(request, call)
    const b = await createMockLLM().complete(request, call)

    expect(a.text).toBe(b.text)
  })

  it('produces different text for a different request', async () => {
    const adapter = createMockLLM()
    const a = await adapter.complete(request, call)
    const b = await adapter.complete(
      { ...request, messages: [{ role: 'user', content: 'Chapter 2' }] },
      call,
    )

    expect(a.text).not.toBe(b.text)
  })

  it('says it is mock output, so nobody mistakes it for a real dossier', async () => {
    const { text } = await createMockLLM().complete(request, call)

    expect(text).toMatch(/^\[mock mock-large\]/)
    expect(text).toMatch(/Nothing was sent to a provider/)
  })

  it('reports usage that tracks the size of the prompt', async () => {
    const adapter = createMockLLM()
    const small = await adapter.complete(request, call)
    const large = await adapter.complete(
      { ...request, messages: [{ role: 'user', content: 'x'.repeat(4_000) }] },
      call,
    )

    expect(large.usage.inputTokens).toBeGreaterThan(small.usage.inputTokens)
  })

  it('counts a cacheable prefix separately, so cache pricing is exercised', async () => {
    const result = await createMockLLM().complete(
      {
        ...request,
        messages: [
          { role: 'user', content: 'style bible '.repeat(50) },
          { role: 'user', content: 'Chapter 1' },
        ],
        cacheablePrefixMessages: 1,
      },
      call,
    )

    expect(result.usage.cachedInputTokens).toBeGreaterThan(0)
  })

  it('records every call, so memoisation can be asserted', async () => {
    const adapter = createMockLLM()
    await adapter.complete(request, call)
    await adapter.complete(request, call)

    expect(adapter.calls).toHaveLength(2)
  })

  it('flags truncation when the answer runs past maxTokens', async () => {
    const adapter = createMockLLM({ respond: () => 'x'.repeat(10_000) })
    const result = await adapter.complete({ ...request, maxTokens: 10 }, call)

    expect(result.truncated).toBe(true)
  })
})

describe('model helpers', () => {
  const adapter = createMockLLM()

  it('walks down one tier at a time', () => {
    expect(nextTierDown(adapter, 'mock-large')?.id).toBe('mock-medium')
    expect(nextTierDown(adapter, 'mock-medium')?.id).toBe('mock-small')
  })

  it('has nowhere to go from the bottom model', () => {
    expect(nextTierDown(adapter, 'mock-small')).toBeUndefined()
  })

  it('prices a call from the answering model, not the requested one', () => {
    const large = adapter.models[0]!
    const small = adapter.models[2]!
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 }

    expect(priceOf(large, usage)).toBe(90)
    expect(priceOf(small, usage)).toBe(6)
  })

  it('charges cached input at the cache rate when the model has one', () => {
    const cached = { ...adapter.models[0]!, cachedInputPerMTok: 1.5 }

    const full = priceOf(cached, { inputTokens: 1_000_000, outputTokens: 0 })
    const warm = priceOf(cached, {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    })

    expect(full).toBe(15)
    expect(warm).toBe(1.5)
  })

  it('rounds to the ledger column scale', () => {
    const model = { ...adapter.models[0]!, inputPerMTok: 1 / 3 }
    expect(priceOf(model, { inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.3333)
  })
})
