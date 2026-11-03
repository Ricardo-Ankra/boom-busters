import { describe, expect, it } from 'vitest'
import {
  dropFixedParagraphs,
  isFixedParagraph,
  joinFixedParagraphs,
  splitFixedParagraphs,
  withFixedLines,
} from './fixed-lines'

const format = { introLine: 'Settle in.', outroLine: 'Sleep well.' }
const none = { introLine: '', outroLine: '' }

describe('withFixedLines', () => {
  it('prepends the opening line to chapter 0 and appends the closing line to the last', () => {
    expect(withFixedLines(['A\n\nB', 'C'], format)).toEqual([
      'Settle in.\n\nA\n\nB',
      'C\n\nSleep well.',
    ])
  })

  it('is idempotent', () => {
    const once = withFixedLines(['A\n\nB', 'C'], format)
    expect(withFixedLines(once, format)).toEqual(once)
  })

  it('changes nothing for empty lines', () => {
    expect(withFixedLines(['A', 'B'], none)).toEqual(['A', 'B'])
  })

  it('places both lines in a single chapter', () => {
    expect(withFixedLines(['A'], format)).toEqual(['Settle in.\n\nA\n\nSleep well.'])
  })

  it('handles no chapters', () => {
    expect(withFixedLines([], format)).toEqual([])
  })
})

describe('isFixedParagraph and dropFixedParagraphs', () => {
  it('matches exactly after trimming', () => {
    expect(isFixedParagraph('  Settle in.\n', format)).toBe(true)
    expect(isFixedParagraph('Settle in. Now.', format)).toBe(false)
    expect(isFixedParagraph('', none)).toBe(false)
  })

  it('drops only the fixed paragraphs', () => {
    expect(dropFixedParagraphs('Settle in.\n\nA\n\nB\n\nSleep well.', format)).toBe('A\n\nB')
  })

  it('returns the text untouched when no line is set', () => {
    expect(dropFixedParagraphs('A\n\n\n\nB', none)).toBe('A\n\n\n\nB')
  })
})

describe('splitFixedParagraphs and joinFixedParagraphs', () => {
  it('separates the fixed run at each end and joins back', () => {
    const text = 'Settle in.\n\nA\n\nB\n\nSleep well.'
    const parts = splitFixedParagraphs(text, format)
    expect(parts).toEqual({ head: ['Settle in.'], body: 'A\n\nB', tail: ['Sleep well.'] })
    expect(joinFixedParagraphs(parts)).toBe(text)
  })

  it('leaves a chapter with no fixed paragraph whole', () => {
    expect(splitFixedParagraphs('A\n\nB', format)).toEqual({ head: [], body: 'A\n\nB', tail: [] })
  })

  it('keeps an edited body between the fixed lines', () => {
    const parts = splitFixedParagraphs('Settle in.\n\nA', format)
    expect(joinFixedParagraphs({ ...parts, body: 'A, edited' })).toBe('Settle in.\n\nA, edited')
  })
})
