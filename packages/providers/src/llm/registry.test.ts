import { describe, expect, it } from 'vitest'
import { LIVE_ADAPTERS, llmAdapters, mockProvidersEnabled } from './registry'

/**
 * The mock-mode switch, and its hard guard (build spec section 13). The guard
 * used to live on a schemas helper nothing called; this is the check every
 * runner and screen actually consults, so this is where the promise "never
 * active in a production build" has to hold (audit, decision 239).
 */
describe('mockProvidersEnabled', () => {
  it('is enabled by MOCK_PROVIDERS=1 outside production', () => {
    expect(mockProvidersEnabled({ NODE_ENV: 'test', MOCK_PROVIDERS: '1' })).toBe(true)
    expect(mockProvidersEnabled({ NODE_ENV: 'development', MOCK_PROVIDERS: '1' })).toBe(true)
    expect(mockProvidersEnabled({ NODE_ENV: 'development' })).toBe(false)
  })

  it('can never be enabled in a production build, whatever the env says', () => {
    expect(mockProvidersEnabled({ NODE_ENV: 'production', MOCK_PROVIDERS: '1' })).toBe(false)
  })
})

describe('llmAdapters and the subscription bridge (decision 469)', () => {
  const bridge = {
    LLM_BRIDGE_URL: 'https://my-pc.tailnet.ts.net/',
    LLM_BRIDGE_SECRET: 'a-secret-that-is-long-enough-for-hmac-0123',
  }

  it('calls the API with the stored key, exactly as before, when no bridge is set', () => {
    expect(llmAdapters({ NODE_ENV: 'production' })).toBe(LIVE_ADAPTERS)
  })

  it('sends only Anthropic to the bridge when it is set', () => {
    const adapters = llmAdapters({ NODE_ENV: 'production', ...bridge })
    expect(adapters.anthropic).not.toBe(LIVE_ADAPTERS.anthropic)
    expect(adapters.anthropic.models).toBe(LIVE_ADAPTERS.anthropic.models)
    expect(adapters.openai).toBe(LIVE_ADAPTERS.openai)
    expect(adapters.google).toBe(LIVE_ADAPTERS.google)
  })

  it('never reaches the bridge in mock mode, so tests cannot spend a plan', () => {
    const adapters = llmAdapters({ NODE_ENV: 'test', MOCK_PROVIDERS: '1', ...bridge })
    expect(adapters.anthropic.models.every((m) => m.id.startsWith('mock-'))).toBe(true)
  })

  it('refuses half a bridge setup rather than guessing', () => {
    expect(() =>
      llmAdapters({ NODE_ENV: 'production', LLM_BRIDGE_URL: bridge.LLM_BRIDGE_URL }),
    ).toThrow(/LLM_BRIDGE_SECRET/)
  })
})
