import { describe, expect, it } from 'vitest'
import {
  MAX_CHAPTER_WORDS,
  MIN_CHAPTER_WORDS,
  OutlineSchema,
  SelfCheckSchema,
  countWords,
  estimateRuntimeSec,
  sentenceHash,
  hasPauseMarkup,
  replaceParagraph,
  stripNarrationMarkup,
  splitParagraphs,
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

  /**
   * `targetWords` is a hint that sizes a prompt and a token budget, not a
   * contract — so it is clamped into range rather than used to reject the
   * batch. Production has three consecutive outline retries, each a full Opus
   * call, all thrown away over `chapters.N.targetWords: Too small`.
   */
  it('clamps an absurd chapter length instead of rejecting the outline', () => {
    const parsed = OutlineSchema.safeParse({
      chapters: [chapter, { ...chapter, targetWords: 40_000 }],
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.chapters[1]?.targetWords).toBe(MAX_CHAPTER_WORDS)
  })

  it('accepts the short closing chapter that used to bin the whole outline', () => {
    // The shape from production: Opus planning a brief closing chapter under
    // the old `min(200)` floor. Three consecutive outline calls were thrown
    // away over it. 150 words is a reasonable plan and is now taken as written.
    const parsed = OutlineSchema.safeParse({
      chapters: [chapter, { ...chapter, targetWords: 150 }],
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.chapters[1]?.targetWords).toBe(150)
  })

  it('clamps a chapter too short to be a chapter, rather than rejecting', () => {
    const parsed = OutlineSchema.safeParse({
      chapters: [chapter, { ...chapter, targetWords: 5 }],
    })

    expect(parsed.success).toBe(true)
    expect(parsed.data?.chapters[1]?.targetWords).toBe(MIN_CHAPTER_WORDS)
  })

  it('leaves a sensible length exactly as planned', () => {
    const parsed = OutlineSchema.safeParse({ chapters: [chapter, chapter] })
    expect(parsed.data?.chapters[0]?.targetWords).toBe(900)
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

describe('splitParagraphs and replaceParagraph', () => {
  // A chapter with the two things that break naive rejoining: a soft wrap
  // inside a paragraph, and an irregular blank-line separator.
  const chapter =
    'The auditors signed it off\nfor eighteen years.\n\n  Nobody asked where the cash was.\n\nThen June came.'

  it('folds soft wraps into the paragraph, so narration does not pause at them', () => {
    expect(splitParagraphs(chapter)).toEqual([
      'The auditors signed it off for eighteen years.',
      'Nobody asked where the cash was.',
      'Then June came.',
    ])
  })

  it('changes only the paragraph asked for, byte for byte elsewhere', () => {
    const edited = replaceParagraph(chapter, 2, 'Then, in June, it came.')

    expect(edited).toBe(
      'The auditors signed it off\nfor eighteen years.\n\n  Nobody asked where the cash was.\n\nThen, in June, it came.',
    )
    // The point of the exercise: the untouched paragraphs still hold their own
    // line breaks, so the edit trail shows a one-line diff and not a rewrite.
    expect(edited).toContain('signed it off\nfor eighteen years.')
  })

  it('keeps a block indentation that was never what the edit was about', () => {
    expect(replaceParagraph(chapter, 1, 'Nobody asked.')).toContain('\n\n  Nobody asked.\n\n')
  })

  it('counts paragraphs the way splitParagraphs does, ignoring blank blocks', () => {
    const padded = 'One.\n\n\n\nTwo.\n\n   \n\nThree.'
    expect(splitParagraphs(padded)).toEqual(['One.', 'Two.', 'Three.'])
    expect(replaceParagraph(padded, 2, 'Third.')).toContain('Third.')
  })

  it('refuses a replacement that would split one paragraph into two', () => {
    // It would shift every index after it and orphan the takes addressed by
    // them (spec section 7: paragraph indexes are stable thereafter).
    expect(replaceParagraph(chapter, 0, 'First half.\n\nSecond half.')).toBeUndefined()
  })

  it('refuses an index that is not there, rather than returning the original', () => {
    // The caller is about to pay to narrate whatever comes back, so "nothing
    // changed" and "I could not find it" must not look alike.
    expect(replaceParagraph(chapter, 9, 'Nope.')).toBeUndefined()
    expect(replaceParagraph(chapter, -1, 'Nope.')).toBeUndefined()
  })

  it('refuses an empty replacement', () => {
    expect(replaceParagraph(chapter, 0, '   ')).toBeUndefined()
  })
})

describe('narration markup', () => {
  it('recognises the three pause strengths, however they are spaced or cased', () => {
    expect(hasPauseMarkup('Let me look, [pause long] yes.')).toBe(true)
    expect(hasPauseMarkup('Wait. [pause] Then it fell.')).toBe(true)
    expect(hasPauseMarkup('Wait. [Pause  Short] Then.')).toBe(true)
    expect(hasPauseMarkup('Nothing to see here.')).toBe(false)
  })

  /**
   * A regex with the `g` flag carries `lastIndex` between calls, so the second
   * of two identical questions can answer `false`. Worth a test because the
   * consequence is a paragraph silently synthesised through the wrong input
   * field, and it would only show up on every other take.
   */
  it('answers the same question the same way twice', () => {
    const text = 'Wait. [pause] Then it fell.'
    expect(hasPauseMarkup(text)).toBe(true)
    expect(hasPauseMarkup(text)).toBe(true)
  })

  it('gives the words alone to everything that is not the synthesiser', () => {
    // A caption reading "[pause long]" is this decision's failure mode.
    expect(stripNarrationMarkup('Let me look, [pause long] yes, I see it.')).toBe(
      'Let me look, yes, I see it.',
    )
  })

  it('does not leave a space stranded before punctuation', () => {
    expect(stripNarrationMarkup('It fell [pause] , hard.')).toBe('It fell, hard.')
  })

  it('leaves paragraph structure alone, so stripping does not merge paragraphs', () => {
    expect(stripNarrationMarkup('One. [pause]\n\nTwo.')).toBe('One.\n\nTwo.')
  })

  it('leaves text with no markup exactly as it was', () => {
    expect(stripNarrationMarkup('The auditors signed it off.')).toBe('The auditors signed it off.')
  })
})

describe('markup is not words', () => {
  it('does not inflate a word count, and so does not inflate a runtime', () => {
    // Every chapter-length warning and runtime estimate is built on this.
    expect(countWords('One two three. [pause long] Four five.')).toBe(5)
    expect(estimateRuntimeSec('One two three. [pause long] Four five.')).toBe(
      estimateRuntimeSec('One two three. Four five.'),
    )
  })

  it('does not orphan a claim when a pause is added to its sentence', () => {
    // `claim_refs.sentenceHash` pins a claim to a sentence. Inserting a pause
    // changes how it is *read*, not what it asserts, so the claim must survive.
    expect(sentenceHash('The auditors signed it off. [pause] Nobody asked.')).toBe(
      sentenceHash('The auditors signed it off. Nobody asked.'),
    )
  })
})
