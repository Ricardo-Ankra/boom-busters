import { KNOWN_MODELS, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  LLM_PRICES,
  TTS_PRICES,
  estimateChapterTokens,
  estimateLlmUsd,
  estimateTtsUsd,
  llmPrice,
  unpricedKnownModels,
} from './prices'

describe('price table completeness', () => {
  it('prices every model Settings offers', () => {
    // A model in the dropdown with no price would estimate $0 and sail
    // through every cap. This test is the reason that cannot happen.
    expect(unpricedKnownModels()).toEqual([])
  })

  it('covers every LLM provider Settings can route at', () => {
    for (const provider of Object.keys(KNOWN_MODELS)) {
      expect(Object.keys(LLM_PRICES[provider as keyof typeof LLM_PRICES]).length).toBeGreaterThan(0)
    }
  })

  it('charges more for output than input on every model', () => {
    for (const models of Object.values(LLM_PRICES)) {
      for (const [model, price] of Object.entries(models)) {
        expect(price.outputPerMTok, model).toBeGreaterThan(price.inputPerMTok)
      }
    }
  })
})

describe('llmPrice', () => {
  it('refuses an unpriced model loudly instead of costing nothing', () => {
    expect(() => llmPrice('anthropic', 'opus-9')).toThrow(ValidationError)
    expect(() => llmPrice('anthropic', 'opus-9')).toThrow(/would estimate \$0/)
  })
})

describe('estimateLlmUsd', () => {
  it('bills input and output at their own rates', () => {
    // 1M in at $3 + 1M out at $15.
    expect(
      estimateLlmUsd({
        provider: 'anthropic',
        model: 'sonnet',
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBeCloseTo(18)
  })

  it('scales linearly and stays honest at small sizes', () => {
    const cost = estimateLlmUsd({
      provider: 'anthropic',
      model: 'haiku',
      inputTokens: 3_000,
      outputTokens: 1_000,
    })
    expect(cost).toBeCloseTo(3_000 / 1e6 + (1_000 / 1e6) * 5, 8)
    expect(cost).toBeGreaterThan(0)
  })

  it('is free only when nothing is sent', () => {
    expect(
      estimateLlmUsd({ provider: 'openai', model: 'gpt-5', inputTokens: 0, outputTokens: 0 }),
    ).toBe(0)
  })
})

describe('estimateTtsUsd', () => {
  it('prices per thousand characters', () => {
    expect(estimateTtsUsd({ provider: 'elevenlabs', characters: 1000 })).toBeCloseTo(
      TTS_PRICES.elevenlabs,
    )
    expect(estimateTtsUsd({ provider: 'gemini', characters: 500 })).toBeCloseTo(
      TTS_PRICES.gemini / 2,
    )
  })

  it('makes the provider choice visible in the number', () => {
    const chapter = 12_000
    expect(estimateTtsUsd({ provider: 'elevenlabs', characters: chapter })).toBeGreaterThan(
      estimateTtsUsd({ provider: 'gemini', characters: chapter }),
    )
  })
})

describe('estimateChapterTokens', () => {
  it('errs high — an estimate that is too low is the one that blows a cap', () => {
    expect(estimateChapterTokens(2_000)).toBeGreaterThan(2_000)
  })

  it('returns whole tokens', () => {
    expect(Number.isInteger(estimateChapterTokens(2_333))).toBe(true)
  })
})
