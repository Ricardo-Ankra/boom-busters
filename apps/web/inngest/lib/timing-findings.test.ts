import { describe, expect, it } from 'vitest'
import type { TimedParagraph } from './shot-list'
import { repairStretches, timingFindings } from './timing-findings'
import type { TimingFinding, TimingSlot } from './timing-findings'

const TEXT =
  'Other tallies went higher. In 2021, CNBC reported that Holmes persuaded investors to put up 945 million.'
const SECOND = 'In 2021, CNBC reported that Holmes persuaded investors to put up 945 million.'

function paragraphOf(
  text: string,
  over: Partial<TimedParagraph> & { startMs?: number } = {},
): TimedParagraph {
  const startMs = over.startMs ?? 0
  const tokens = text.split(' ')
  return {
    chapterId: 'c1',
    index: 0,
    text,
    startMs,
    durationMs: tokens.length * 500,
    words: tokens.map((t, i) => ({ text: t, startMs: startMs + i * 500 })),
    ...over,
  }
}

const paragraph = paragraphOf(TEXT)
const A: TimingSlot = {
  chapterId: 'c1',
  type: 'headline',
  startMs: 0,
  durationMs: 2_000,
  coversText: TEXT,
}
const B: TimingSlot = {
  chapterId: 'c1',
  type: 'stock',
  startMs: 2_000,
  durationMs: 6_500,
  coversText: SECOND,
}

function slot(over: Partial<TimingSlot>): TimingSlot {
  return {
    chapterId: 'c1',
    type: 'stock',
    startMs: 0,
    durationMs: 6_000,
    coversText: null,
    ...over,
  }
}
function finding(stretch: number[], chapterId = 'c1'): TimingFinding {
  return { kind: 'too-short', chapterId, slotIndexes: [stretch[0]!], stretch, message: '' }
}

describe('timingFindings', () => {
  it('flags the Theranos headline as too short and the pair as sharing a sentence', () => {
    const found = timingFindings([A, B], [paragraph])
    expect(found.map((f) => [f.kind, f.slotIndexes, f.stretch])).toEqual([
      ['too-short', [0], [0, 1]],
      ['shared-sentence', [0, 1], [0, 1]],
    ])
    expect(found[0]!.message).toBe(
      'this news headline is on screen for 2.0 s; it needs at least 5 s',
    )
    expect(found[1]!.message).toBe(
      'this shot and the next both quote "In 2021, CNBC reported that Holmes…"; one sentence needs one shot',
    )
  })

  it('does not flag a lone shot in a paragraph shorter than its minimum', () => {
    const short = paragraphOf('A very short line.', { durationMs: 2_000 })
    expect(
      timingFindings([slot({ startMs: 0, durationMs: 2_000, coversText: null })], [short]),
    ).toEqual([])
  })

  it('re-plans the previous shot with the last shot of a paragraph', () => {
    const p = paragraphOf(TEXT, { durationMs: 9_000 })
    const found = timingFindings(
      [slot({ startMs: 0, durationMs: 6_000 }), slot({ startMs: 6_000, durationMs: 1_500 })],
      [p],
    )
    expect(found.map((f) => [f.kind, f.slotIndexes, f.stretch])).toEqual([
      ['too-short', [1], [0, 1]],
    ])
    expect(found[0]!.message).toBe('this stock shot is on screen for 1.5 s; it needs at least 3 s')
  })

  it('never builds a stretch across chapters', () => {
    const p1 = paragraphOf(TEXT, { durationMs: 9_000 })
    const p2 = paragraphOf(TEXT, { chapterId: 'c2', startMs: 9_000, durationMs: 9_000 })
    const found = timingFindings(
      [
        slot({ startMs: 0, durationMs: 6_000 }),
        slot({ startMs: 6_000, durationMs: 1_500 }),
        slot({ chapterId: 'c2', startMs: 9_000, durationMs: 6_000 }),
      ],
      [p1, p2],
    )
    expect(found.map((f) => f.stretch)).toEqual([[0, 1]])
    const alone = timingFindings(
      [
        slot({ startMs: 6_000, durationMs: 1_500 }),
        slot({ chapterId: 'c2', startMs: 9_000, durationMs: 6_000 }),
      ],
      [p1, p2],
    )
    expect(alone.map((f) => f.stretch)).toEqual([[0]])
  })

  it('finds no shared sentence without word timings', () => {
    const found = timingFindings([A, B], [{ ...paragraph, words: [] }])
    expect(found.map((f) => f.kind)).toEqual(['too-short'])
  })
})

describe('repairStretches', () => {
  it('merges touching stretches into one', () => {
    expect(repairStretches([finding([0, 1]), finding([1, 2]), finding([4, 5])])).toEqual([
      [0, 1, 2],
      [4, 5],
    ])
  })

  it('merges stretches that are adjacent, and keeps chapters apart', () => {
    expect(
      repairStretches([finding([2, 3]), finding([0, 1]), finding([4], 'c2'), finding([5], 'c2')]),
    ).toEqual([
      [0, 1, 2, 3],
      [4, 5],
    ])
    expect(repairStretches([finding([3], 'c1'), finding([4], 'c2')])).toEqual([[3], [4]])
  })
})
