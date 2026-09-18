import type { PlannedSlot } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  anchoredTimes,
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
      claims: [],
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
      claims: [],
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
      claims: [{ id: CLAIM_A }, { id: CLAIM_B }],
    })
    expect(good.rejected).toEqual([])
    const brief = good.rows[0]?.brief
    if (brief?.type === 'chart') expect(brief.dataRefs).toEqual([CLAIM_B, CLAIM_A])

    const bad = plannedToRows({
      chapterId: 'ch-a',
      planned: [chart([9])],
      paragraphs,
      claims: [{ id: CLAIM_A }, { id: CLAIM_B }],
    })
    expect(bad.rows).toEqual([])
    expect(bad.rejected[0]?.reason).toContain('outside the claim list')
  })

  it('rejects a slot anchored to a paragraph that does not exist', () => {
    const { rows, rejected } = plannedToRows({
      chapterId: 'ch-a',
      planned: [stock(7, 5)],
      paragraphs,
      claims: [],
    })
    expect(rows).toEqual([])
    expect(rejected[0]?.reason).toContain('does not exist')
  })

  describe('headline slots (decision 257)', () => {
    const NEWS = [
      { id: CLAIM_A, sourceType: 'court', sourceUrl: 'https://courts.example/judgment' },
      { id: CLAIM_B, sourceType: 'major_outlet', sourceUrl: 'https://news.example/story' },
    ]
    const headline = (paragraphIndex: number, sourceRef: number): PlannedSlot => ({
      paragraphIndex,
      seconds: 7,
      brief: {
        type: 'headline',
        coversText: 'First paragraph.',
        description: 'The morning the story broke.',
        motion: { kind: 'static' },
        transition: 'cut',
        sourceRef,
      },
    })

    it('stores the claim the card cites', () => {
      const { rows, rejected } = plannedToRows({
        chapterId: 'ch-a',
        planned: [headline(0, 2)],
        paragraphs,
        claims: NEWS,
      })
      expect(rejected).toEqual([])
      const brief = rows[0]?.brief
      expect(rows[0]?.type).toBe('headline')
      if (brief?.type === 'headline') expect(brief.sourceClaimId).toBe(CLAIM_B)
    })

    it('refuses a claim no news outlet published, and says so', () => {
      const { rows, rejected } = plannedToRows({
        chapterId: 'ch-a',
        planned: [headline(0, 1)],
        paragraphs,
        claims: NEWS,
      })
      expect(rows).toEqual([])
      expect(rejected[0]?.reason).toBe('headline cited a claim that is not a news report')
    })

    it('keeps one a chapter and drops the surplus', () => {
      const { rows, rejected } = plannedToRows({
        chapterId: 'ch-a',
        planned: [headline(0, 2), headline(1, 2), headline(1, 2)],
        paragraphs,
        claims: NEWS,
      })
      expect(rows.filter((row) => row.type === 'headline')).toHaveLength(1)
      expect(rejected).toHaveLength(2)
      expect(rejected[0]?.reason).toContain('which is the cap')
    })
  })

  it('continues chapter-wide slot indexes from startIndex', () => {
    const { rows } = plannedToRows({
      chapterId: 'ch-b',
      planned: [stock(0, 5)],
      paragraphs,
      claims: [],
      startIndex: 3,
    })
    expect(rows[0]?.index).toBe(3)
    expect(rows[0]?.startMs).toBe(14000)
  })
})

// ---------------------------------------------------------------------------
// Anchoring (decision 255): a slot sits on the words its brief quotes
// ---------------------------------------------------------------------------

const SPOKEN_CHAPTER = {
  id: 'ch-c',
  title: 'The meeting',
  contentMd: 'The board met on a Friday. Prem Akkaraju had already agreed terms.',
}

/** What the narrator was heard saying: one word every 500ms. */
function heard(text: string): { text: string; startMs: number; endMs: number }[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({ text: word, startMs: index * 500, endMs: index * 500 + 500 }))
}

const SPOKEN_TAKE = {
  ...take('ch-c', 0, 6000),
  timings: heard(SPOKEN_CHAPTER.contentMd),
}

function shot(paragraphIndex: number, seconds: number, coversText: string): PlannedSlot {
  return {
    paragraphIndex,
    seconds,
    brief: {
      type: 'stock',
      coversText,
      description: 'A boardroom, shot from the doorway.',
      motion: { kind: 'static' },
      transition: 'cut',
      query: 'boardroom meeting',
      rejectionCriteria: [],
    },
  } as unknown as PlannedSlot
}

describe('slots sit on the words they cover', () => {
  const paragraphs = timedParagraphs({ chapters: [SPOKEN_CHAPTER], takes: [SPOKEN_TAKE] })

  it('snaps the take onto the project clock, word by word', () => {
    expect(paragraphs[0]?.words[0]).toEqual({ text: 'The', startMs: 0 })
    // "Prem" is the seventh word.
    expect(paragraphs[0]?.words[6]).toEqual({ text: 'Prem', startMs: 3000 })
  })

  it('moves a slot onto its own sentence and ends the one before it there', () => {
    const { rows } = plannedToRows({
      chapterId: 'ch-c',
      // The planner gave the opening shot four seconds; the words take three.
      planned: [
        shot(0, 4, 'The board met on a Friday.'),
        shot(0, 2, 'Prem Akkaraju had already agreed terms.'),
      ],
      paragraphs,
      claims: [],
    })
    expect(rows.map((row) => [row.startMs, row.durationMs])).toEqual([
      [0, 3000],
      [3000, 3000],
    ])
  })

  it('keeps the planned time for a quote that is not in the narration', () => {
    const { rows } = plannedToRows({
      chapterId: 'ch-c',
      planned: [
        shot(0, 4, 'The board met on a Friday.'),
        shot(0, 2, 'A sentence from a different film.'),
      ],
      paragraphs,
      claims: [],
    })
    expect(rows[1]?.startMs).toBe(4000)
  })

  it('ends a paragraph last shot at its paragraph, not the next one first word', () => {
    // The board anchors every slot of the film in one call and the planner
    // anchors one chapter at a time; scoping ends to the paragraph is what
    // makes those two calls agree, so the card and the cut show one time.
    const twoParagraphs = timedParagraphs({
      chapters: [
        {
          ...SPOKEN_CHAPTER,
          contentMd: `${SPOKEN_CHAPTER.contentMd}

Nobody said so.`,
        },
      ],
      takes: [SPOKEN_TAKE, { ...take('ch-c', 1, 2000), timings: heard('Nobody said so.') }],
    })
    const times = anchoredTimes(
      [
        { startMs: 0, durationMs: 6000, coversText: 'The board met on a Friday.' },
        { startMs: 6000, durationMs: 2000, coversText: 'Nobody said so.' },
      ],
      twoParagraphs,
    )
    // The first shot runs to the end of its own paragraph, not to the second
    // shot's first word; the compiler closes that seam at render time.
    expect(times[0]).toEqual({ startMs: 0, durationMs: 6000 })
    expect(times[1]).toEqual({ startMs: 6000, durationMs: 2000 })
  })

  it('leaves every slot on the planner\u2019s arithmetic when the take has no timings', () => {
    const untimed = timedParagraphs({ chapters: [SPOKEN_CHAPTER], takes: [take('ch-c', 0, 6000)] })
    const { rows } = plannedToRows({
      chapterId: 'ch-c',
      planned: [
        shot(0, 4, 'The board met on a Friday.'),
        shot(0, 2, 'Prem Akkaraju had already agreed terms.'),
      ],
      paragraphs: untimed,
      claims: [],
    })
    expect(rows.map((row) => row.startMs)).toEqual([0, 4000])
  })
})
