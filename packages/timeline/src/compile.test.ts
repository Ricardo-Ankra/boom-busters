import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, resolveBrandKit, timelineDurationMs } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { compileTimeline, KENBURNS_INTENSITY, resolveMotion } from './compile'
import type { CompileInput, CompileSlot } from './compile'
import { offsetCaptions, snapToScript } from './snap'

const CHAPTER_ONE = '01HQ0000000000000000000CH1'
const CHAPTER_TWO = '01HQ0000000000000000000CH2'
const CLAIM = '01HQ00000000000000000000AA'

/**
 * The golden fixture: a two-chapter miniature of a real project, with every
 * slot family represented. Everything in it is deterministic, so the compiled
 * timeline must be byte-identical run to run — that byte-stability IS the
 * test (spec section 13: "fixture project → byte-stable JSON").
 */
export function goldenInput(): CompileInput {
  const brand = resolveBrandKit(DEFAULT_SETTINGS)

  const paragraphs = [
    {
      chapterId: CHAPTER_ONE,
      chapterIndex: 0,
      chapterTitle: 'The audit',
      paragraphIndex: 0,
      r2Key: 'boom-busters/voice/ch1-p0.wav',
      durationMs: 8000,
      text: 'By June, the auditors could not find the money.',
      heard: ['by', 'june', 'the', 'auditors', 'could', 'not', 'find', 'the', 'money'],
    },
    {
      chapterId: CHAPTER_ONE,
      chapterIndex: 0,
      chapterTitle: 'The audit',
      paragraphIndex: 1,
      r2Key: 'boom-busters/voice/ch1-p1.wav',
      durationMs: 6000,
      text: 'EY refused to sign the accounts.',
      heard: ['ey', 'refused', 'to', 'sign', 'the', 'accounts'],
    },
    {
      chapterId: CHAPTER_TWO,
      chapterIndex: 1,
      chapterTitle: 'The collapse',
      paragraphIndex: 0,
      r2Key: 'boom-busters/voice/ch2-p0.wav',
      durationMs: 7000,
      text: 'The shares collapsed in nine days.',
      heard: ['the', 'shares', 'collapsed', 'in', 'nine', 'days'],
    },
  ]

  // Captions the way assembly builds them: per-paragraph snap, shifted onto
  // the project clock by the narration layout the compiler will recreate.
  let clock = 0
  const words = paragraphs.flatMap((paragraph) => {
    const heard = paragraph.heard.map((text, index) => ({
      text,
      startMs: index * 400,
      endMs: index * 400 + 350,
    }))
    const snapped = offsetCaptions(snapToScript(paragraph.text, heard).captions, clock)
    clock += paragraph.durationMs
    return snapped
  })

  const slots: CompileSlot[] = [
    {
      type: 'stock',
      startMs: 0,
      durationMs: 8000,
      transition: 'cut',
      motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
      media: { kind: 'video', externalUrl: 'https://cdn.example.com/office.mp4' },
    },
    {
      type: 'still',
      startMs: 8000,
      durationMs: 6000,
      transition: 'dissolve',
      motion: { kind: 'pan', path: 'across the trading floor' },
      media: {
        kind: 'image',
        r2Key: 'boom-busters/stills/p1/abc123.png',
        width: 1344,
        height: 768,
      },
    },
    {
      type: 'chart',
      startMs: 14_000,
      durationMs: 4000,
      transition: 'cut',
      motion: { kind: 'static' },
      chart: {
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
        dataRefs: [CLAIM],
        takeaway: 'The nine-day collapse.',
        reveal: 'draw-on',
      },
    },
    {
      type: 'map',
      startMs: 18_000,
      durationMs: 3000,
      transition: 'dissolve',
      motion: { kind: 'static' },
      map: {
        locations: [
          { label: 'Munich', lat: 48.14, lon: 11.58 },
          { label: 'Manila', lat: 14.6, lon: 120.98 },
        ],
        route: true,
      },
    },
  ]

  return {
    brand,
    paragraphs: paragraphs.map(({ text, heard, ...paragraph }) => {
      void text
      void heard
      return paragraph
    }),
    slots,
    music: { r2Key: 'boom-busters/music/documentary-tension-01.mp3' },
    captions: { words, style: 'karaoke' },
  }
}

const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'master-timeline.json')

describe('compileTimeline', () => {
  it('matches the committed golden byte for byte', () => {
    const compiled = JSON.stringify(compileTimeline(goldenInput()), null, 2) + '\n'
    if (process.env['REGEN_GOLDEN'] === '1') {
      writeFileSync(GOLDEN_PATH, compiled)
    }
    // If this fails after an intentional compiler change, regenerate with
    // REGEN_GOLDEN=1 and review the golden's diff — the diff IS the review.
    expect(compiled).toBe(readFileSync(GOLDEN_PATH, 'utf8'))
  })

  it('lays narration end to end on the same clock the board was planned on', () => {
    const timeline = compileTimeline(goldenInput())
    expect(timeline.narration.map((segment) => segment.startMs)).toEqual([0, 8000, 14_000])
    expect(timelineDurationMs(timeline)).toBe(21_000)
  })

  it('opens a chapter card at each chapter start and cues the music there', () => {
    const timeline = compileTimeline(goldenInput())
    expect(timeline.overlays.map((overlay) => overlay.startMs)).toEqual([0, 14_000])
    expect(timeline.music?.cuePoints.map((cue) => cue.tMs)).toEqual([0, 14_000])
  })

  it('ducks the music with the Brand Kit gains', () => {
    const timeline = compileTimeline(goldenInput())
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    expect(timeline.music?.gainDb).toBe(brand.music.bedGainDb)
    expect(timeline.music?.duckingCurve[0]?.gainDb).toBe(
      brand.music.bedGainDb + brand.music.duckDepthDb,
    )
  })

  it('refuses a media slot with nothing to show — placeholders stop upstream', () => {
    const input = goldenInput()
    delete input.slots[0]!.media
    expect(() => compileTimeline(input)).toThrow(/placeholders must be excluded/)
  })

  it('refuses an empty narration list', () => {
    const input = goldenInput()
    input.paragraphs = []
    expect(() => compileTimeline(input)).toThrow(/needs narration/)
  })
})

describe('resolveMotion', () => {
  const still: CompileSlot = {
    type: 'still',
    startMs: 0,
    durationMs: 4000,
    transition: 'cut',
    motion: { kind: 'static' },
    media: { kind: 'image', r2Key: 'boom-busters/stills/x.png' },
  }

  it('maps board speeds onto scale intensities', () => {
    expect(resolveMotion({ kind: 'kenburns', direction: 'out', speed: 'fast' }, still)).toEqual({
      kind: 'kenburns',
      direction: 'out',
      intensity: KENBURNS_INTENSITY.fast,
    })
  })

  it('turns a worded pan into a medium push-in rather than a frozen frame', () => {
    expect(resolveMotion({ kind: 'pan', path: 'left to right' }, still)).toEqual({
      kind: 'kenburns',
      direction: 'in',
      intensity: KENBURNS_INTENSITY.medium,
    })
  })

  it('lets a draw-on chart reveal own the slot motion', () => {
    const chart: CompileSlot = {
      ...still,
      type: 'chart',
      chart: {
        chartKind: 'bar',
        series: [
          {
            label: 'x',
            unit: 'GBP',
            points: [
              { x: 'a', y: 1 },
              { x: 'b', y: 2 },
            ],
          },
        ],
        dataRefs: [CLAIM],
        takeaway: 'x',
        reveal: 'draw-on',
      },
    }
    expect(resolveMotion({ kind: 'static' }, chart)).toEqual({ kind: 'draw-on' })
  })
})
