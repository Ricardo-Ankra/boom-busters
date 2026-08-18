import { describe, expect, it } from 'vitest'
import type { VoiceTakeRow } from '@boom-busters/db'
import {
  assembleCaptions,
  evenlySpacedWords,
  narrationPlan,
  pickMusicBed,
  slotPlan,
  timelineKey,
} from './assembly'
import type { AssemblySlotRow } from './assembly'

const CHAPTER_A = '01HQ0000000000000000000CH1'
const CHAPTER_B = '01HQ0000000000000000000CH2'

function take(overrides: Partial<VoiceTakeRow>): VoiceTakeRow {
  return {
    id: 'take-1',
    projectId: 'p1',
    chapterId: CHAPTER_A,
    paragraphIndex: 0,
    provider: 'elevenlabs',
    voiceId: 'v1',
    r2Key: 'boom-busters/voice/a0.wav',
    durationMs: 8000,
    status: 'approved',
    takeNumber: 1,
    costUsd: '0.10',
    note: null,
    idempotencyKey: 'k1',
    timings: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as VoiceTakeRow
}

describe('narrationPlan', () => {
  const chapters = [
    { id: CHAPTER_A, title: 'The audit', contentMd: 'First paragraph.\n\nSecond paragraph.' },
  ]

  it('lays script paragraphs against their CURRENT takes, in order', () => {
    const plan = narrationPlan({
      chapters,
      takes: [
        take({ id: 'a', paragraphIndex: 0, takeNumber: 1 }),
        take({ id: 'b', paragraphIndex: 0, takeNumber: 2, r2Key: 'boom-busters/voice/a0b.wav' }),
        take({ id: 'c', paragraphIndex: 1, durationMs: 6000 }),
      ],
    })
    expect(plan.missing).toEqual([])
    expect(plan.paragraphs).toHaveLength(2)
    // Take b superseded take a.
    expect(plan.paragraphs[0]!.r2Key).toBe('boom-busters/voice/a0b.wav')
    expect(plan.paragraphs[0]!.text).toBe('First paragraph.')
    expect(plan.paragraphs[1]!.durationMs).toBe(6000)
  })

  it('reports paragraphs with no usable take instead of compiling silence', () => {
    const plan = narrationPlan({
      chapters,
      takes: [take({ paragraphIndex: 0 })],
    })
    expect(plan.paragraphs).toHaveLength(1)
    expect(plan.missing).toEqual([{ chapterTitle: 'The audit', paragraphIndex: 1 }])
  })

  it('treats a take without audio or duration as missing', () => {
    const plan = narrationPlan({
      chapters: [{ id: CHAPTER_A, title: 'The audit', contentMd: 'Only paragraph.' }],
      takes: [take({ r2Key: null as unknown as string })],
    })
    expect(plan.missing).toHaveLength(1)
  })
})

describe('assembleCaptions', () => {
  it('snaps each paragraph and shifts it onto the board clock', () => {
    const paragraphs = [
      {
        chapterId: CHAPTER_A,
        chapterIndex: 0,
        chapterTitle: 'One',
        paragraphIndex: 0,
        r2Key: 'k0',
        durationMs: 2000,
        text: 'Hello world.',
        timings: null,
        takeId: 't0',
        words: [
          { text: 'Hello', startMs: 0, endMs: 800 },
          { text: 'world.', startMs: 800, endMs: 1600 },
        ],
      },
      {
        chapterId: CHAPTER_B,
        chapterIndex: 1,
        chapterTitle: 'Two',
        paragraphIndex: 0,
        r2Key: 'k1',
        durationMs: 2000,
        text: 'Money vanished.',
        timings: null,
        takeId: 't1',
        words: [
          { text: 'Money', startMs: 100, endMs: 700 },
          { text: 'vanished.', startMs: 700, endMs: 1500 },
        ],
      },
    ]
    const captions = assembleCaptions(paragraphs)
    expect(captions.words.map((word) => word.text)).toEqual([
      'Hello',
      'world.',
      'Money',
      'vanished.',
    ])
    // The second paragraph's words sit after the first take's 2000 ms.
    expect(captions.words[2]!.startMs).toBe(2100)
    expect(captions.gaps).toEqual([])
  })

  it('carries QC gaps up with chapter context and clock offsets', () => {
    const captions = assembleCaptions([
      {
        chapterId: CHAPTER_A,
        chapterIndex: 0,
        chapterTitle: 'One',
        paragraphIndex: 3,
        r2Key: 'k0',
        durationMs: 10_000,
        text: 'A sentence with many words the audio never said at all here.',
        timings: null,
        takeId: 't0',
        // First and last words heard, nothing between: the interior run is
        // one long unmatched stretch, well past the 1500 ms gap threshold.
        words: [
          { text: 'A', startMs: 0, endMs: 200 },
          { text: 'here.', startMs: 8000, endMs: 8300 },
        ],
      },
    ])
    expect(captions.gaps.length).toBeGreaterThan(0)
    expect(captions.gaps[0]).toMatchObject({ chapterTitle: 'One', paragraphIndex: 3 })
  })
})

describe('evenlySpacedWords', () => {
  it('spreads words across the measured duration, tags excluded', () => {
    const words = evenlySpacedWords('[pause] By June, gone.', 3000)
    expect(words.map((word) => word.text)).toEqual(['By', 'June,', 'gone.'])
    expect(words[0]).toMatchObject({ startMs: 0, endMs: 1000 })
    expect(words[2]).toMatchObject({ startMs: 2000, endMs: 3000 })
  })

  it('returns nothing for empty text', () => {
    expect(evenlySpacedWords('   ', 1000)).toEqual([])
  })
})

describe('slotPlan', () => {
  const stockBrief = {
    type: 'stock',
    coversText: 'covers',
    description: 'desc',
    motion: { kind: 'kenburns', direction: 'in', speed: 'medium' },
    transition: 'cut',
    query: 'trading floor',
    rejectionCriteria: [],
  }

  function slotRow(overrides: Partial<AssemblySlotRow>): AssemblySlotRow {
    return {
      id: 'slot-1',
      type: 'stock',
      status: 'resolved',
      brief: stockBrief as unknown as Record<string, unknown>,
      candidates: [
        {
          id: 'c1',
          provider: 'pexels',
          kind: 'video',
          sourceUrl: 'https://videos.pexels.com/clip.mp4',
          licence: 'Pexels License',
          chosen: true,
          width: 1920,
          height: 1080,
        },
      ] as unknown as Record<string, unknown>[],
      chosenAssetId: null,
      startMs: 0,
      durationMs: 4000,
      ...overrides,
    }
  }

  it('maps a chosen stock candidate to a stable external URL', () => {
    const plan = slotPlan({ slots: [slotRow({})], assetsById: new Map() })
    expect(plan.skipped).toEqual([])
    expect(plan.slots[0]).toMatchObject({
      type: 'stock',
      media: { kind: 'video', externalUrl: 'https://videos.pexels.com/clip.mp4' },
    })
  })

  it('prefers our stored bytes over any URL', () => {
    const plan = slotPlan({
      slots: [slotRow({ chosenAssetId: 'asset-1' })],
      assetsById: new Map([['asset-1', { r2Key: 'boom-busters/media/abc.mp4' }]]),
    })
    const media = plan.slots[0]!.media
    expect(media?.r2Key).toBe('boom-busters/media/abc.mp4')
    expect(media?.externalUrl).toBeUndefined()
  })

  it('skips placeholders and hero slots, with reasons', () => {
    const plan = slotPlan({
      slots: [slotRow({ id: 'p', status: 'placeholder' }), slotRow({ id: 'h', type: 'hero' })],
      assetsById: new Map(),
    })
    expect(plan.slots).toEqual([])
    expect(plan.skipped.map((entry) => entry.slotId)).toEqual(['p', 'h'])
  })

  it('skips a generated:// candidate whose asset row is gone', () => {
    const plan = slotPlan({
      slots: [
        slotRow({
          candidates: [
            {
              id: 'g1',
              provider: 'google',
              kind: 'image',
              sourceUrl: 'generated://g1/abc123',
              licence: 'Generated',
              chosen: true,
            },
          ] as unknown as Record<string, unknown>[],
        }),
      ],
      assetsById: new Map(),
    })
    expect(plan.slots).toEqual([])
    expect(plan.skipped[0]?.reason).toContain('no storage key')
  })

  it('carries chart briefs through with their data and claim refs', () => {
    const plan = slotPlan({
      slots: [
        slotRow({
          type: 'chart',
          brief: {
            type: 'chart',
            coversText: 'covers',
            description: 'desc',
            motion: { kind: 'static' },
            transition: 'dissolve',
            chartKind: 'line',
            series: [
              {
                label: 'Price',
                unit: '€',
                points: [
                  { x: 'A', y: 1 },
                  { x: 'B', y: 2 },
                ],
              },
            ],
            dataRefs: ['01HQ00000000000000000000AA'],
            takeaway: 'Up and to the right, then not.',
            reveal: 'draw-on',
          } as unknown as Record<string, unknown>,
          candidates: [],
        }),
      ],
      assetsById: new Map(),
    })
    expect(plan.slots[0]).toMatchObject({
      type: 'chart',
      chart: { chartKind: 'line', takeaway: 'Up and to the right, then not.' },
    })
  })
})

describe('pickMusicBed', () => {
  it('takes the newest bed, or nothing from an empty library', () => {
    expect(pickMusicBed([{ r2Key: 'boom-busters/music/new.mp3' }, { r2Key: 'old' }])).toEqual({
      r2Key: 'boom-busters/music/new.mp3',
    })
    expect(pickMusicBed([])).toBeNull()
  })
})

describe('timelineKey', () => {
  it('is versioned under the app prefix', () => {
    expect(timelineKey('p1', 3)).toBe('boom-busters/timelines/p1/v3.json')
  })
})
