import { describe, expect, it } from 'vitest'
import { mockProvidersEnabled } from './registry'

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
