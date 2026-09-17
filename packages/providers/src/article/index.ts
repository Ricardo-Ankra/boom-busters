import { mockProvidersEnabled } from '../llm/registry'
import { liveArticleProvider } from './fetch'
import { mockArticleProvider } from './mock'
import type { ArticleProvider } from './fetch'

export * from './extract'
export * from './fetch'
export * from './safe-url'

/**
 * The article reader, behind the same switch as every other adapter: one flag
 * swaps the live fetch for a deterministic mock, and the flag is never
 * defaulted on.
 */
export function articleProvider(
  env: Record<string, string | undefined> = process.env,
): ArticleProvider {
  return mockProvidersEnabled(env) ? mockArticleProvider : liveArticleProvider
}
