import { EMPTY_BIBLE, FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { describe, expect, it } from 'vitest'
import { requireCompleteBible } from './channel'

describe('requireCompleteBible', () => {
  it('passes a complete bible', () => {
    expect(() => requireCompleteBible({ bible: FIRST_CHANNEL_BIBLE, slug: 'a' })).not.toThrow()
  })

  it('throws a non-retriable error naming the problem for an empty one', () => {
    const attempt = () => requireCompleteBible({ bible: EMPTY_BIBLE, slug: 'psychology' })
    expect(attempt).toThrow(NonRetriableError)
    expect(attempt).toThrow(/channel bible incomplete/)
  })
})
