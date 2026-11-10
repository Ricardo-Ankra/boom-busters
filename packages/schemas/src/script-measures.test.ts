import { describe, expect, it } from 'vitest'
import {
  chapterEndings,
  classifyEdit,
  hedgeDensity,
  tagDensity,
  warningsByKind,
} from './script-measures'

const filler = (count: number) => Array.from({ length: count }, () => 'word').join(' ')

describe('hedgeDensity', () => {
  it('counts hedge phrases per hundred words', () => {
    // Three hedge phrases among 200 words in all.
    const text = `The fund was alleged ${filler(60)} according to the filing ${filler(60)} reportedly ${filler(
      71,
    )}`
    expect(text.split(/\s+/)).toHaveLength(200)
    expect(hedgeDensity([{ contentMd: text }])).toBe(1.5)
  })

  it('is zero for no words', () => {
    expect(hedgeDensity([])).toBe(0)
    expect(hedgeDensity([{ contentMd: '   ' }])).toBe(0)
  })

  it('does not count a pause tag as a word', () => {
    const text = `Allegedly. ${filler(99)} [pause]`
    expect(hedgeDensity([{ contentMd: text }])).toBe(1)
  })
})

describe('tagDensity', () => {
  it('counts narration tags per hundred words, to one decimal', () => {
    // 100 words in the first chapter with two tags, 100 in the second with one: 3 per 200.
    const a = `[pause] ${filler(100)} [beat]`
    const b = `${filler(100)} [pause]`
    expect(tagDensity([{ contentMd: a }, { contentMd: b }])).toBe(1.5)
  })

  it('is zero for no words', () => {
    expect(tagDensity([])).toBe(0)
  })
})

describe('chapterEndings', () => {
  it('counts questions and chapters sharing a closing three words', () => {
    const a = { contentMd: 'It began. So what happens next?' }
    const b = { contentMd: 'Nobody knew. And what happens next?' }
    const c = { contentMd: 'Then it ended. That was all.' }
    expect(chapterEndings([a, b, c])).toEqual({ questions: 2, sameShape: 2 })
  })

  it('counts nothing for chapters that end differently', () => {
    const a = { contentMd: 'One sentence here.' }
    const b = { contentMd: 'A different closing line.' }
    expect(chapterEndings([a, b])).toEqual({ questions: 0, sameShape: 0 })
  })
})

describe('classifyEdit', () => {
  it('spots a removed tag', () => {
    expect(classifyEdit('He left. [pause] Then he spoke.', 'He left. Then he spoke.')).toBe('tag')
  })

  it('spots a number spelt out', () => {
    expect(classifyEdit('There were 101 of them.', 'There were one hundred and one of them.')).toBe(
      'number',
    )
  })

  it('spots a deleted caveat', () => {
    expect(
      classifyEdit('He took the money. He was allegedly paid twice.', 'He took the money.'),
    ).toBe('hedge')
  })

  it('calls any other change other', () => {
    expect(classifyEdit('He took the money.', 'He took the cash.')).toBe('other')
  })
})

describe('warningsByKind', () => {
  it('totals warnings by kind across chapters', () => {
    const w = (kind: string) => ({ kind, sentence: 's', message: 'message' })
    expect(
      warningsByKind([
        { warnings: [w('craft'), w('style')] },
        { warnings: [w('craft')] },
        { warnings: [] },
      ]),
    ).toEqual({ craft: 2, style: 1 })
  })
})
