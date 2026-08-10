import { describe, expect, it } from 'vitest'
import { DEFAULT_FAILURE_THRESHOLD, classifyFanOut, toFanOutItems } from './fan-out'

describe('classifyFanOut', () => {
  function items(total: number, failures: number) {
    return Array.from({ length: total }, (_, index) => ({
      key: `slot-${index}`,
      ...(index < failures
        ? { error: { name: 'TransientProviderError', message: 'nope' } }
        : { value: index }),
    }))
  }

  it('succeeds when nothing failed', () => {
    const verdict = classifyFanOut(items(20, 0))
    expect(verdict.ok).toBe(true)
    expect(verdict.summary).toBe('20/20 resolved')
  })

  it('succeeds at exactly the threshold, flagging the failures for the gate', () => {
    // 3 of 20 is 15% — the spec says "15% or fewer" succeeds.
    const verdict = classifyFanOut(items(20, 3))
    expect(verdict.ok).toBe(true)
    expect(verdict.failed).toHaveLength(3)
    expect(verdict.summary).toContain('within tolerance')
  })

  it('fails one item past the threshold', () => {
    const verdict = classifyFanOut(items(20, 4))
    expect(verdict.ok).toBe(false)
    expect(verdict.summary).toContain('over tolerance')
  })

  it('fails a small fan-out on a single failure, because one of four is 25%', () => {
    expect(classifyFanOut(items(4, 1)).ok).toBe(false)
  })

  it('treats an empty fan-out as success, not a division by zero', () => {
    const verdict = classifyFanOut([])
    expect(verdict.ok).toBe(true)
    expect(verdict.failureRatio).toBe(0)
    expect(Number.isNaN(verdict.failureRatio)).toBe(false)
  })

  it('honours a caller-supplied threshold', () => {
    expect(classifyFanOut(items(10, 4), 0.4).ok).toBe(true)
    expect(classifyFanOut(items(10, 4), 0.3).ok).toBe(false)
  })

  it('uses the threshold the spec names', () => {
    expect(DEFAULT_FAILURE_THRESHOLD).toBe(0.15)
  })
})

describe('toFanOutItems', () => {
  it('keeps input order so a failure names the right item', () => {
    const keys = ['a', 'b', 'c']
    const results: PromiseSettledResult<number>[] = [
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: new TypeError('bad brief') },
      { status: 'fulfilled', value: 3 },
    ]

    const converted = toFanOutItems(keys, results)
    expect(converted.map((item) => item.key)).toEqual(['a', 'b', 'c'])
    expect(converted[1]?.error).toEqual({ name: 'TypeError', message: 'bad brief' })
    expect(converted[0]?.value).toBe(1)
  })

  it('survives a non-Error rejection', () => {
    const converted = toFanOutItems(['a'], [{ status: 'rejected', reason: 'kaboom' }])
    expect(converted[0]?.error).toEqual({ name: 'UnknownError', message: 'kaboom' })
  })
})
