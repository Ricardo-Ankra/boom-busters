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

  describe('headline slots (decision 257)', () => {
    const CLAIM = '01HQ00000000000000000000AA'
    const headlineBrief = {
      type: 'headline',
      coversText: 'covers',
      description: 'The morning the story broke.',
      motion: { kind: 'static' },
      transition: 'cut',
      sourceClaimId: CLAIM,
      emphasis: '$1.9 billion',
    }
    const article = {
      url: 'https://financialrecord.example/2023/03/14/auditors',
      outlet: 'The Financial Record',
      headline: 'Auditors cannot find the $1.9 billion the company says it holds',
      author: 'Elena Marsh',
      publishedAt: '2023-03-14',
      description: 'Three banks say they never held the escrow accounts.',
      provenance: {},
      status: 'fetched' as const,
      failureReason: null,
    }
    const row = (overrides: Partial<AssemblySlotRow> = {}) =>
      slotRow({
        type: 'headline',
        brief: headlineBrief as unknown as Record<string, unknown>,
        candidates: [],
        ...overrides,
      })

    it('embeds the article whole, so the render never needs the page again', () => {
      const plan = slotPlan({
        slots: [row()],
        assetsById: new Map(),
        articles: new Map([[CLAIM, article]]),
      })
      expect(plan.skipped).toEqual([])
      expect(plan.slots[0]).toMatchObject({
        type: 'headline',
        headline: {
          outlet: 'The Financial Record',
          headline: article.headline,
          publishedAt: '2023-03-14',
          author: 'Elena Marsh',
          emphasis: '$1.9 billion',
          sourceLabel: 'financialrecord.example/2023/03/14/auditors',
          sourceUrl: article.url,
          claimId: CLAIM,
        },
      })
      // The standfirst is off unless the brief asked for it.
      expect(plan.slots[0]?.headline?.deck).toBeUndefined()
    })

    it('carries the standfirst only when the brief says to show it', () => {
      const plan = slotPlan({
        slots: [
          row({
            brief: { ...headlineBrief, showDeck: true } as unknown as Record<string, unknown>,
          }),
        ],
        assetsById: new Map(),
        articles: new Map([[CLAIM, article]]),
      })
      expect(plan.slots[0]?.headline?.deck).toBe(article.description)
    })

    it('drops a marker phrase the publication did not print', () => {
      const plan = slotPlan({
        slots: [
          row({
            brief: { ...headlineBrief, emphasis: 'two billion' } as unknown as Record<
              string,
              unknown
            >,
          }),
        ],
        assetsById: new Map(),
        articles: new Map([[CLAIM, article]]),
      })
      expect(plan.slots[0]?.headline?.emphasis).toBeUndefined()
    })

    it('skips a card whose article has nothing to show yet, and says so', () => {
      const unread = { ...article, outlet: null, headline: null, publishedAt: null }
      expect(
        slotPlan({ slots: [row()], assetsById: new Map(), articles: new Map([[CLAIM, unread]]) })
          .skipped[0]?.reason,
      ).toContain('no headline to show')

      expect(slotPlan({ slots: [row()], assetsById: new Map() }).skipped[0]?.reason).toContain(
        'no headline to show',
      )
    })
  })

  it('maps a chosen stock candidate to a stable external URL', () => {
    const plan = slotPlan({ slots: [slotRow({})], assetsById: new Map() })
    expect(plan.skipped).toEqual([])
    expect(plan.slots[0]).toMatchObject({
      type: 'stock',
      media: { kind: 'video', externalUrl: 'https://videos.pexels.com/clip.mp4' },
      // The compiler anchors the shot to these words (decision 255); a slot
      // that reaches it without them keeps the seconds the planner guessed.
      coversText: 'covers',
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

  it('skips a slot ingestion could not secure bytes for, carrying the reason', () => {
    const plan = slotPlan({
      slots: [slotRow({ id: 'dead' }), slotRow({ id: 'alive' })],
      assetsById: new Map(),
      unusable: { dead: 'pixabay no longer offers this asset (id 42)' },
    })
    expect(plan.slots).toHaveLength(1)
    expect(plan.skipped).toEqual([
      { slotId: 'dead', reason: 'pixabay no longer offers this asset (id 42)' },
    ])
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

  describe('graphic slots (decision 268, Plan B)', () => {
    const CLAIM_A = '01HQ00000000000000000000A2'
    const LOGO_ID = '01HQ00000000000000000000M1'

    function graphicBrief(scene: unknown) {
      return {
        type: 'graphic',
        coversText: 'covers',
        description: 'desc',
        motion: { kind: 'static' },
        transition: 'cut',
        scene,
      }
    }

    function graphicRow(overrides: { scene: unknown }) {
      return slotRow({
        type: 'graphic',
        brief: graphicBrief(overrides.scene) as unknown as Record<string, unknown>,
        candidates: [],
      })
    }

    it('compiles a graphic with its logo bytes, and skips one whose mark is missing, in words', () => {
      const scene = {
        elements: [
          {
            kind: 'figure',
            id: 'f1',
            cell: { col: 0, row: 0, colSpan: 6, rowSpan: 3 },
            value: '$4bn',
            claimRef: CLAIM_A,
            color: 'accent',
            enter: { kind: 'count', atMs: 0 },
          },
          {
            kind: 'logo',
            id: 'l1',
            cell: { col: 6, row: 0, colSpan: 6, rowSpan: 3 },
            entity: 'Stability AI',
            assetId: LOGO_ID,
            enter: { kind: 'fade', atMs: 0 },
          },
        ],
      }

      const plan = slotPlan({
        slots: [graphicRow({ scene })],
        assetsById: new Map(),
        logos: new Map([
          [LOGO_ID, { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 }],
        ]),
      })
      expect(plan.slots[0]).toMatchObject({
        type: 'graphic',
        graphic: { logos: { l1: { r2Key: 'boom-busters/logos/abc.png' } }, claimIds: [CLAIM_A] },
      })

      const missing = slotPlan({
        slots: [
          graphicRow({ scene: { elements: [{ ...scene.elements[1], assetId: undefined }] } }),
        ],
        assetsById: new Map(),
        logos: new Map(),
      })
      expect(missing.slots).toEqual([])
      expect(missing.skipped[0]?.reason).toBe('a logo for "Stability AI" has not been uploaded')
    })

    it('keys each logo by its own element id, so two different marks do not collide', () => {
      const LOGO_A = '01HQ00000000000000000000M1'
      const LOGO_B = '01HQ00000000000000000000M2'
      const scene = {
        elements: [
          {
            kind: 'logo',
            id: 'l1',
            cell: { col: 0, row: 0, colSpan: 6, rowSpan: 3 },
            entity: 'Stability AI',
            assetId: LOGO_A,
            enter: { kind: 'fade', atMs: 0 },
          },
          {
            kind: 'logo',
            id: 'l2',
            cell: { col: 6, row: 0, colSpan: 6, rowSpan: 3 },
            entity: 'OpenAI',
            assetId: LOGO_B,
            enter: { kind: 'fade', atMs: 0 },
          },
        ],
      }

      const plan = slotPlan({
        slots: [graphicRow({ scene })],
        assetsById: new Map(),
        logos: new Map([
          [LOGO_A, { r2Key: 'boom-busters/logos/a.png', width: 1200, height: 400 }],
          [LOGO_B, { r2Key: 'boom-busters/logos/b.png', width: 800, height: 800 }],
        ]),
      })
      const logos = plan.slots[0]?.graphic?.logos
      expect(logos?.['l1']?.r2Key).toBe('boom-busters/logos/a.png')
      expect(logos?.['l2']?.r2Key).toBe('boom-busters/logos/b.png')
      expect(logos?.['l1']?.r2Key).not.toBe(logos?.['l2']?.r2Key)
    })

    it('keys each logo by its own element id even when two elements share one asset id, so neither overwrites the other', () => {
      // A before/after layout can place the same uploaded mark at two
      // positions in one scene. The scene schema allows only one logo per
      // normalised entity string, so the two elements are given distinct
      // entity text (as two real slots for the one company would read on a
      // planned brief) while resolving to the SAME library asset — the case
      // that would collide if the output were ever keyed by asset id instead
      // of by element id.
      const scene = {
        elements: [
          {
            kind: 'logo',
            id: 'l1',
            cell: { col: 0, row: 0, colSpan: 6, rowSpan: 3 },
            entity: 'Stability AI',
            assetId: LOGO_ID,
            enter: { kind: 'fade', atMs: 0 },
          },
          {
            kind: 'logo',
            id: 'l2',
            cell: { col: 6, row: 0, colSpan: 6, rowSpan: 3 },
            entity: 'Stability AI again',
            assetId: LOGO_ID,
            enter: { kind: 'fade', atMs: 0 },
          },
        ],
      }

      const plan = slotPlan({
        slots: [graphicRow({ scene })],
        assetsById: new Map(),
        logos: new Map([
          [LOGO_ID, { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 }],
        ]),
      })
      const logos = plan.slots[0]?.graphic?.logos
      expect(Object.keys(logos ?? {})).toEqual(['l1', 'l2'])
      expect(logos?.['l1']?.r2Key).toBe('boom-busters/logos/abc.png')
      expect(logos?.['l2']?.r2Key).toBe('boom-busters/logos/abc.png')
    })
  })
})

describe('pickMusicBed', () => {
  it('takes the newest bed, or nothing from an empty library', () => {
    expect(pickMusicBed([{ r2Key: 'boom-busters/music/new.mp3' }, { r2Key: 'old' }])).toEqual({
      r2Key: 'boom-busters/music/new.mp3',
      durationMs: null,
    })
    expect(pickMusicBed([])).toBeNull()
  })

  it("carries the bed's length, which is what lets the renderer overlap the loop", () => {
    expect(pickMusicBed([{ r2Key: 'boom-busters/music/new.mp3', durationMs: 183_000 }])).toEqual({
      r2Key: 'boom-busters/music/new.mp3',
      durationMs: 183_000,
    })
  })
})

describe('timelineKey', () => {
  it('is versioned under the app prefix', () => {
    expect(timelineKey('p1', 3)).toBe('boom-busters/timelines/p1/v3.json')
  })
})
