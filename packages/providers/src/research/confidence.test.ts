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

  it('counts a Wayback capture as the site it captured', () => {
    expect(
      computeConfidence([
        { url: 'https://www.wirecard.com/press/1', quote: 'q one', found: true },
        {
          url: 'https://web.archive.org/web/20190101000000/https://wirecard.com/press/2',
          quote: 'q two',
          found: true,
        },
      ]),
    ).toBe('single_source')
    expect(
      computeConfidence([
        { url: 'https://ft.com/a', quote: 'q one', found: true },
        { url: 'https://web.archive.org/web/2019id_/wirecard.com/b', quote: 'q two', found: true },
      ]),
    ).toBe('sourced')
  })
})
