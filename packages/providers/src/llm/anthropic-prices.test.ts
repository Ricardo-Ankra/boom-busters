import { describe, expect, it } from 'vitest'
import { resolveLlmModel } from '../catalogue/resolve'
import { ANTHROPIC_MODELS } from './anthropic'
import { topModel } from './registry'

/**
 * Every Claude model production's own `GET /v1/models` returned on
 * 2026-10-06, at Anthropic's published price that day
 * (platform.claude.com/docs/en/about-claude/pricing): input, output and cache
 * read, per million tokens. A live id the catalogue does not hold is priced
 * by its family; these are the prices the ledger must settle at either way.
 */
const PUBLISHED: readonly [id: string, input: number, output: number, cached: number][] = [
  ['claude-fable-5-1', 10, 50, 0.25],
  ['claude-fable-5', 10, 50, 1],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-opus-5', 5, 25, 0.5],
  ['claude-opus-4-8', 5, 25, 0.5],
  ['claude-opus-4-7', 5, 25, 0.5],
  ['claude-opus-4-6', 5, 25, 0.5],
  ['claude-opus-4-5-20251101', 5, 25, 0.5],
  ['claude-sonnet-5-5', 2, 10, 0.2],
  ['claude-sonnet-5', 2, 10, 0.2],
  ['claude-sonnet-4-6', 3, 15, 0.3],
  ['claude-sonnet-4-5-20250929', 3, 15, 0.3],
  ['claude-haiku-4-5-20251001', 1, 5, 0.1],
]

describe('Claude prices (decision 288 follow-up)', () => {
  it.each(PUBLISHED)('prices %s at %s in, %s out, %s cache read', (id, input, output, cached) => {
    const resolved = resolveLlmModel('anthropic', id, undefined)
    expect(resolved?.model).toMatchObject({
      inputPerMTok: input,
      outputPerMTok: output,
      cachedInputPerMTok: cached,
    })
  })

  it('keeps Opus 5 the default and Haiku the cheapest model a key check spends on', () => {
    // The router's cross-provider fallback and a provider switch both take the
    // first model of the top tier; Verify sends one token to the last model.
    expect(topModel('anthropic').id).toBe('claude-opus-5')
    expect(ANTHROPIC_MODELS.at(-1)?.id).toBe('claude-haiku-4-5-20251001')
  })
})
