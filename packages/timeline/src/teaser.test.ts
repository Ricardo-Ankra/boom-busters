import { TimelineSchema, timelineDurationMs } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { compileTimeline } from './compile'
import { goldenInput } from './compile.test'
import { compileShortTimeline, SHORT_HEIGHT, SHORT_WIDTH } from './short'
import {
  compileTeaserMaster,
  masterChapterIds,
  pickTeaserSlot,
  TEASER_CHAPTER_ID,
  TEASER_GAP_MS,
  teaserShotPool,
} from './teaser'
import type { TeaserParagraphAudio } from './teaser'

/**
 * The teaser mini master (decision 225): purpose-written narration on its own
 * clock, visuals lifted from the master's already-resolved slots, and the
 * whole thing windowable by `compileShortTimeline` exactly as an excerpt
 * windows the project master.
 */

const master = compileTimeline(goldenInput())

function paragraphs(): TeaserParagraphAudio[] {
  return [
    {
      text: 'The auditors could not find the money.',
      chapterIndex: 0,
      r2Key: 'boom-busters/voice/teaser-p0.wav',
      durationMs: 4000,
      wordTimings: null,
    },
    {
      text: 'Nine days later the shares were gone.',
      chapterIndex: 1,
      r2Key: 'boom-busters/voice/teaser-p1.wav',
      durationMs: 3500,
      wordTimings: [
        { text: 'Nine', startMs: 0, endMs: 300 },
        { text: 'days', startMs: 300, endMs: 600 },
        { text: 'later', startMs: 600, endMs: 900 },
        { text: 'the', startMs: 900, endMs: 1000 },
        { text: 'shares', startMs: 1000, endMs: 1400 },
        { text: 'were', startMs: 1400, endMs: 1600 },
        { text: 'gone.', startMs: 1600, endMs: 2000 },
      ],
    },
  ]
}

describe('masterChapterIds', () => {
  it('lists chapters in narration order, once each', () => {
    const ids = masterChapterIds(master)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('pickTeaserSlot', () => {
  it('prefers motion, then a still, from the chapter it was asked about', () => {
    const [chapterOne, chapterTwo] = masterChapterIds(master)
    // Chapter one's stretch holds the golden video and still slots.
    expect(pickTeaserSlot(master, chapterOne!)?.payload.kind).toBe('video')
    // Chapter two holds only the chart and the map; neither is video or
    // image, so the first overlapping slot wins.
    const forTwo = pickTeaserSlot(master, chapterTwo!)
    expect(forTwo).toBeDefined()
    expect(['chart', 'map']).toContain(forTwo!.payload.kind)
  })
})

describe('teaserShotPool', () => {
  it('is exactly the pool the auto-pick chooses from (decision 230)', () => {
    for (const chapterId of masterChapterIds(master)) {
      const pool = teaserShotPool(master, chapterId)
      expect(pool.length).toBeGreaterThan(0)
      const picked = pickTeaserSlot(master, chapterId)
      expect(pool.some((slot) => slot === picked || slot.startMs === picked!.startMs)).toBe(true)
    }
  })

  it('falls back to the whole board for a chapter with no narration', () => {
    expect(teaserShotPool(master, '0NOSUCHCHAPTERNOSUCHCHAPTR')).toHaveLength(master.slots.length)
  })
})

describe('compileTeaserMaster', () => {
  it('an explicit chosen slot wins over the auto-pick, re-clocked to its beat', () => {
    // Beat 0 auto-picks the video; choose the chart instead (decision 230).
    const chart = master.slots.find((slot) => slot.payload.kind === 'chart')!
    const teaser = compileTeaserMaster({
      master,
      paragraphs: paragraphs(),
      chosen: [chart, null],
    })

    expect(teaser.slots[0]!.payload.kind).toBe('chart')
    // Re-clocked onto the teaser's clock, not the master's.
    expect(teaser.slots[0]!.startMs).toBe(0)
    expect(teaser.slots[0]!.durationMs).toBe(4000 + TEASER_GAP_MS)
    // The null position keeps the auto-pick.
    const auto = compileTeaserMaster({ master, paragraphs: paragraphs() })
    expect(teaser.slots[1]!.payload.kind).toBe(auto.slots[1]!.payload.kind)
  })

  it('lays the beats sequentially with a teaser gap, visuals covering each', () => {
    const teaser = compileTeaserMaster({ master, paragraphs: paragraphs() })

    expect(teaser.narration.map((segment) => segment.startMs)).toEqual([0, 4000 + TEASER_GAP_MS])
    expect(teaser.narration.every((segment) => segment.chapterId === TEASER_CHAPTER_ID)).toBe(true)
    // Each slot holds from its beat's first word until the next beat starts.
    expect(teaser.slots.map((slot) => [slot.startMs, slot.durationMs])).toEqual([
      [0, 4000 + TEASER_GAP_MS],
      [4400, 3500],
    ])
    expect(teaser.slots[0]!.payload.kind).toBe('video')
    expect(timelineDurationMs(teaser)).toBe(4000 + TEASER_GAP_MS + 3500)
  })

  it('captions every beat, aligned when the vendor said so and evenly otherwise', () => {
    const teaser = compileTeaserMaster({ master, paragraphs: paragraphs() })
    // The aligned paragraph keeps its vendor timings, shifted onto the clock.
    expect(
      teaser.captions.words.some((word) => word.text === 'Nine' && word.startMs === 4400),
    ).toBe(true)
    // The unaligned paragraph still captions — evenly spaced, never empty.
    expect(teaser.captions.words.some((word) => word.startMs < 4000)).toBe(true)
  })

  it('clamps a miscounted chapterIndex instead of failing the teaser', () => {
    const overflow = paragraphs().map((paragraph) => ({ ...paragraph, chapterIndex: 99 }))
    expect(() => compileTeaserMaster({ master, paragraphs: overflow })).not.toThrow()
  })

  it('produces a schema-valid timeline that the short compiler can window', () => {
    const teaser = compileTeaserMaster({ master, paragraphs: paragraphs() })
    expect(() => TimelineSchema.parse(teaser)).not.toThrow()

    const short = compileShortTimeline({
      master: teaser,
      segmentRef: { chapterId: TEASER_CHAPTER_ID, fromParagraph: 0, toParagraph: 1 },
      ending: 'cta',
      music: null,
    })
    expect(short.width).toBe(SHORT_WIDTH)
    expect(short.height).toBe(SHORT_HEIGHT)
    expect(short.overlays.some((overlay) => overlay.kind === 'endCta')).toBe(true)
    expect(short.narration).toHaveLength(2)
  })

  it('refuses an empty teaser', () => {
    expect(() => compileTeaserMaster({ master, paragraphs: [] })).toThrow(/needs narration/)
  })
})
