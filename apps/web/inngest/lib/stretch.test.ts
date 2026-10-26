import { describe, expect, it } from 'vitest'
import { cutStretch, stretchAnswerIssue, type StretchRow } from './stretch'
import type { TimedParagraph } from './shot-list'

const NEIGHBOURS = 'Re-plan works on neighbouring shots in one chapter.'
const NO_TIMINGS =
  'This narration has no word timings, so a stretch cannot be cut. Use Re-plan shot list instead.'

function words(text: string, startMs: number, stepMs = 500) {
  return text.split(' ').map((word, i) => ({ text: word, startMs: startMs + i * stepMs }))
}

const P0 = 'In 2021 CNBC reported that the company had lied to investors about its blood tests'
const P1 = 'Then the board stepped in and the founder was forced to resign within a week'
const P0_WORDS = words(P0, 0) // 16 words, 0 to 7500
const P1_WORDS = words(P1, 8500) // 15 words

const paragraphs: TimedParagraph[] = [
  { chapterId: 'c1', index: 0, text: P0, startMs: 0, durationMs: 8500, words: P0_WORDS },
  { chapterId: 'c1', index: 1, text: P1, startMs: 8500, durationMs: 8000, words: P1_WORDS },
]

const row = (id: string, index: number, startMs: number, durationMs: number, coversText: string) =>
  ({
    id,
    chapterId: 'c1',
    index,
    type: 'headline',
    brief: {},
    startMs,
    durationMs,
    coversText,
  }) satisfies StretchRow

const A = row('a', 0, 0, 4000, 'In 2021 CNBC reported that the company')
const B = row('b', 1, 4000, 4500, 'had lied to investors about its blood tests')
const C = row('c', 2, 8500, 8000, 'Then the board stepped in and the founder')

describe('cutStretch', () => {
  it('cuts the Theranos pair to the whole first paragraph', () => {
    const cut = cutStretch({ chapterRows: [A, B, C], selectedIds: [A.id, B.id], paragraphs })
    expect(cut).toMatchObject({
      ok: true,
      before: null,
      after: { id: C.id },
      stretch: {
        firstWord: 0,
        lastWord: P0_WORDS.length - 1,
        startMs: 0,
        endMs: 8500,
        pieces: [{ paragraphIndex: 0, seconds: 8.5 }],
        opening: 'In 2021 CNBC reported that the',
      },
    })
  })

  it("runs a stretch ending on the chapter's last shot to the end of its paragraph", () => {
    const cut = cutStretch({ chapterRows: [A, B, C], selectedIds: [C.id], paragraphs })
    expect(cut).toMatchObject({
      ok: true,
      before: { id: B.id },
      after: null,
      stretch: {
        firstWord: P0_WORDS.length,
        lastWord: P0_WORDS.length + P1_WORDS.length - 1,
        endMs: 16500,
        pieces: [{ paragraphIndex: 1, seconds: 8 }],
      },
    })
  })

  it('refuses a selection with a gap', () => {
    expect(cutStretch({ chapterRows: [A, B, C], selectedIds: [A.id, C.id], paragraphs })).toEqual({
      ok: false,
      refused: NEIGHBOURS,
    })
  })

  it('refuses an empty selection and an id outside the chapter', () => {
    expect(cutStretch({ chapterRows: [A, B, C], selectedIds: [], paragraphs })).toEqual({
      ok: false,
      refused: NEIGHBOURS,
    })
    expect(cutStretch({ chapterRows: [A, B, C], selectedIds: [A.id, 'z'], paragraphs })).toEqual({
      ok: false,
      refused: NEIGHBOURS,
    })
  })

  it('refuses narration without word timings', () => {
    const bare = paragraphs.map((p) => ({ ...p, words: [] }))
    expect(cutStretch({ chapterRows: [A, B, C], selectedIds: [A.id], paragraphs: bare })).toEqual({
      ok: false,
      refused: NO_TIMINGS,
    })
  })
})

describe('stretchAnswerIssue', () => {
  const cut = cutStretch({ chapterRows: [A, B, C], selectedIds: [A.id, B.id], paragraphs })
  if (!cut.ok) throw new Error('fixture')
  const stretch = cut.stretch
  const good = [
    { type: 'still', startMs: 0, durationMs: 4000, coversText: A.coversText },
    { type: 'still', startMs: 4000, durationMs: 4500, coversText: B.coversText },
  ]
  const base = {
    stretch,
    rows: good,
    planned: 2,
    rejected: [],
    paragraphs,
    headlineAllowed: true,
    strictTiming: true,
  }

  it('accepts two quotes that start at the stretch and do not overlap', () => {
    expect(stretchAnswerIssue(base)).toBeNull()
  })

  it('refuses a quote outside the stretch', () => {
    const rows = [
      good[0]!,
      { type: 'still', startMs: 8500, durationMs: 4000, coversText: C.coversText },
    ]
    expect(stretchAnswerIssue({ ...base, rows })).toContain('Then the board stepped in')
  })

  it('refuses an answer that lost a slot in conversion', () => {
    const reason = 'chapter already has 1 headline shot, which is the cap'
    const issue = stretchAnswerIssue({
      ...base,
      rows: [good[0]!],
      planned: 3,
      rejected: [{ reason }],
    })
    expect(issue).toContain(reason)
  })

  it('refuses a first quote that does not start at the stretch', () => {
    const rows = [
      { type: 'still', startMs: 4000, durationMs: 4500, coversText: B.coversText },
      { type: 'still', startMs: 4000, durationMs: 4500, coversText: B.coversText },
    ]
    expect(stretchAnswerIssue({ ...base, rows })).not.toBeNull()
  })

  it('refuses quotes that overlap', () => {
    const rows = [
      { type: 'still', startMs: 0, durationMs: 4000, coversText: A.coversText },
      { type: 'still', startMs: 0, durationMs: 4500, coversText: A.coversText },
    ]
    expect(stretchAnswerIssue({ ...base, rows })).not.toBeNull()
  })

  it('refuses a headline where the chapter already has one', () => {
    const rows = [{ ...good[0]!, type: 'headline' }, good[1]!]
    expect(stretchAnswerIssue({ ...base, rows, headlineAllowed: false })).toMatch(/headline/)
  })

  it('refuses a too-short new shot only on the first attempt', () => {
    const rows = [
      { type: 'still', startMs: 0, durationMs: 500, coversText: A.coversText },
      { type: 'still', startMs: 500, durationMs: 8000, coversText: B.coversText },
    ]
    expect(stretchAnswerIssue({ ...base, rows, strictTiming: true })).not.toBeNull()
    expect(stretchAnswerIssue({ ...base, rows, strictTiming: false })).toBeNull()
  })
})
