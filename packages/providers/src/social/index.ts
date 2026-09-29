import { mockProvidersEnabled } from '../llm/registry'
import { liveSocialProvider } from './fetch'
import { mockSocialProvider } from './mock'
import type { SocialProvider } from './fetch'

export * from './parse'
export * from './fetch'

/**
 * The X reader, behind the same switch as every other adapter: one flag
 * swaps the live oEmbed fetch for a deterministic mock, and the flag is
 * never defaulted on.
 */
export function socialProvider(
  env: Record<string, string | undefined> = process.env,
): SocialProvider {
  return mockProvidersEnabled(env) ? mockSocialProvider : liveSocialProvider
}
