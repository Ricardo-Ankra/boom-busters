import { mockProvidersEnabled } from '../llm/registry'
import { createVidiqClient } from './client'
import type { VidiqClient } from './client'
import { mockVidiqClient } from './mock'

export * from './client'
export * from './costs'
export * from './mock'
export * from './plan'
export * from './shapes'

/** The mock under `MOCK_PROVIDERS`, nothing without a key, else the live client. */
export function vidiqClientFor(apiKey: string | undefined): VidiqClient | null {
  if (mockProvidersEnabled()) return mockVidiqClient()
  if (!apiKey) return null
  return createVidiqClient(apiKey)
}
