import type { PlannedSlot } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  MIN_SLOT_MS,
  plannedToRows,
  promptParagraphs,
  timedParagraphs,
} from './shot-list'

const CLAIM_A = '01HQ00000000000000000000AA'
const CLAIM_B = '01HQ00000000000000000000AB'

const CHAPTERS = [
  { id: 'ch-a', title: 'The audit', contentMd: 'First paragraph.\n\nSecond paragraph here.' },
  { id: 'ch-b', title: 'The collapse', contentMd: 'Third paragraph.' },
]

const take = (chapterId: string, paragraphIndex: number, durationMs: number, takeNumber = 1) => ({
  chapterId,
  paragraphIndex,
  takeNumber,
  status: 'generated',
  durationMs,
})

describe('timedParagraphs', () => {
  it('lays measured takes end to end in script order', () => {
    const timeline = timedParagraphs({
      chapters: CHAPTERS,
      takes: [take('ch-a', 0, 8000), take('ch-a', 1, 6000), take('ch-b', 0, 10000)],
    })

    expect(timeline.map((p) => [p.chapterId, p.index, p.startMs, p.durationMs])).toEqual([
      ['ch-a', 0, 0, 8000],
      ['ch-a', 1, 8000, 6000],
      ['ch-b', 0, 14000, 10000],
    ])
  })

  it('uses the CURRENT take — highest number — for each paragraph', () => {
    const timeline = timedParagraphs({
      chapters: [CHAPTERS[0]!],
      takes: [take('ch-a', 0, 8000, 1), take('ch-a', 0, 5000, 2), take('ch-a', 1, 6000)],
    })
    expect(timeline[0]?.durationMs).toBe(5000)
    expect(timeline[1]?.startMs).toBe(5000)
  })

  it('estimates a span for a paragraph with no audio instead of collapsing the clock', () => {
    const timeline = timedParagraphs({
      chapters: [CHAPTERS[0]!],
      takes: [take('ch-a', 1, 6000)],
    })
    expect(timeline[0]?.durationMs).toBeGreaterThanOrEqual(2000)
    expect(timeline[1]?.startMs).toBe(timeline[0]!.durationMs)
  })
})

describe('promptParagraphs', () => {
  it('shapes one chapter for the prompt, in seconds', () => {
    const timeline = timedParagraphs({
      chapters: CHAPTERS,
      takes: [take('ch-a', 0, 8000), take('ch-a', 1, 6000), take('ch-b', 0, 10000)],
    })
    const prompt = promptParagraphs(timeline, 'ch-b')
    expect(prompt).toEqual([{ index: 0, text: 'Third paragraph.', seconds: 10 }])
  })
})

describe('plannedToRows', () => {
  const paragraphs = timedParagraphs({
    chapters: CHAPTERS,
    takes: [take('ch-a', 0, 8000), take('ch-a', 1, 6000), take('ch-b', 0, 10000)],
  })

  const stock = (paragraphIndex: number, seconds: number): PlannedSlot => ({
    paragraphIndex,
    seconds,
    brief: {
      type: 'stock',
      coversText: 'First paragraph.',
      description: 'Deserted office at dusk.',
      motion: { kind: 'static' },
      transition: 'cut',
      query: 'empty office dusk',
      rejectionCriteria: [],
    },
  })

  it('allots slots inside their paragraph span, clamped to what remains', () => {
    const { rows, rejected } = plannedToRows({
      chapterId: 'ch-a',
      planned: [stock(0, 5), stock(0, 30), stock(1, 4)],
      paragraphs,
      claimIds: [],
    })

    expect(rejected).toEqual([])
    expect(rows.map((row) => [row.index, row.startMs, row.durationMs])).toEqual([
      [0, 0, 5000],
      // Asked for 30s of an 8s paragraph with 5s already spent: clamped to
      // the 3s remaining, floored at MIN_SLOT_MS.
      [1, 5000, 3000],
      [2, 8000, 4000],
    ])
  })

  it('never emits a slot shorter than the floor, even when the paragraph is spent', () => {
    const { rows } = plannedToRows({
      chapterId: 'ch-a',
      planned: [stock(0, 8), stock(0, 5)],
      paragraphs,
      claimIds: [],
    })
    expect(rows[1]?.durationMs).toBe(MIN_SLOT_MS)
  })

  it('swaps chart claim numbers for ids, and rejects charts citing ghosts', () => {
    const chart = (dataRefs: number[]): PlannedSlot => ({
      paragraphIndex: 0,
      seconds: 6,
      brief: {
        type: 'chart',
        coversText: 'First paragraph.',
        description: 'The collapse, drawn on.',
        motion: { kind: 'static' },
        transition: 'cut',
        chartKind: 'line',
        series: [
          {
            label: 'Share price',
            unit: 'EUR',
            points: [
              { x: '2020-06-17', y: 104.5 },
              { x: '2020-06-26', y: 1.28 },
            ],
          },
        ],
        dataRefs,
        takeaway: 'Nine days.',
        reveal: 'draw-on',
      },
    })

    const good = plannedToRows({
      chapterId: 'ch-a',
      planned: [chart([2, 1])],
      paragraphs,
      claimIds: [CLAIM_A, CLAIM_B],
    })
    expect(good.rejected).toEqual([])
    const brief = good.rows[0]?.brief
    if (brief?.type === 'chart') expect(brief.dataRefs).toEqual([CLAIM_B, CLAIM_A])

    const bad = plannedToRows({
      chapterId: 'ch-a',
      planned: [chart([9])],
      paragraphs,
      claimIds: [CLAIM_A, CLAIM_B],
    })
    expect(bad.rows).toEqual([])
    expect(bad.rejected[0]?.reason).toContain('outside the claim list')
  })

  it('rejects a slot anchored to a paragraph that does not exist', () => {
    const { rows, rejected } = plannedToRows({
      chapterId: 'ch-a',
      planned: [stock(7, 5)],
      paragraphs,
      claimIds: [],
    })
    expect(rows).toEqual([])
    expect(rejected[0]?.reason).toContain('does not exist')
  })

  it('continues chapter-wide slot indexes from startIndex', () => {
    const { rows } = plannedToRows({
      chapterId: 'ch-b',
      planned: [stock(0, 5)],
      paragraphs,
      claimIds: [],
      startIndex: 3,
    })
    expect(rows[0]?.index).toBe(3)
    expect(rows[0]?.startMs).toBe(14000)
  })
})
