import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { timelineDurationMs } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { compileTimeline } from './compile'
import { goldenInput } from './compile.test'
import {
  compileShortTimeline,
  DEFAULT_CTA_TEXT,
  END_CTA_MS,
  SHORT_HEIGHT,
  SHORT_MAX_DURATION_MS,
  SHORT_WIDTH,
} from './short'

const CHAPTER_ONE = '01HQ0000000000000000000CH1'
const CHAPTER_TWO = '01HQ0000000000000000000CH2'

/** The master the golden fixture project compiles to — the Short's input. */
function goldenMaster(): Timeline {
  return compileTimeline(goldenInput())
}

function chapterOneShort() {
  return compileShortTimeline({
    master: goldenMaster(),
    segmentRef: { chapterId: CHAPTER_ONE, fromParagraph: 0, toParagraph: 1 },
    ending: 'cta',
    music: { r2Key: 'boom-busters/music/shorts-pulse-01.mp3' },
  })
}

const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'short-timeline.json')

describe('compileShortTimeline', () => {
  it('matches the committed golden byte for byte', () => {
    const compiled = JSON.stringify(chapterOneShort(), null, 2) + '\n'
    if (process.env['REGEN_GOLDEN'] === '1') {
      writeFileSync(GOLDEN_PATH, compiled)
    }
    // If this fails after an intentional compiler change, regenerate with
    // REGEN_GOLDEN=1 and review the golden's diff — the diff IS the review.
    expect(compiled).toBe(readFileSync(GOLDEN_PATH, 'utf8'))
  })

  it('is a 1080×1920 canvas holding the segment, re-clocked to zero', () => {
    const short = chapterOneShort()
    expect(short.width).toBe(SHORT_WIDTH)
    expect(short.height).toBe(SHORT_HEIGHT)
    // Chapter one is paragraphs at 0..8000 and 8000..14000 on the master.
    expect(short.narration.map((segment) => segment.startMs)).toEqual([0, 8000])
    expect(timelineDurationMs(short)).toBe(14_000)
    // Slots inside the window survive whole; later chapters' slots are gone.
    expect(short.slots.map((slot) => [slot.startMs, slot.durationMs])).toEqual([
      [0, 8000],
      [8000, 6000],
    ])
  })

  it('re-clocks captions with the window and keeps their text untouched', () => {
    const master = goldenMaster()
    const short = compileShortTimeline({
      master,
      segmentRef: { chapterId: CHAPTER_ONE, fromParagraph: 1, toParagraph: 1 },
      ending: 'loop',
      music: null,
    })
    // Paragraph 1 spans 8000..14000 on the master clock.
    const masterWords = master.captions.words.filter(
      (word) => word.startMs >= 8000 && word.startMs < 14_000,
    )
    expect(short.captions.words.map((word) => word.text)).toEqual(
      masterWords.map((word) => word.text),
    )
    expect(short.captions.words.map((word) => word.startMs)).toEqual(
      masterWords.map((word) => word.startMs - 8000),
    )
    expect(short.captions.words[0]!.startMs).toBeGreaterThanOrEqual(0)
  })

  it('clips a straddling slot and trims a clipped video into its source', () => {
    const master = goldenMaster()
    // Chapter two starts at 14000; the chart slot (14000..18000) is inside,
    // and we stretch the opening video slot to straddle the boundary.
    const stretched = JSON.parse(JSON.stringify(master)) as Timeline
    stretched.slots[0]!.durationMs = 16_000 // video now runs 0..16000
    const short = compileShortTimeline({
      master: stretched,
      segmentRef: { chapterId: CHAPTER_TWO, fromParagraph: 0, toParagraph: 0 },
      ending: 'loop',
      music: null,
    })
    const video = short.slots[0]!
    expect(video.startMs).toBe(0)
    expect(video.durationMs).toBe(2000) // 14000..16000 clipped to the window
    expect(video.payload.kind).toBe('video')
    if (video.payload.kind === 'video') {
      expect(video.payload.trimStartMs).toBe(14_000) // skips what already played
    }
  })

  it('adds the endCta overlay for a cta ending and nothing for a loop', () => {
    const short = chapterOneShort()
    expect(short.overlays).toEqual([
      {
        kind: 'endCta',
        startMs: 14_000 - END_CTA_MS,
        durationMs: END_CTA_MS,
        props: { text: DEFAULT_CTA_TEXT },
      },
    ])

    const loop = compileShortTimeline({
      master: goldenMaster(),
      segmentRef: { chapterId: CHAPTER_ONE, fromParagraph: 0, toParagraph: 1 },
      ending: 'loop',
      music: null,
    })
    expect(loop.overlays).toEqual([])
  })

  it('rebuilds the ducking curve for the sliced narration with brand gains', () => {
    const short = chapterOneShort()
    expect(short.music?.r2Key).toBe('boom-busters/music/shorts-pulse-01.mp3')
    expect(short.music?.gainDb).toBe(short.brand.music.bedGainDb)
    // Narration starts at 0, so the bed opens already ducked.
    expect(short.music?.duckingCurve[0]).toEqual({
      tMs: 0,
      gainDb: short.brand.music.bedGainDb + short.brand.music.duckDepthDb,
    })
  })

  it('refuses a segment longer than the Shorts limit', () => {
    const master = goldenMaster()
    const bloated = JSON.parse(JSON.stringify(master)) as Timeline
    bloated.narration[0]!.durationMs = SHORT_MAX_DURATION_MS + 1000
    expect(() =>
      compileShortTimeline({
        master: bloated,
        segmentRef: { chapterId: CHAPTER_ONE, fromParagraph: 0, toParagraph: 0 },
        ending: 'loop',
        music: null,
      }),
    ).toThrow(/Shorts limit/)
  })

  it('refuses a segment the master narration does not fully contain', () => {
    expect(() =>
      compileShortTimeline({
        master: goldenMaster(),
        segmentRef: { chapterId: CHAPTER_ONE, fromParagraph: 0, toParagraph: 5 },
        ending: 'loop',
        music: null,
      }),
    ).toThrow(/2 of the 6/)
  })

  it('refuses an inverted paragraph range', () => {
    expect(() =>
      compileShortTimeline({
        master: goldenMaster(),
        segmentRef: { chapterId: CHAPTER_ONE, fromParagraph: 1, toParagraph: 0 },
        ending: 'loop',
        music: null,
      }),
    ).toThrow(/inverted/)
  })

  it('refuses a materialised master — slice the canonical form only', () => {
    const master = goldenMaster()
    const leaked = JSON.parse(JSON.stringify(master)) as Timeline
    leaked.narration[0]!.url = 'https://r2.example.com/presigned?sig=abc'
    expect(() =>
      compileShortTimeline({
        master: leaked,
        segmentRef: { chapterId: CHAPTER_ONE, fromParagraph: 0, toParagraph: 1 },
        ending: 'loop',
        music: null,
      }),
    ).toThrow(/materialised URLs/)
  })
})
