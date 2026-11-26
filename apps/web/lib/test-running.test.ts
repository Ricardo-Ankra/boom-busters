import { describe, expect, it } from 'vitest'
import { testRunningReason } from './test-running'

describe('testRunningReason', () => {
  it('a running test has a reason, an ended or unstarted one has none', () => {
    const started = new Date('2026-11-20T10:00:00Z')
    const ended = new Date('2026-11-24T10:00:00Z')
    expect(testRunningReason({ testStartedAt: started, testEndedAt: null })).toBe(
      'A Test & Compare is running on this video. YouTube stops the test if its title or thumbnail changes; record how it ended first.',
    )
    expect(testRunningReason({ testStartedAt: started, testEndedAt: ended })).toBeNull()
    expect(testRunningReason({ testStartedAt: null, testEndedAt: null })).toBeNull()
  })
})
