import { DEFAULT_SETTINGS, resolveBrandKit, TimelineSchema } from '@boom-busters/schemas'
import type { CropFocus, PointShotMotion, Timeline, TimelineSlot } from '@boom-busters/schemas'
import type { PointParagraphAudio, ResolvedPointShot } from './point'

/**
 * The point Short fixture: a clean case for the whole rule book (spec section
 * 4). Its numbers are chosen to sit inside every limit, so `checkShortRules`
 * must find nothing in the timeline it compiles to:
 *
 * - 140 words over five phases, voiced at 161 words a minute;
 * - 52.7 s end to end; phases end at 2.6, 13.9, 38.2, 46.6 and 52.7 s;
 * - a 5.95 s bridge;
 * - 24 shots of 1.86 to 2.38 s, every cut on a word, a punch from frame one;
 * - one video, one chart and one map among the pictures.
 *
 * Word timings are synthetic: an even 372 ms a word, which is also what makes
 * each paragraph's duration the sum of its words.
 */

const WORD_MS = 372

const PARAGRAPHS: ReadonlyArray<{
  phase: PointParagraphAudio['phase']
  text: string
}> = [
  { phase: 'hook', text: 'The auditors could not find the money.' },
  {
    phase: 'stakes',
    text:
      'One point nine billion euros was supposed to sit in two Philippine bank accounts. ' +
      'If it was missing, every investor in a company worth twenty billion euros held a promise.',
  },
  {
    phase: 'delivery',
    text:
      'So the auditors asked the banks directly. The banks said the accounts never existed. ' +
      'But the company had a trustee, and the trustee had documents. ' +
      'Then the documents turned out to be forged. Nobody noticed at first. ' +
      'The trustee had never held the money, and nobody could show where it went. ' +
      'Then the shares fell ninety percent in nine days, and regulators opened a case.',
  },
  {
    phase: 'resolution',
    text:
      'Where did the money go? Nowhere, because it was never there. ' +
      'The balance sheet had been invented, line by line, for years.',
  },
  {
    phase: 'bridge',
    text: 'Tap the video linked below for the full story, and the people who signed it off.',
  },
]

/** The master the Short borrows its brand, clock rate and caption style from. */
function fixtureMaster(): Timeline {
  const brand = resolveBrandKit(DEFAULT_SETTINGS)
  return TimelineSchema.parse({
    version: 1,
    fps: 30,
    width: 1920,
    height: 1080,
    brand,
    narration: [
      {
        r2Key: 'boom-busters/voice/master-p0.wav',
        startMs: 0,
        durationMs: 4000,
        chapterId: '01HQ0000000000000000000CH1',
        paragraphIndex: 0,
      },
    ],
    music: null,
    captions: { style: 'karaoke', words: [] },
    slots: [
      {
        type: 'still',
        startMs: 0,
        durationMs: 4000,
        transition: 'cut',
        motion: { kind: 'static' },
        payload: { kind: 'image', src: { r2Key: 'boom-busters/stills/master/0.png' } },
      },
    ],
    overlays: [],
  })
}

function paragraphs(): PointParagraphAudio[] {
  return PARAGRAPHS.map((paragraph, index) => {
    const words = paragraph.text.split(/\s+/)
    return {
      text: paragraph.text,
      phase: paragraph.phase,
      r2Key: `boom-busters/voice/point-p${index}.wav`,
      durationMs: words.length * WORD_MS,
      wordTimings: words.map((text, at) => ({
        text,
        startMs: at * WORD_MS,
        endMs: at * WORD_MS + 330,
      })),
    }
  })
}

const IMAGE_PAYLOAD = (key: string) =>
  ({
    kind: 'image',
    src: { r2Key: `boom-busters/stills/point/${key}.png` },
    width: 1344,
    height: 768,
  }) as const

function still(key: string): TimelineSlot {
  return {
    type: 'still',
    startMs: 0,
    durationMs: 1,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: IMAGE_PAYLOAD(key),
  }
}

function archival(key: string): TimelineSlot {
  return { ...still(key), type: 'archival' }
}

function video(key: string): TimelineSlot {
  return {
    type: 'stock',
    startMs: 0,
    durationMs: 1,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: {
      kind: 'video',
      src: { externalUrl: `https://cdn.example.com/${key}.mp4` },
      muted: true,
    },
  }
}

function chart(): TimelineSlot {
  return {
    type: 'chart',
    startMs: 0,
    durationMs: 1,
    transition: 'cut',
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
      dataRefs: ['01HQ00000000000000000000AA'],
      takeaway: 'The nine-day collapse.',
      reveal: 'draw-on',
    },
  }
}

function map(): TimelineSlot {
  return {
    type: 'map',
    startMs: 0,
    durationMs: 1,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: {
      kind: 'map',
      locations: [
        { label: 'Munich', lat: 48.14, lon: 11.58 },
        { label: 'Manila', lat: 14.6, lon: 120.98 },
      ],
      route: true,
    },
  }
}

/** Words per shot: four 5s among twenty 6s, 140 in all. */
const SHOT_WORDS = [5, 6, 6, 6, 5, 6, 6, 6, 6, 5, 6, 6, 6, 6, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6]

const SHOT_SLOTS: TimelineSlot[] = [
  still('hook'),
  video('office'),
  archival('bank'),
  still('ledger'),
  map(),
  still('auditor'),
  video('server-room'),
  archival('trustee'),
  still('contract'),
  still('stamp'),
  archival('letter'),
  chart(),
  still('shares'),
  still('regulator'),
  archival('filing'),
  still('boardroom'),
  video('street'),
  still('balance'),
  archival('invoice'),
  still('empty-vault'),
  still('ledger-two'),
  still('signature'),
  archival('headline-clipping'),
  still('closing'),
]

const SHOT_CROPS: CropFocus[] = ['centre', 'left', 'right']

/** Index 0 punches from frame one; every other picture gets a Ken Burns move. */
function shotMotion(index: number): PointShotMotion {
  if (index === 0 || index === 12) return 'punch'
  return index % 2 === 0 ? 'kenburns-in' : 'kenburns-out'
}

function shots(): ResolvedPointShot[] {
  let startWord = 0
  return SHOT_WORDS.map((length, index) => {
    const shot: ResolvedPointShot = {
      startWord,
      slot: SHOT_SLOTS[index]!,
      crop: SHOT_CROPS[index % SHOT_CROPS.length]!,
      motion: shotMotion(index),
    }
    startWord += length
    return shot
  })
}

/** Everything `compileShortMaster` takes, rebuilt fresh on each call. */
export function pointFixtureInput() {
  return {
    master: fixtureMaster(),
    paragraphs: paragraphs(),
    shots: shots(),
    bridge: {
      label: 'Watch the full story',
      channelName: 'Boom & Busters',
      handle: '@boombusters',
    },
  }
}
