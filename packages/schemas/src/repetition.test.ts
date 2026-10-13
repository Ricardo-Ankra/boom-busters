import { describe, expect, it } from 'vitest'
import { findRepeats, REPEAT_RUN_WORDS } from './repetition'

/**
 * The whole-script repetition check (decision 296). Deterministic and free:
 * a sentence that carries a six-word run an earlier chapter already narrated
 * is a gutter warning on the later chapter, naming the earlier one. A model
 * drafting chapter four cannot see chapter one's words; this pass can.
 */

const march =
  'In the first quarter of 2024, according to The Information, Stability AI brought in under 5 million dollars in revenue.'

describe('findRepeats', () => {
  it('matches runs of six words', () => {
    expect(REPEAT_RUN_WORDS).toBe(6)
  })

  it('flags a sentence that repeats a run from an earlier chapter, naming it', () => {
    const repeats = findRepeats([
      { index: 0, contentMd: `${march} Hold on to that name.` },
      { index: 1, contentMd: 'A paper was posted. Nobody read it.' },
      {
        index: 3,
        contentMd: `So back to March. Revenue, according to The Information, was under 5 million dollars in revenue. Then the founder went too.`,
      },
    ])
    expect(repeats).toHaveLength(1)
    expect(repeats[0]).toEqual({
      chapterIndex: 3,
      warning: {
        kind: 'repeats-earlier',
        sentence: 'Revenue, according to The Information, was under 5 million dollars in revenue.',
        message: `Repeats chapter 1: "${march}"`,
      },
    })
  })

  it('does not flag a five-word overlap', () => {
    expect(
      findRepeats([
        { index: 0, contentMd: 'In the first quarter of 2024 the money ran out.' },
        { index: 1, contentMd: 'In the first quarter of 2023 the lawsuits began.' },
      ]),
    ).toEqual([])
  })

  it('sees through narration tags, punctuation and case', () => {
    const repeats = findRepeats([
      { index: 0, contentMd: 'Coatue had co-led the 101 million dollar round.' },
      {
        index: 1,
        contentMd:
          '[long pause] coatue had co-led the 101 million [pause] dollar round, and now it was asking questions.',
      },
    ])
    expect(repeats).toHaveLength(1)
    expect(repeats[0]!.warning.sentence).toBe(
      '[long pause] coatue had co-led the 101 million [pause] dollar round, and now it was asking questions.',
    )
  })

  it('does not flag a repeat inside one chapter', () => {
    expect(findRepeats([{ index: 0, contentMd: `${march} ${march}` }])).toEqual([])
    expect(
      findRepeats([
        { index: 0, contentMd: 'Nothing here is long enough.' },
        { index: 1, contentMd: `${march} ${march}` },
      ]),
    ).toEqual([])
  })

  it('writes one warning per sentence however many runs match', () => {
    const repeats = findRepeats([
      { index: 0, contentMd: march },
      { index: 1, contentMd: march },
    ])
    expect(repeats).toHaveLength(1)
  })

  it('quotes a long earlier sentence cut to 160 characters, tags stripped', () => {
    const long = `[measured] ${'word '.repeat(60).trim()}.`
    const repeats = findRepeats([
      { index: 0, contentMd: long },
      { index: 1, contentMd: 'word word word word word word, it said again.' },
    ])
    const message = repeats[0]!.warning.message
    expect(message.startsWith('Repeats chapter 1: "word word')).toBe(true)
    expect(message).not.toContain('[measured]')
    expect(message.length).toBeLessThanOrEqual('Repeats chapter 1: ""'.length + 163)
  })

  it('places the warning on a sentence that exists in the chapter text', () => {
    const contentMd = `Something new first.\n\n${march}\n\nAnd then more.`
    const repeats = findRepeats([
      { index: 0, contentMd: march },
      { index: 1, contentMd },
    ])
    expect(contentMd.includes(repeats[0]!.warning.sentence)).toBe(true)
  })

  it('takes chapters in index order whatever the array order', () => {
    const repeats = findRepeats([
      { index: 1, contentMd: march },
      { index: 0, contentMd: march },
    ])
    expect(repeats.map((repeat) => repeat.chapterIndex)).toEqual([1])
  })

  it('is empty for one chapter or none', () => {
    expect(findRepeats([])).toEqual([])
    expect(findRepeats([{ index: 0, contentMd: march }])).toEqual([])
  })
})
