import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mirror, stageOfFunction } from './run-mirror'

/**
 * The mirror's one contract: observe, never obstruct. A write that fails is
 * logged and swallowed; a write that HANGS — a dead pooled socket on a reused
 * serverless instance, where postgres.js has no query timeout — must be
 * abandoned, not awaited. A hung `onStepStart` write once held a production
 * execution request open for 18+ minutes (2026-09-04).
 */
describe('mirror', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('resolves when the write resolves, without logging', async () => {
    await mirror('test', () => Promise.resolve())
    expect(console.error).not.toHaveBeenCalled()
  })

  it('swallows a rejecting write and logs it', async () => {
    await mirror('test', () => Promise.reject(new Error('boom')))
    expect(console.error).toHaveBeenCalledWith('[run-mirror] test failed', expect.any(Error))
  })

  it('abandons a write that never settles instead of hanging the request', async () => {
    const pending = mirror('test', () => new Promise<void>(() => {}))
    await vi.advanceTimersByTimeAsync(5_001)
    await pending
    expect(console.error).toHaveBeenCalledWith(
      '[run-mirror] test failed',
      expect.objectContaining({ message: expect.stringContaining('hung') }),
    )
  })

  it('does not fire the abandon timer after a fast write', async () => {
    await mirror('test', () => Promise.resolve())
    await vi.advanceTimersByTimeAsync(10_000)
    expect(console.error).not.toHaveBeenCalled()
  })
})

describe('stageOfFunction', () => {
  it('maps runner ids to their stage', () => {
    expect(stageOfFunction('visuals-runner')).toBe('visuals')
    expect(stageOfFunction('voice-runner')).toBe('voice')
  })

  it('returns null for non-runner functions', () => {
    expect(stageOfFunction('cancel-reconciler')).toBeNull()
    expect(stageOfFunction('voice-retaker')).toBeNull()
  })
})
