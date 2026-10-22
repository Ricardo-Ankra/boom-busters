import { describe, expect, it } from 'vitest'
import { estimateTokens, truncateAtParagraph } from './tokens'

describe('tokens', () => {
  it('estimates four characters to a token, rounding up', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('cuts at the last blank line inside the budget, then a line break, then hard', () => {
    expect(truncateAtParagraph('aaaa aaaa\n\nbbbb bbbb\n\ncccc cccc', 4)).toEqual({
      text: 'aaaa aaaa',
      truncated: true,
    })
    expect(truncateAtParagraph('aaaa aaaa\nbbbb bbbb', 3)).toEqual({
      text: 'aaaa aaaa',
      truncated: true,
    })
    expect(truncateAtParagraph('abcdefghijklmnop', 2)).toEqual({
      text: 'abcdefgh',
      truncated: true,
    })
    expect(truncateAtParagraph('short', 100)).toEqual({ text: 'short', truncated: false })
  })
})
