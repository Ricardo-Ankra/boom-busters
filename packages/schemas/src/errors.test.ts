import { describe, expect, it } from 'vitest'
import {
  BudgetExceededError,
  ContentPolicyError,
  PipelineError,
  RateLimitError,
  TransientProviderError,
  ValidationError,
  isGated,
  isRetriable,
  retryAfterMs,
  serialiseError,
  spentUsd,
} from './errors'

describe('retry classification', () => {
  it('retries transient provider failures', () => {
    expect(
      isRetriable(new TransientProviderError('anthropic', 'overloaded', { status: 529 })),
    ).toBe(true)
    expect(isRetriable(new RateLimitError('openai', 'slow down', { retryAfterMs: 4000 }))).toBe(
      true,
    )
  })

  it('does not retry what retrying cannot fix', () => {
    expect(isRetriable(new ValidationError('chart brief has no claim refs'))).toBe(false)
    expect(isRetriable(new ContentPolicyError('google', 'refused'))).toBe(false)
    expect(
      isRetriable(
        new BudgetExceededError({
          provider: 'anthropic',
          operation: 'scripting',
          budgetUsd: 30,
          monthSpendUsd: 29.9,
          estimateUsd: 0.5,
        }),
      ),
    ).toBe(false)
  })

  it('retries unknown errors — a socket hangup deserves another attempt', () => {
    expect(isRetriable(new Error('ECONNRESET'))).toBe(true)
    expect(isRetriable('something threw a string')).toBe(true)
    expect(isRetriable(undefined)).toBe(true)
  })

  it('treats only the budget error as gated, not failed', () => {
    const budget = new BudgetExceededError({
      provider: 'elevenlabs',
      operation: 'tts',
      budgetUsd: 10,
      monthSpendUsd: 10,
      estimateUsd: 0.2,
    })
    expect(isGated(budget)).toBe(true)
    expect(isGated(new ValidationError('nope'))).toBe(false)
    expect(isGated(new Error('nope'))).toBe(false)
  })

  it('surfaces the provider retry-after instead of guessing a backoff', () => {
    expect(retryAfterMs(new RateLimitError('openai', 'slow down', { retryAfterMs: 12_000 }))).toBe(
      12_000,
    )
    expect(retryAfterMs(new RateLimitError('openai', 'slow down'))).toBeUndefined()
    expect(retryAfterMs(new TransientProviderError('openai', '503'))).toBeUndefined()
  })
})

describe('spend carried on a failure', () => {
  it('reports money that left the account before the error', () => {
    const error = new TransientProviderError('elevenlabs', 'stream aborted', { spentUsd: 0.031 })
    expect(spentUsd(error)).toBeCloseTo(0.031)
  })

  it('is undefined when the call failed before spending', () => {
    expect(spentUsd(new TransientProviderError('elevenlabs', 'connect timeout'))).toBeUndefined()
    expect(spentUsd(new Error('boom'))).toBeUndefined()
  })
})

describe('error identity', () => {
  it('names itself after its own class, so run rows read correctly', () => {
    expect(new ValidationError('x').name).toBe('ValidationError')
    expect(new RateLimitError('openai', 'x').name).toBe('RateLimitError')
  })

  it('keeps the cause chain', () => {
    const root = new Error('socket hangup')
    const wrapped = new TransientProviderError('anthropic', 'upstream failed', { cause: root })
    expect(wrapped.cause).toBe(root)
  })

  it('makes a rate limit a kind of transient failure', () => {
    const error = new RateLimitError('openai', 'x')
    expect(error).toBeInstanceOf(TransientProviderError)
    expect(error).toBeInstanceOf(PipelineError)
  })
})

describe('budget error message', () => {
  it('states the arithmetic the human has to judge', () => {
    const error = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'scripting',
      budgetUsd: 30,
      monthSpendUsd: 29.8,
      estimateUsd: 0.45,
    })
    expect(error.message).toContain('$29.80 spent')
    expect(error.message).toContain('$0.4500 estimated')
    expect(error.message).toContain('$30.00 ceiling')
  })

  it('names the ceiling, not a provider cap — the ceiling is global', () => {
    const error = new BudgetExceededError({
      provider: 'anthropic',
      operation: 'research',
      budgetUsd: 30,
      monthSpendUsd: 29.5,
      estimateUsd: 1.2,
    })
    expect(error.message).toContain('ceiling')
    expect(error.provider).toBe('anthropic')
  })
})

describe('serialiseError', () => {
  it('keeps the budget numbers so the Needs-you card can render them', () => {
    const serialised = serialiseError(
      new BudgetExceededError({
        provider: 'google',
        operation: 'tts',
        budgetUsd: 15,
        monthSpendUsd: 14.9,
        estimateUsd: 0.3,
      }),
    )
    expect(serialised).toMatchObject({
      name: 'BudgetExceededError',
      gated: true,
      provider: 'google',
      budgetUsd: 15,
      estimateUsd: 0.3,
    })
  })

  it('never includes a stack — the activity drawer is not a debugger', () => {
    const serialised = serialiseError(new TransientProviderError('openai', 'boom'))
    expect(serialised['stack']).toBeUndefined()
    expect(serialised).toMatchObject({ name: 'TransientProviderError', retriable: true })
  })

  it('handles non-Error throws', () => {
    expect(serialiseError('kaboom')).toMatchObject({
      name: 'UnknownError',
      message: 'kaboom',
      retriable: true,
    })
  })

  it('is JSON-safe, because it lands in a jsonb column', () => {
    const round = JSON.parse(
      JSON.stringify(serialiseError(new ValidationError('bad', { field: 'x' }))),
    )
    expect(round).toMatchObject({ name: 'ValidationError', message: 'bad' })
  })
})
