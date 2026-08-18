import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { Caption, MapLocation, Timeline } from '@boom-busters/schemas'
import { FIXTURE_AUDIO_SILENCE, FIXTURE_IMAGE_HARBOUR, FIXTURE_IMAGE_SKYLINE } from './media'

/**
 * The fixture timeline: a 14-second Wirecard-flavoured miniature exercising
 * every slot kind, every overlay kind, captions and a ducked music bed.
 * It is a MATERIALISED copy — data-URI media, so Studio and snapshot tests
 * run with no network and no storage. `fixtures.test.ts` proves it parses
 * against TimelineSchema and that the canonical guard (correctly) flags its
 * materialised URLs.
 */

export const FIXTURE_BRAND = resolveBrandKit(DEFAULT_SETTINGS)

const CHAPTER = '01HQ0000000000000000000CH1'
const CLAIM = '01HQ00000000000000000000AA'

/** Munich → Singapore → Manila: where the escrow money was supposed to be. */
export const FIXTURE_MAP_LOCATIONS: MapLocation[] = [
  { label: 'Munich', lat: 48.14, lon: 11.58 },
  { label: 'Singapore', lat: 1.35, lon: 103.82 },
  { label: 'Manila', lat: 14.6, lon: 120.98 },
]

export const FIXTURE_CAPTION_WORDS: Caption[] = [
  { text: 'By', startMs: 400, endMs: 560, timestampMs: 480, confidence: null },
  { text: 'June,', startMs: 560, endMs: 980, timestampMs: 770, confidence: null },
  { text: 'the', startMs: 1050, endMs: 1180, timestampMs: 1110, confidence: null },
  { text: 'auditors', startMs: 1180, endMs: 1750, timestampMs: 1460, confidence: null },
  { text: 'admitted', startMs: 1750, endMs: 2280, timestampMs: 2010, confidence: null },
  { text: 'the', startMs: 2350, endMs: 2470, timestampMs: 2410, confidence: null },
  { text: 'money', startMs: 2470, endMs: 2900, timestampMs: 2680, confidence: null },
  { text: 'never', startMs: 2900, endMs: 3340, timestampMs: 3120, confidence: null },
  { text: 'existed.', startMs: 3340, endMs: 3960, timestampMs: 3650, confidence: null },
  { text: '€1.9', startMs: 5200, endMs: 5780, timestampMs: 5490, confidence: null },
  { text: 'billion', startMs: 5780, endMs: 6240, timestampMs: 6010, confidence: null },
  { text: 'of', startMs: 6310, endMs: 6430, timestampMs: 6370, confidence: null },
  { text: 'it,', startMs: 6430, endMs: 6720, timestampMs: 6570, confidence: null },
  { text: 'gone.', startMs: 6900, endMs: 7450, timestampMs: 7170, confidence: null },
]

export const FIXTURE_TIMELINE: Timeline = {
  version: 1,
  fps: 30,
  width: 1920,
  height: 1080,
  brand: FIXTURE_BRAND,
  narration: [
    {
      r2Key: 'boom-busters/voice/fixture-p0.wav',
      url: FIXTURE_AUDIO_SILENCE,
      startMs: 0,
      durationMs: 8000,
      chapterId: CHAPTER,
      paragraphIndex: 0,
    },
    {
      r2Key: 'boom-busters/voice/fixture-p1.wav',
      url: FIXTURE_AUDIO_SILENCE,
      startMs: 8000,
      durationMs: 6000,
      chapterId: CHAPTER,
      paragraphIndex: 1,
    },
  ],
  music: {
    r2Key: 'boom-busters/music/fixture-bed.wav',
    url: FIXTURE_AUDIO_SILENCE,
    gainDb: -25,
    duckingCurve: [
      { tMs: 0, gainDb: -25 },
      { tMs: 200, gainDb: -37 },
      { tMs: 7800, gainDb: -37 },
      { tMs: 8400, gainDb: -25 },
      { tMs: 9600, gainDb: -25 },
      { tMs: 9800, gainDb: -37 },
    ],
    cuePoints: [{ tMs: 0, style: 'chapter' }],
  },
  captions: { words: FIXTURE_CAPTION_WORDS, style: 'karaoke' },
  slots: [
    {
      type: 'still',
      startMs: 0,
      durationMs: 5000,
      transition: 'cut',
      motion: { kind: 'kenburns', direction: 'in', intensity: 0.1 },
      payload: {
        kind: 'image',
        src: { r2Key: 'boom-busters/stills/fixture-skyline.png', url: FIXTURE_IMAGE_SKYLINE },
      },
    },
    {
      type: 'chart',
      startMs: 5000,
      durationMs: 4500,
      transition: 'dissolve',
      motion: { kind: 'draw-on' },
      payload: {
        kind: 'chart',
        chartKind: 'line',
        series: [
          {
            label: 'Share price',
            unit: '€',
            points: [
              { x: 'Jun 17', y: 104.5 },
              { x: 'Jun 18', y: 39.9 },
              { x: 'Jun 19', y: 25.8 },
              { x: 'Jun 22', y: 14.4 },
              { x: 'Jun 25', y: 3.3 },
              { x: 'Jun 26', y: 1.28 },
            ],
          },
        ],
        dataRefs: [CLAIM],
        takeaway: 'Nine days. Ninety-nine percent gone.',
        annotations: [{ atX: 'Jun 25', text: 'Insolvency filed' }],
        reveal: 'draw-on',
      },
    },
    {
      type: 'map',
      startMs: 9500,
      durationMs: 4500,
      transition: 'cut',
      motion: { kind: 'static' },
      payload: { kind: 'map', locations: FIXTURE_MAP_LOCATIONS, route: true },
    },
  ],
  overlays: [
    {
      kind: 'chapterCard',
      startMs: 0,
      durationMs: 2600,
      props: { index: 1, title: 'The audit that lied' },
    },
    {
      kind: 'lowerThird',
      startMs: 5200,
      durationMs: 3800,
      props: { title: 'Markus Braun', subtitle: 'CEO, Wirecard' },
    },
    { kind: 'watermark', startMs: 0, durationMs: 14000, props: {} },
  ],
}

/** A second still, so Studio has both fixture images on show. */
export const FIXTURE_IMAGE_ALT = FIXTURE_IMAGE_HARBOUR
