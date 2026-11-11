import type { Caption } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { PARAGRAPH_GAP_MS } from './compile'
import {
  endsClause,
  FIGURE_HOLD_MS,
  planReadingPauses,
  READING_HOLD_MS,
  READING_PAUSE_CAP_MS,
} from './reading-hold'

function word(text: string, startMs: number, endMs = startMs + 300): Caption {
  return { text, startMs, endMs, timestampMs: startMs, confidence: 1 } as Caption
}

/** One paragraph, 0 to 6000: the graphic's last word 'four.' starts at 4000. */
const oneParagraph = [
  word('it', 0),
  word('raised', 1000),
  word('about', 2000),
  word('four.', 4000, 4300),
  word('Then', 4400),
  word('it', 5000),
]
const oneSpan = [{ startMs: 0, endMs: 6000 }]
const noShift = () => 0

describe('planReadingPauses', () => {
  it('pauses a graphic whose next shot follows its last word too closely', () => {
    const { pauses, report } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: READING_HOLD_MS }, { startMs: 4400 }],
      ranges: [{ first: 0, last: 3 }, null],
      words: oneParagraph,
      spans: oneSpan,
      shiftAt: noShift,
    })
    expect(pauses).toEqual([
      { slotIndex: 0, cutMs: 4350, pauseMs: READING_PAUSE_CAP_MS, paragraphEnd: false },
    ])
    expect(report).toEqual({ pauses: 1, addedMs: 1500, midClause: 0, overlapped: 0 })
  })

  it('adds no pause when the slot already has the time', () => {
    const { pauses } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: READING_HOLD_MS }, { startMs: 6200 }],
      ranges: [{ first: 0, last: 3 }, null],
      words: oneParagraph,
      spans: oneSpan,
      shiftAt: noShift,
    })
    expect(pauses).toEqual([])
  })

  it('counts the paragraph gap as available time', () => {
    const words = [word('one', 0), word('done.', 4000, 4400), word('next', 5000), word('up', 5500)]
    const spans = [
      { startMs: 0, endMs: 5000 },
      { startMs: 5000, endMs: 9000 },
    ]
    const { pauses } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: READING_HOLD_MS }, { startMs: 5000 }],
      ranges: [{ first: 0, last: 1 }, null],
      words,
      spans,
      shiftAt: (t) => (t >= 5000 ? PARAGRAPH_GAP_MS : 0),
    })
    // 1000 + 700 of silence after the last word's start leaves 300 to find.
    expect(pauses).toEqual([{ slotIndex: 0, cutMs: 5000, pauseMs: 300, paragraphEnd: true }])
  })

  it('skips a mid-clause last word', () => {
    const words = [...oneParagraph.slice(0, 3), word('the', 4000), ...oneParagraph.slice(4)]
    const { pauses, report } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: READING_HOLD_MS }, { startMs: 4400 }],
      ranges: [{ first: 0, last: 3 }, null],
      words,
      spans: oneSpan,
      shiftAt: noShift,
    })
    expect(pauses).toEqual([])
    expect(report.midClause).toBe(1)
  })

  it('skips a slot overlapped by the next shot', () => {
    const { pauses, report } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: READING_HOLD_MS }, { startMs: 3500 }],
      ranges: [{ first: 0, last: 3 }, null],
      words: oneParagraph,
      spans: oneSpan,
      shiftAt: noShift,
    })
    expect(pauses).toEqual([])
    expect(report.overlapped).toBe(1)
  })

  it('skips a slot whose next shot starts before the cut', () => {
    const { pauses, report } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: READING_HOLD_MS }, { startMs: 4100 }],
      ranges: [{ first: 0, last: 3 }, null],
      words: oneParagraph,
      spans: oneSpan,
      shiftAt: noShift,
    })
    expect(pauses).toEqual([])
    expect(report).toEqual({ pauses: 0, addedMs: 0, midClause: 0, overlapped: 1 })
  })

  it('uses the figure hold', () => {
    const { pauses } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: FIGURE_HOLD_MS }, { startMs: 5200 }],
      ranges: [{ first: 0, last: 3 }, null],
      words: oneParagraph,
      spans: oneSpan,
      shiftAt: noShift,
    })
    expect(pauses[0]!.pauseMs).toBe(1300)
  })

  it('leaves the film last slot to the compiler', () => {
    const { pauses } = planReadingPauses({
      slots: [{ startMs: 0, holdMs: READING_HOLD_MS }],
      ranges: [{ first: 0, last: 3 }],
      words: oneParagraph,
      spans: oneSpan,
      shiftAt: noShift,
    })
    expect(pauses).toEqual([])
  })
})

describe('endsClause', () => {
  it('is true where a clause closes', () => {
    for (const text of ['gone.', 'year,', '"done."', '(2020).']) expect(endsClause(text)).toBe(true)
  })
  it('is false mid-clause', () => {
    for (const text of ['the', '4.2bn']) expect(endsClause(text)).toBe(false)
  })
})
