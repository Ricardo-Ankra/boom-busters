import { RateLimitError, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it, vi } from 'vitest'
import { withRateLimitPatience } from './retry'

function limited(retryAfterMs?: number): RateLimitError {
  return new RateLimitError('gemini', 'RESOURCE_EXHAUSTED', {
    status: 429,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  })
}

/** A sleep that records what was asked and returns immediately. */
function fakeSleep(): { waits: number[]; sleep: (ms: number) => Promise<void> } {
  const waits: number[] = []
  return {
    waits,
    sleep: (ms) => {
      waits.push(ms)
      return Promise.resolve()
    },
  }
}

describe('withRateLimitPatience', () => {
  it('returns the first success untouched, without sleeping', async () => {
    const { waits, sleep } = fakeSleep()
    await expect(withRateLimitPatience(async () => 'audio', { sleep })).resolves.toBe('audio')
    expect(waits).toEqual([])
  })

  it('waits out a rate limit and then succeeds', async () => {
    const { waits, sleep } = fakeSleep()
    const fn = vi.fn().mockRejectedValueOnce(limited()).mockResolvedValueOnce('audio')

    await expect(withRateLimitPatience(fn, { sleep })).resolves.toBe('audio')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(waits).toHaveLength(1)
  })

  it('honours the retry-after the vendor sent rather than guessing', async () => {
    const { waits, sleep } = fakeSleep()
    const fn = vi.fn().mockRejectedValueOnce(limited(12_000)).mockResolvedValueOnce('audio')

    await withRateLimitPatience(fn, { sleep })
    expect(waits).toEqual([12_000])
  })

  it('backs off on its own schedule when the vendor is silent', async () => {
    const { waits, sleep } = fakeSleep()
    const fn = vi
      .fn()
      .mockRejectedValueOnce(limited())
      .mockRejectedValueOnce(limited())
      .mockResolvedValueOnce('audio')

    await withRateLimitPatience(fn, { sleep, backoffMs: [5_000, 15_000, 30_000] })
    expect(waits).toEqual([5_000, 15_000])
  })

  it('gives up after the last attempt, surfacing the rate limit itself', async () => {
    const { sleep } = fakeSleep()
    const fn = vi.fn().mockRejectedValue(limited())

    await expect(withRateLimitPatience(fn, { sleep, attempts: 3 })).rejects.toBeInstanceOf(
      RateLimitError,
    )
    // Three tries, not three retries: the first attempt counts.
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('refuses to wait absurdly — an hour-long retry-after is a failure, not a nap', async () => {
    const { waits, sleep } = fakeSleep()
    const fn = vi.fn().mockRejectedValue(limited(3_600_000))

    await expect(withRateLimitPatience(fn, { sleep })).rejects.toBeInstanceOf(RateLimitError)
    expect(waits).toEqual([])
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries only rate limits — a refused key does not fix itself by waiting', async () => {
    const { waits, sleep } = fakeSleep()
    const fn = vi.fn().mockRejectedValue(new ValidationError('key rejected'))

    await expect(withRateLimitPatience(fn, { sleep })).rejects.toBeInstanceOf(ValidationError)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(waits).toEqual([])
  })
})
