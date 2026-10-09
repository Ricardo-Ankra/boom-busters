import { describe, expect, it } from 'vitest'
import { trimText } from './repair'

describe('trimText (decision 292)', () => {
  it('leaves a text inside the limit as it is', () => {
    expect(trimText('Short. Text.', 20)).toBe('Short. Text.')
  })

  it('cuts at the last full sentence inside the limit', () => {
    const text = 'First sentence here. Second one is here. Third runs past the limit by far.'
    expect(trimText(text, 45)).toBe('First sentence here. Second one is here.')
  })

  it('cuts at the last word when the only sentence end is early, like an abbreviation', () => {
    expect(trimText('Dr. Mostaque walked through the glass doors of the office', 30)).toBe(
      'Dr. Mostaque walked through',
    )
  })

  it('does not take a decimal point for the end of a sentence', () => {
    expect(trimText('The round valued it at $1.5 billion and more besides', 26)).toBe(
      'The round valued it at',
    )
  })

  it('cuts hard when the text has no space at all', () => {
    expect(trimText('x'.repeat(10), 4)).toBe('xxxx')
  })
})
