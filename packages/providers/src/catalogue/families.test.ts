import { describe, expect, it } from 'vitest'
import { LLM_MODELS } from '../llm/registry'
import { GEMINI_IMAGE_MODELS } from '../visuals/gemini'
import { FAMILY_REPRESENTATIVES, geminiImageFamily, llmFamily } from './families'

describe('llmFamily (decision 287)', () => {
  it.each([
    ['anthropic', 'claude-opus-5-5', 'opus'],
    ['anthropic', 'claude-sonnet-5-5', 'sonnet'],
    ['anthropic', 'claude-haiku-5', 'haiku'],
    ['openai', 'gpt-5.5', 'gpt-5'],
    ['openai', 'gpt-5.5-mini', 'gpt-5-mini'],
    ['google', 'gemini-9-flash-lite', 'flash-lite'],
    ['google', 'gemini-9-flash', 'flash'],
    ['google', 'gemini-9-pro', 'pro'],
    ['anthropic', 'claude-opus-4-5', 'opus'],
    ['anthropic', 'claude-opus-4-5-20251101', 'opus'],
    ['anthropic', 'claude-opus-5-5', 'opus'],
    ['anthropic', 'claude-sonnet-4-5', 'sonnet'],
    ['anthropic', 'claude-haiku-4-5', 'haiku'],
  ] as const)('%s %s is %s', (provider, id, family) => {
    expect(llmFamily(provider, id)?.family).toBe(family)
  })

  it.each([
    ['anthropic', 'claude-fable-5-1'],
    ['anthropic', 'claude-3-5-sonnet-20241022'],
    ['openai', 'gpt-5-nano'],
    ['openai', 'o4-mini'],
    ['google', 'nonsense'],
    // Opus 4 and 4.1 cost $15/$75 against Opus 5's $5/$25; Sonnet and Haiku
    // below 4.5 are held to the same line rather than guessed.
    ['anthropic', 'claude-opus-4-1-20250805'],
    ['anthropic', 'claude-opus-4-1'],
    ['anthropic', 'claude-opus-4-20250514'],
    ['anthropic', 'claude-opus-4'],
    ['anthropic', 'claude-sonnet-4-20250514'],
    ['anthropic', 'claude-sonnet-4-1'],
    ['anthropic', 'claude-haiku-4-20250514'],
    // $15/$120 against gpt-5's price.
    ['openai', 'gpt-5-pro'],
    ['openai', 'gpt-5-pro-2025-10-06'],
  ] as const)('%s %s has no family, so it must be priced by hand', (provider, id) => {
    expect(llmFamily(provider, id)).toBeUndefined()
  })
})

describe('geminiImageFamily', () => {
  it('matches pro before flash, and leaves flash-lite images unpriced', () => {
    expect(geminiImageFamily('gemini-9-pro-image')?.family).toBe('pro-image')
    expect(geminiImageFamily('gemini-9-flash-image')?.family).toBe('flash-image')
    // Served but deliberately unpriced since decision 211; no family guess.
    expect(geminiImageFamily('gemini-3.1-flash-lite-image')).toBeUndefined()
  })

  it('takes the 3.1 Flash flags, not the first flash model in the list', () => {
    expect(geminiImageFamily('gemini-9-flash-image')?.representative).toBe('gemini-3.1-flash-image')
  })
})

describe('every representative is a catalogued model', () => {
  it('names only ids the hand-written catalogues hold', () => {
    for (const [provider, ids] of Object.entries(FAMILY_REPRESENTATIVES.llm)) {
      const catalogue = LLM_MODELS[provider as keyof typeof LLM_MODELS].map((m) => m.id)
      for (const id of ids) expect(catalogue).toContain(id)
    }
    const images = GEMINI_IMAGE_MODELS.map((m) => m.id)
    for (const id of FAMILY_REPRESENTATIVES.geminiImage) expect(images).toContain(id)
  })
})
