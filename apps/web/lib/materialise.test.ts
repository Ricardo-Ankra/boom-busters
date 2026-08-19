import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Timeline } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { materialiseForPreview } from './materialise'

const CHAPTER = '01HQ0000000000000000000CH1'
const TAKE = '01HQ0000000000000000000TK1'

function canonical(overrides: Partial<Timeline> = {}): Timeline {
  return {
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand: resolveBrandKit(DEFAULT_SETTINGS),
    narration: [
      {
        r2Key: `mock://voice/${TAKE}.wav`,
        startMs: 0,
        durationMs: 8000,
        chapterId: CHAPTER,
        paragraphIndex: 0,
      },
    ],
    music: null,
    captions: { words: [], style: 'karaoke' },
    slots: [
      {
        type: 'stock',
        startMs: 0,
        durationMs: 4000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: {
          kind: 'video',
          src: { externalUrl: 'https://cdn.example.com/clip.mp4' },
          muted: true,
        },
      },
      {
        type: 'still',
        startMs: 4000,
        durationMs: 4000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/a.png' } },
      },
    ],
    overlays: [],
    ...overrides,
  }
}

const ORIGIN = 'http://localhost:3000'

describe('materialiseForPreview', () => {
  it('routes mock narration to the voice-audio route and presigns real keys', async () => {
    const result = await materialiseForPreview(canonical(), {
      origin: ORIGIN,
      presign: (key) => Promise.resolve(`https://r2.example.com/${key}?sig=x`),
    })
    expect(result.timeline.narration[0]?.url).toBe(`${ORIGIN}/api/voice-takes/${TAKE}/audio`)
    expect(result.timeline.slots[1]?.payload).toMatchObject({
      src: { url: 'https://r2.example.com/boom-busters/stills/a.png?sig=x' },
    })
    expect(result.dropped).toEqual({ narration: 0, slots: 0, music: false })
  })

  it('passes stable external URLs through and leaves chart/map slots alone', async () => {
    const chartSlot: Timeline['slots'][number] = {
      type: 'chart',
      startMs: 0,
      durationMs: 4000,
      transition: 'cut',
      motion: { kind: 'draw-on' },
      payload: {
        kind: 'chart',
        chartKind: 'line',
        series: [
          {
            label: 'x',
            unit: '€',
            points: [
              { x: 'A', y: 1 },
              { x: 'B', y: 2 },
            ],
          },
        ],
        dataRefs: ['01HQ00000000000000000000AA'],
        takeaway: 'Up.',
        reveal: 'draw-on',
      },
    }
    const result = await materialiseForPreview(
      canonical({ slots: [canonical().slots[0]!, chartSlot] }),
      { origin: ORIGIN, presign: null },
    )
    expect(result.timeline.slots[0]?.payload).toMatchObject({
      src: { url: 'https://cdn.example.com/clip.mp4' },
    })
    expect(result.timeline.slots[1]?.payload.kind).toBe('chart')
    expect(result.dropped.slots).toBe(0)
  })

  it('drops what it cannot resolve and counts it — the player must still mount', async () => {
    const result = await materialiseForPreview(
      canonical({
        narration: [
          {
            r2Key: 'boom-busters/voice/real.wav',
            startMs: 0,
            durationMs: 8000,
            chapterId: CHAPTER,
            paragraphIndex: 0,
          },
        ],
        music: {
          r2Key: 'boom-busters/music/bed.mp3',
          gainDb: -25,
          duckingCurve: [{ tMs: 0, gainDb: -25 }],
          cuePoints: [],
        },
      }),
      // R2 not configured: nothing real is resolvable.
      { origin: ORIGIN, presign: null },
    )
    expect(result.timeline.narration).toEqual([])
    expect(result.timeline.music).toBeNull()
    expect(result.timeline.slots).toHaveLength(1) // the external-URL clip survives
    expect(result.dropped).toEqual({ narration: 1, slots: 1, music: true })
  })

  it('never mutates the canonical timeline', async () => {
    const original = canonical()
    const before = JSON.stringify(original)
    await materialiseForPreview(original, { origin: ORIGIN, presign: null })
    expect(JSON.stringify(original)).toBe(before)
  })
})
