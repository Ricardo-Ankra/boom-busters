import { describe, expect, it } from 'vitest'
import { computeConfidence } from './confidence'

describe('computeConfidence', () => {
  it('computes confidence from found supports on distinct hosts', () => {
    expect(
      computeConfidence([
        { url: 'https://ft.com/a', quote: 'q one', found: true },
        { url: 'https://reuters.com/b', quote: 'q two', found: true },
      ]),
    ).toBe('sourced')
    expect(
      computeConfidence([
        { url: 'https://ft.com/a', quote: 'q', found: true },
        { url: 'https://www.ft.com/b', quote: 'r', found: true },
      ]),
    ).toBe('single_source')
    expect(
      computeConfidence([
        { url: 'https://ft.com/a', quote: 'same words', found: true },
        { url: 'https://reuters.com/b', quote: 'Same words.', found: true },
      ]),
    ).toBe('single_source')
    expect(computeConfidence([{ url: 'https://ft.com/a', quote: 'q', found: false }])).toBe(
      'unverified',
    )
  })
})
