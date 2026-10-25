import { describe, expect, it } from 'vitest'
import { britishCardinal, spokenNumbers } from './spoken-numbers'

describe('britishCardinal', () => {
  it.each([
    [0, 'zero'],
    [7, 'seven'],
    [42, 'forty-two'],
    [100, 'one hundred'],
    [101, 'one hundred and one'],
    [660, 'six hundred and sixty'],
    [999, 'nine hundred and ninety-nine'],
    [1000, 'one thousand'],
    [1005, 'one thousand and five'],
    [1050, 'one thousand and fifty'],
    [1250, 'one thousand two hundred and fifty'],
    [2008, 'two thousand and eight'],
    [10_000, 'ten thousand'],
    [660_000, 'six hundred and sixty thousand'],
    [1_000_005, 'one million and five'],
    [1_200_000, 'one million two hundred thousand'],
    [3_000_000_000, 'three billion'],
  ])('%i reads as "%s"', (value, words) => {
    expect(britishCardinal(value)).toBe(words)
  })
})

describe('spokenNumbers', () => {
  const spoken = (text: string) => spokenNumbers(text).text

  it('reads 660 the British way', () => {
    expect(spoken('They lost 660 jobs.')).toBe('They lost six hundred and sixty jobs.')
  })

  it('reads grouped thousands and the scale word after them', () => {
    expect(spoken('1,250 investors')).toBe('one thousand two hundred and fifty investors')
    expect(spoken('660 million euros')).toBe('six hundred and sixty million euros')
  })

  /**
   * Only the numbers whose British reading differs are touched. ElevenLabs
   * already reads these the same either way, and leaving them alone keeps
   * the vendor's own handling of dates and decimals.
   */
  it.each(['500 staff', '1.9 billion euros', 'the S&P 500', '3,000 people', '2,000,000'])(
    'leaves "%s" to the narrator',
    (text) => {
      expect(spokenNumbers(text)).toEqual({ text, replacements: [] })
    },
  )

  it('leaves years to the narrator, except the two-thousand-and years', () => {
    expect(spoken('In 1987 and again in 2015')).toBe('In 1987 and again in 2015')
    expect(spoken('the crash of 2008')).toBe('the crash of two thousand and eight')
  })

  it('moves the currency word after the amount and its scale', () => {
    expect(spoken('a $660 fine')).toBe('a six hundred and sixty dollars fine')
    expect(spoken('£1,050 a share')).toBe('one thousand and fifty pounds a share')
    expect(spoken('$660 million')).toBe('six hundred and sixty million dollars')
    expect(spoken('€101.5 billion')).toBe('one hundred and one point five billion euros')
  })

  it('reads percentages and decimals', () => {
    expect(spoken('up 660%')).toBe('up six hundred and sixty percent')
    expect(spoken('660.25 points')).toBe('six hundred and sixty point two five points')
  })

  it.each(['660th', '737s', '9/11 and 24/7', '1-800-660', '10:45', '0660', 'A660', '$660.50'])(
    'does not guess at "%s"',
    (text) => {
      expect(spoken(text)).toBe(text)
    },
  )

  it('keeps punctuation that follows a number', () => {
    expect(spoken('660, then 1,050.')).toBe('six hundred and sixty, then one thousand and fifty.')
  })

  it('leaves stage directions alone', () => {
    expect(spoken('[pause] 660 [emphasis on "660"]')).toBe(
      '[pause] six hundred and sixty [emphasis on "660"]',
    )
  })

  it('records each replacement against the rewritten text', () => {
    const result = spokenNumbers('Fined $660 million, 115 times.')

    expect(result.replacements).toEqual([
      { original: '$660 million', start: 6, end: 43 },
      { original: '115', start: 45, end: 68 },
    ])
    for (const replacement of result.replacements) {
      expect(result.text.slice(replacement.start, replacement.end)).toMatch(/hundred and/)
    }
  })
})
