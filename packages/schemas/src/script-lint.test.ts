import { describe, expect, it } from 'vitest'
import {
  BANNED_WORDS,
  CHAPTER_LENGTH_CEILING,
  CHAPTER_LENGTH_FLOOR,
  SCRIPT_LENGTH_FLOOR,
  TAG_WORDS,
  scriptLint,
} from './script-lint'
import { countWords, splitSentences } from './script'

/**
 * The deterministic style and length checks (decision 457). Free, so they run
 * in the script's self-check beside the model's warnings; every warning is
 * advisory (the kind's default) and anchored to a sentence the gutter can find.
 */

/** n distinct plain words, no punctuation, to pad a chapter to a length. */
const filler = (n: number, seed = 'w') =>
  Array.from(
    { length: n },
    (_, i) =>
      `${seed}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`,
  ).join(' ')

/** A sentence of exactly n words, ending in a full stop. */
const sentence = (n: number, seed = 'w') => `${filler(n, seed)}.`

const noTarget = { chapters: [] }

describe('the lint thresholds', () => {
  it('are the spec numbers', () => {
    expect(TAG_WORDS).toBe(120)
    expect(CHAPTER_LENGTH_FLOOR).toBe(0.9)
    expect(CHAPTER_LENGTH_CEILING).toBe(1.2)
    expect(SCRIPT_LENGTH_FLOOR).toBe(0.9)
  })

  it('carry the house style banned list verbatim', () => {
    expect(BANNED_WORDS).toEqual([
      'delve',
      'leverage',
      'robust',
      'comprehensive',
      'streamline',
      'foster',
      'facilitate',
      'pivotal',
      'nuanced',
      'multifaceted',
      'tapestry',
      'testament',
      'intricate',
      'landscape',
      'showcase',
      'underscore',
      'crucial',
      'vibrant',
      'furthermore',
      'moreover',
      'notably',
      'it is important to note',
      'in conclusion',
      'at the end of the day',
      'little did they know',
    ])
  })
})

describe('scriptLint', () => {
  it('flags a rhetorical question', () => {
    const lint = scriptLint(
      [{ index: 0, contentMd: 'The auditors signed. Why did they sign? Nobody asked.' }],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: 'Why did they sign?',
          message: 'A rhetorical question. The house style bans them: say the thing.',
        },
      },
    ])
  })

  it('flags a question that a tag trails', () => {
    const lint = scriptLint(
      [{ index: 2, contentMd: 'The auditors signed. Why did [pause] they sign? Nobody asked.' }],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 2,
        warning: {
          kind: 'style',
          sentence: 'Why did [pause] they sign?',
          message: 'A rhetorical question. The house style bans them: say the thing.',
        },
      },
    ])
  })

  it('flags a banned word as a whole word, case-insensitively, once per sentence', () => {
    const lint = scriptLint(
      [{ index: 0, contentMd: 'The firm tried to Leverage its robust name. Nothing else here.' }],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: 'The firm tried to Leverage its robust name.',
          message: 'Banned word: "leverage".',
        },
      },
    ])
  })

  it('flags a banned phrase and ignores a word that merely contains one', () => {
    const lint = scriptLint(
      [
        {
          index: 0,
          contentMd:
            'Little did they know the end was near. The landscaper worked on the lawn. A fostering order followed.',
        },
      ],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: 'Little did they know the end was near.',
          message: 'Banned word: "little did they know".',
        },
      },
    ])
  })

  it('flags three sentences of near-equal length, anchored to the third', () => {
    const a = sentence(10, 'a')
    const b = sentence(11, 'b')
    const c = sentence(12, 'c')
    const lint = scriptLint([{ index: 1, contentMd: `${a} ${b} ${c} Short one.` }], noTarget, 0)
    expect(lint).toEqual([
      {
        chapterIndex: 1,
        warning: {
          kind: 'style',
          sentence: c,
          message: 'Three sentences of 10, 11 and 12 words in a row. Vary the length.',
        },
      },
    ])
  })

  it('leaves three sentences more than two words apart, or of eight words or fewer', () => {
    const apart = `${sentence(10, 'a')} ${sentence(11, 'b')} ${sentence(13, 'c')}`
    const short = `${sentence(8, 'a')} ${sentence(8, 'b')} ${sentence(8, 'c')}`
    expect(scriptLint([{ index: 0, contentMd: apart }], noTarget, 0)).toEqual([])
    expect(scriptLint([{ index: 0, contentMd: short }], noTarget, 0)).toEqual([])
  })

  it('flags a tag as its own paragraph, anchored to the paragraph as written', () => {
    const lint = scriptLint(
      [{ index: 0, contentMd: 'The auditors signed.\n\n[long pause]\n\nThe money was gone.' }],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: '[long pause]',
          message:
            'A tag as its own paragraph. A paragraph is one voice take and must contain spoken words.',
        },
      },
    ])
  })

  it('flags more tags than one per 120 words, anchored to the tag that crossed the limit', () => {
    const first = `${filler(30, 'p')} [pause] ${filler(20, 'q')}.`
    const second = `${filler(30, 'r')} [whispers] ${filler(20, 's')}.`
    const lint = scriptLint([{ index: 0, contentMd: `${first} ${second}` }], noTarget, 0)
    // 100 words, one allowed: the second tag crosses it.
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: second,
          message: '2 narration tags in 100 words. At most one every 120 words.',
        },
      },
    ])
  })

  it('counts tags against the stripped word count and anchors the one over the limit', () => {
    const one = `${filler(40, 'a')} [pause] ${filler(10, 'b')}.`
    const two = `${filler(40, 'c')} [sighs] ${filler(10, 'd')}.`
    const three = `${filler(20, 'e')} [whispers] ${filler(10, 'f')}.`
    const lint = scriptLint([{ index: 0, contentMd: `${one} ${two} ${three}` }], noTarget, 0)
    const chapter = `${one} ${two} ${three}`
    expect(countWords(chapter)).toBe(130)
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: three,
          message: '3 narration tags in 130 words. At most one every 120 words.',
        },
      },
    ])
  })

  it('flags [long pause] used twice, anchored to the second', () => {
    const lint = scriptLint(
      [
        {
          index: 0,
          contentMd: `The books were closed [long pause] by March. ${sentence(120, 'x')} The sums were wrong [long pause] again.`,
        },
      ],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: 'The sums were wrong [long pause] again.',
          message: '[long pause] more than once in a chapter. Keep one.',
        },
      },
    ])
  })

  it('flags a number written in digits, the first per sentence', () => {
    const lint = scriptLint(
      [{ index: 0, contentMd: 'The firm lost 450 million in a year. Nobody blinked.' }],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: 'The firm lost 450 million in a year.',
          message: 'Spell it out: "450".',
        },
      },
    ])
  })

  it('leaves a four-digit year alone and flags 1,900 and 101', () => {
    const lint = scriptLint(
      [
        {
          index: 0,
          contentMd:
            'It began in 2019 with a memo. The bill came to 1,900 dollars. Room 101 stayed shut.',
        },
      ],
      noTarget,
      0,
    )
    expect(lint).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: 'The bill came to 1,900 dollars.',
          message: 'Spell it out: "1,900".',
        },
      },
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: 'Room 101 stayed shut.',
          message: 'Spell it out: "101".',
        },
      },
    ])
  })

  it('flags a chapter under its floor or over its ceiling, anchored to its last sentence', () => {
    const body = `${filler(40, 'a')}. ${filler(39, 'b')}. Last word here.`
    // 40 + 39 + 3 = 82 words against 100 is 82%, under the 90% floor.
    expect(
      scriptLint([{ index: 0, contentMd: body }], { chapters: [{ targetWords: 100 }] }, 0),
    ).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'off-target-length',
          sentence: 'Last word here.',
          message: '82 words against a target of 100 (82%).',
        },
      },
    ])
    // 82 words against 60 is 137%, over the 120% ceiling.
    expect(
      scriptLint([{ index: 0, contentMd: body }], { chapters: [{ targetWords: 60 }] }, 0),
    ).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'off-target-length',
          sentence: 'Last word here.',
          message: '82 words against a target of 60 (137%).',
        },
      },
    ])
  })

  it('flags a whole script under 90% of its target, anchored to the last chapter', () => {
    const first = `${filler(30, 'a')}. Then stop.`
    const last = `${filler(20, 'b')}. The end.`
    const lint = scriptLint(
      [
        { index: 0, contentMd: first },
        { index: 1, contentMd: last },
      ],
      { chapters: [{ targetWords: 34 }, { targetWords: 24 }] },
      100,
    )
    // 32 + 22 = 54 words against 100.
    expect(lint).toEqual([
      {
        chapterIndex: 1,
        warning: {
          kind: 'off-target-length',
          sentence: 'The end.',
          message: 'The script is 54 words against a target of 100 (54%).',
        },
      },
    ])
  })

  it('flags nothing in a clean chapter', () => {
    const contentMd =
      'The audit closed in 2019. Nobody called it a failure [pause] then. ' +
      'Three partners, all of them tired, signed the accounts before dinner. ' +
      'It was a Tuesday. ' +
      'The money, as the later report found, had never been in the bank at all.'
    const target = countWords(contentMd)
    expect(splitSentences(contentMd)).toHaveLength(5)
    expect(
      scriptLint([{ index: 0, contentMd }], { chapters: [{ targetWords: target }] }, target),
    ).toEqual([])
  })

  it('gives an empty chapter and a tag-only chapter no length or question warning', () => {
    expect(
      scriptLint([{ index: 0, contentMd: '' }], { chapters: [{ targetWords: 300 }] }, 300),
    ).toEqual([])
    expect(
      scriptLint([{ index: 0, contentMd: '[pause]' }], { chapters: [{ targetWords: 300 }] }, 0),
    ).toEqual([
      {
        chapterIndex: 0,
        warning: {
          kind: 'style',
          sentence: '[pause]',
          message:
            'A tag as its own paragraph. A paragraph is one voice take and must contain spoken words.',
        },
      },
    ])
  })

  it('skips a chapter the outline does not cover', () => {
    const contentMd = `${filler(40, 'a')}. ${filler(39, 'b')}. Last word here.`
    expect(scriptLint([{ index: 3, contentMd }], { chapters: [{ targetWords: 100 }] }, 0)).toEqual(
      [],
    )
  })

  it('never writes a severity, so the kind default applies', () => {
    const lint = scriptLint([{ index: 0, contentMd: 'Why did they sign?' }], noTarget, 0)
    expect(lint).toHaveLength(1)
    expect(Object.keys(lint[0]!.warning).sort()).toEqual(['kind', 'message', 'sentence'])
  })
})
