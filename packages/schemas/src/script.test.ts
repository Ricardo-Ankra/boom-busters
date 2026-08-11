import { describe, expect, it } from 'vitest'
import {
  OutlineSchema,
  SelfCheckSchema,
  countWords,
  estimateRuntimeSec,
  sentenceHash,
  splitSentences,
} from './script'

describe('splitSentences', () => {
  it('splits on sentence endings', () => {
    expect(splitSentences('One thing happened. Then another. And a third!')).toEqual([
      'One thing happened.',
      'Then another.',
      'And a third!',
    ])
  })

  it('does not split on the abbreviations this subject matter is full of', () => {
    // "Enron Corp. filed" splitting in two puts the gutter marker on half a
    // sentence and pins the claim to the wrong text.
    expect(splitSentences('Enron Corp. filed for bankruptcy. It was 2001.')).toEqual([
      'Enron Corp. filed for bankruptcy.',
      'It was 2001.',
    ])
    expect(splitSentences('Wirecard Inc. collapsed.')).toHaveLength(1)
    expect(splitSentences('The U.S. regulator acted.')).toHaveLength(1)
  })

  it('keeps a closing quote or bracket with its sentence', () => {
    expect(splitSentences('He said "it is fine." Nobody believed him.')).toEqual([
      'He said "it is fine."',
      'Nobody believed him.',
    ])
  })

  it('keeps a trailing fragment with no terminator', () => {
    expect(splitSentences('A complete one. An unfinished one')).toEqual([
      'A complete one.',
      'An unfinished one',
    ])
  })

  it('is empty for empty input', () => {
    expect(splitSentences('')).toEqual([])
    expect(splitSentences('   \n  ')).toEqual([])
  })

  it('survives a paragraph break mid-chapter', () => {
    expect(splitSentences('First para.\n\nSecond para.')).toHaveLength(2)
  })
})

describe('sentenceHash', () => {
  it('is stable for the same sentence', () => {
    expect(sentenceHash('Enron filed for bankruptcy.')).toBe(
      sentenceHash('Enron filed for bankruptcy.'),
    )
  })

  it('survives a whitespace or punctuation fix', () => {
    // A human fixing a typo must not orphan every claim ref in the chapter.
    expect(sentenceHash('Enron filed  for bankruptcy.')).toBe(
      sentenceHash('Enron filed for bankruptcy'),
    )
  })

  it('survives a smart-quote substitution', () => {
    expect(sentenceHash('He said “stop”.')).toBe(sentenceHash('He said "stop".'))
  })

  it('is case-insensitive', () => {
    expect(sentenceHash('Enron Filed.')).toBe(sentenceHash('enron filed.'))
  })

  it('changes when the words change', () => {
    // A real rewording is exactly when the claim behind it should be
    // re-checked, so the link is meant to break here.
    expect(sentenceHash('Enron filed for bankruptcy.')).not.toBe(
      sentenceHash('Enron nearly filed for bankruptcy.'),
    )
  })

  it('is short enough to index', () => {
    expect(sentenceHash('anything')).toHaveLength(32)
  })
})

describe('runtime estimates', () => {
  it('counts words', () => {
    expect(countWords('one two three')).toBe(3)
    expect(countWords('  ')).toBe(0)
  })

  it('estimates narration time at the configured rate', () => {
    expect(estimateRuntimeSec(Array(150).fill('word').join(' '))).toBe(60)
  })

  it('is zero for nothing', () => {
    expect(estimateRuntimeSec('')).toBe(0)
  })
})

describe('OutlineSchema', () => {
  const chapter = { title: 'The setup', beat: 'x'.repeat(30), targetWords: 900 }

  it('accepts a real outline', () => {
    expect(OutlineSchema.safeParse({ chapters: [chapter, chapter] }).success).toBe(true)
  })

  it('rejects a one-chapter script', () => {
    expect(OutlineSchema.safeParse({ chapters: [chapter] }).success).toBe(false)
  })

  it('rejects an absurd chapter length', () => {
    expect(
      OutlineSchema.safeParse({ chapters: [chapter, { ...chapter, targetWords: 40_000 }] }).success,
    ).toBe(false)
  })
})

describe('SelfCheckSchema', () => {
  it('accepts an empty check — a clean chapter is a valid result', () => {
    expect(SelfCheckSchema.safeParse({ warnings: [], refs: [] }).success).toBe(true)
  })

  it('rejects a warning kind the gutter cannot render', () => {
    expect(
      SelfCheckSchema.safeParse({
        warnings: [{ kind: 'vibes', sentence: 'x', message: 'hello' }],
        refs: [],
      }).success,
    ).toBe(false)
  })
})
