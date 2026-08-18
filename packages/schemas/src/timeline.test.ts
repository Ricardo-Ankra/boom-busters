import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, resolveBrandKit } from './settings'
import {
  canonicalTimelineIssues,
  gainAt,
  TIMELINE_VERSION,
  timelineDurationMs,
  TimelineSchema,
  TimelineSlotSchema,
} from './timeline'
import type { Timeline } from './timeline'

const CHAPTER = '01HQ0000000000000000000CH1'
const CLAIM = '01HQ00000000000000000000AA'

const brand = resolveBrandKit(DEFAULT_SETTINGS)

function fixtureTimeline(): Timeline {
  return TimelineSchema.parse({
    version: TIMELINE_VERSION,
    fps: 30,
    width: 1920,
    height: 1080,
    brand,
    narration: [
      {
        r2Key: 'boom-busters/voice/p0.wav',
        startMs: 0,
        durationMs: 8000,
        chapterId: CHAPTER,
        paragraphIndex: 0,
      },
      {
        r2Key: 'boom-busters/voice/p1.wav',
        startMs: 8000,
        durationMs: 6000,
        chapterId: CHAPTER,
        paragraphIndex: 1,
      },
    ],
    music: {
      r2Key: 'boom-busters/music/bed.mp3',
      gainDb: -25,
      duckingCurve: [
        { tMs: 0, gainDb: -25 },
        { tMs: 500, gainDb: -37 },
      ],
      cuePoints: [{ tMs: 0, style: 'chapter' }],
    },
    captions: {
      words: [
        { text: 'By', startMs: 0, endMs: 180, timestampMs: 90, confidence: null },
        { text: 'June,', startMs: 180, endMs: 520, timestampMs: 350, confidence: null },
      ],
      style: 'karaoke',
    },
    slots: [
      {
        type: 'stock',
        startMs: 0,
        durationMs: 8000,
        transition: 'cut',
        motion: { kind: 'kenburns', direction: 'in', intensity: 0.08 },
        payload: { kind: 'image', src: { externalUrl: 'https://images.pexels.com/a1.jpg' } },
      },
      {
        type: 'chart',
        startMs: 8000,
        durationMs: 6000,
        transition: 'dissolve',
        motion: { kind: 'draw-on' },
        payload: {
          kind: 'chart',
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
    ],
    overlays: [
      {
        kind: 'chapterCard',
        startMs: 0,
        durationMs: 2000,
        props: { index: 1, title: 'The audit' },
      },
    ],
  })
}

describe('TimelineSchema', () => {
  it('accepts the full fixture, and it round-trips byte-stable', () => {
    const timeline = fixtureTimeline()
    // The golden-test property M6.2 depends on: parse(serialise(x)) is
    // byte-identical, so compiled timelines can be compared as strings.
    expect(JSON.stringify(TimelineSchema.parse(JSON.parse(JSON.stringify(timeline))))).toBe(
      JSON.stringify(timeline),
    )
  })

  it('pins the version — an unknown version must be rejected, never guessed at', () => {
    const raw = { ...fixtureTimeline(), version: 2 }
    expect(TimelineSchema.safeParse(raw).success).toBe(false)
  })

  it('rejects a slot whose payload contradicts its type', () => {
    const result = TimelineSlotSchema.safeParse({
      type: 'chart',
      startMs: 0,
      durationMs: 4000,
      transition: 'cut',
      motion: { kind: 'static' },
      payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/x.png' } },
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('cannot carry')
    }
  })

  it('rejects a media reference with neither key nor stable URL', () => {
    const result = TimelineSlotSchema.safeParse({
      type: 'still',
      startMs: 0,
      durationMs: 4000,
      transition: 'cut',
      motion: { kind: 'static' },
      payload: { kind: 'image', src: {} },
    })
    expect(result.success).toBe(false)
  })

  it('requires video payloads to be muted — narration and music own the mix', () => {
    const result = TimelineSlotSchema.safeParse({
      type: 'stock',
      startMs: 0,
      durationMs: 4000,
      transition: 'cut',
      motion: { kind: 'static' },
      payload: {
        kind: 'video',
        src: { externalUrl: 'https://cdn.example.com/b.mp4' },
        muted: false,
      },
    })
    expect(result.success).toBe(false)
  })

  it('keeps chart payloads on the anti-slop leash: claim refs required', () => {
    const timeline = fixtureTimeline()
    const chart = timeline.slots[1]!
    const raw = JSON.parse(JSON.stringify(chart)) as { payload: { dataRefs: string[] } }
    raw.payload.dataRefs = []
    expect(TimelineSlotSchema.safeParse(raw).success).toBe(false)
  })
})

describe('timelineDurationMs', () => {
  it('is the furthest end among narration and slots', () => {
    expect(timelineDurationMs(fixtureTimeline())).toBe(14000)
  })
})

describe('gainAt', () => {
  it('interpolates the ducking curve piecewise-linearly, clamped at the ends', () => {
    const curve = [
      { tMs: 1000, gainDb: -25 },
      { tMs: 2000, gainDb: -37 },
    ]
    expect(gainAt(curve, 0)).toBe(-25)
    expect(gainAt(curve, 1500)).toBeCloseTo(-31)
    expect(gainAt(curve, 9000)).toBe(-37)
    expect(gainAt([], 500)).toBe(0)
  })
})

describe('canonicalTimelineIssues', () => {
  it('passes a keys-only timeline and names any materialised URL', () => {
    const timeline = fixtureTimeline()
    expect(canonicalTimelineIssues(timeline)).toEqual([])

    const leaked = JSON.parse(JSON.stringify(timeline)) as Timeline
    const payload = leaked.slots[0]!.payload
    if (payload.kind === 'image') payload.src.url = 'https://r2.example.com/presigned?sig=abc'
    expect(canonicalTimelineIssues(TimelineSchema.parse(leaked))).toEqual([
      'slots.0.payload.src.url',
    ])
  })

  it('names materialised narration and music URLs too', () => {
    const leaked = JSON.parse(JSON.stringify(fixtureTimeline())) as Timeline
    leaked.narration[0]!.url = 'https://r2.example.com/presigned?sig=abc'
    if (leaked.music) leaked.music.url = 'https://r2.example.com/presigned?sig=def'
    const issues = canonicalTimelineIssues(TimelineSchema.parse(leaked))
    expect(issues).toContain('narration.0.url')
    if (leaked.music) expect(issues).toContain('music.url')
  })
})
