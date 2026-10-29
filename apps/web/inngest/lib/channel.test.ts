import {
  EMPTY_BIBLE,
  EXAMPLE_SLOT_IDS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_IN_USE,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { describe, expect, it } from 'vitest'
import { requireCompleteBible } from './channel'

describe('requireCompleteBible', () => {
  it('passes a complete bible', () => {
    expect(() => requireCompleteBible({ ...FIRST_CHANNEL_IN_USE, slug: 'a' })).not.toThrow()
  })

  it('throws a non-retriable error naming the problem for an empty one', () => {
    const attempt = () =>
      requireCompleteBible({ bible: EMPTY_BIBLE, slotIds: EXAMPLE_SLOT_IDS, slug: 'psychology' })
    expect(attempt).toThrow(NonRetriableError)
    expect(attempt).toThrow(/channel bible incomplete/)
  })

  it('judges a bible by the slots it was saved with, not the registry as it stands', () => {
    // A slot added after the version was saved does not fail it ...
    expect(() =>
      requireCompleteBible({ bible: FIRST_CHANNEL_BIBLE, slotIds: [], slug: 'a' }),
    ).not.toThrow()
    // ... and a slot the version lists but leaves empty does.
    expect(() =>
      requireCompleteBible({
        bible: FIRST_CHANNEL_BIBLE,
        slotIds: ['script-not-filled'],
        slug: 'a',
      }),
    ).toThrow(/channel bible incomplete/)
  })
})
