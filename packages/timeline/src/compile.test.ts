import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  canonicalTimelineIssues,
  cardDurationMs,
  cardWords,
  DEFAULT_SETTINGS,
  resolveBrandKit,
  timelineDurationMs,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  CHAPTER_HOLD_MS,
  CHAPTER_LEAD_MS,
  CHAPTER_OVERLAP_MS,
  compileTimeline,
  compileTimelineWithReport,
  KENBURNS_INTENSITY,
  MIN_SHOT_MS,
  PARAGRAPH_GAP_MS,
  resolveMotion,
} from './compile'
import { SHORT_RULES } from '@boom-busters/schemas'
import type { CompileInput, CompileSlot } from './compile'
import type { GraphicCodePayload } from '@boom-busters/schemas'
import { DEFAULT_RISE_THRESHOLD_MS } from './ducking'
import { offsetCaptions, snapToScript } from './snap'

const CHAPTER_ONE = '01HQ0000000000000000000CH1'
export const CHAPTER_TWO = '01HQ0000000000000000000CH2'
export const CHAPTER_THREE = '01HQ0000000000000000000CH3'
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
    chapterMarking: 'cards',
    filmTitle: 'The Wirecard Hole',
  }
}

/** goldenInput() plus a fourth paragraph opening a third chapter (decision 457). */
export function threeChapterInput(over: Partial<CompileInput> = {}): CompileInput {
  const input = goldenInput()
  input.paragraphs.push({
    chapterId: CHAPTER_THREE,
    chapterIndex: 2,
    chapterTitle: 'The trial',
    paragraphIndex: 0,
    r2Key: 'boom-busters/takes/p4.mp3',
    durationMs: 5000,
  })
  return { ...input, ...over }
}

const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), 'golden', 'master-timeline.json')

describe('compileTimeline', () => {
  /**
   * Decision 255. The planner's seconds are a guess made before the narration
   * was timed; the compiler has the words, so the words win.
   */
  describe('shots sit on the words they cover', () => {
    /** The last paragraph, "The shares collapsed in nine days.", starts at 14s. */
    function twoShotsInOneParagraph(coversText: string | undefined): CompileInput {
      const input = goldenInput()
      const chart = input.slots[2]!
      const map = input.slots[3]!
      input.slots = [
        { ...chart, startMs: 14_000, durationMs: 4000, coversText: 'The shares collapsed' },
        {
          ...map,
          startMs: 18_000,
          durationMs: 3000,
          ...(coversText === undefined ? {} : { coversText }),
        },
      ]
      return input
    }

    it('moves the late shot back onto its sentence and trims the one before it', () => {
      const timeline = compileTimeline(twoShotsInOneParagraph('nine days.'))
      const [first, second] = timeline.slots
      // "nine" is the fifth word of the paragraph, 1.6s in; the planner had
      // put this shot 4s in, so it was arriving 2.4s after its own words.
      expect(second!.startMs - first!.startMs).toBe(1600)
      // The outgoing shot gives way at that word rather than painting over it.
      expect(first!.durationMs).toBe(1600)
    })

    it('leaves a shot on its planned start when its brief quotes nothing', () => {
      const timeline = compileTimeline(twoShotsInOneParagraph(undefined))
      const [first, second] = timeline.slots
      expect(second!.startMs - first!.startMs).toBe(4000)
    })

    it('opens on the first shot, whatever its words say', () => {
      // The quote starts two words into the paragraph, and the narrator takes
      // a breath before them. Nothing can hold the screen before the opening
      // shot, so it keeps the opening rather than its words' own moment.
      const planned = compileTimeline(goldenInput())
      const input = goldenInput()
      input.slots = input.slots.map((slot, index) =>
        index === 0 ? { ...slot, coversText: 'the auditors could not find the money' } : slot,
      )
      const anchored = compileTimeline(input)
      expect(anchored.slots[0]!.startMs).toBe(planned.slots[0]!.startMs)
    })

    it('never compiles a shot shorter than the floor', () => {
      // Both shots quote the same opening, so both anchor to the same word.
      const timeline = compileTimeline(twoShotsInOneParagraph('The shares collapsed'))
      expect(timeline.slots[0]!.durationMs).toBe(MIN_SHOT_MS)
    })
  })

  it('matches the committed golden byte for byte', () => {
    const compiled = JSON.stringify(compileTimeline(goldenInput()), null, 2) + '\n'
    if (process.env['REGEN_GOLDEN'] === '1') {
      writeFileSync(GOLDEN_PATH, compiled)
    }
    // If this fails after an intentional compiler change, regenerate with
    // REGEN_GOLDEN=1 and review the golden's diff — the diff IS the review.
    expect(compiled).toBe(readFileSync(GOLDEN_PATH, 'utf8'))
  })

  it('opens on the first word: narration starts at 0 and no card precedes it (decision 457)', () => {
    const timeline = compileTimeline(goldenInput())
    expect(timeline.narration.map((s) => s.startMs)).toEqual([0, 8700, 18_250])
    expect(timelineDurationMs(timeline)).toBe(25_250)
    expect(timeline.overlays.map((o) => o.startMs)).toEqual([15_500])
    expect(timeline.chapters).toEqual([
      { id: CHAPTER_ONE, title: 'The audit' },
      { id: CHAPTER_TWO, title: 'The collapse' },
    ])
  })

  it('cards mode: one card per later chapter, title only in the props index, and the cue at the card', () => {
    const timeline = compileTimeline(goldenInput())
    expect(timeline.overlays).toEqual([
      {
        kind: 'chapterCard',
        startMs: 15_500,
        durationMs: cardDurationMs('The collapse'),
        props: { index: 2, title: 'The collapse' },
      },
    ])
    expect(timeline.narration[2]!.startMs).toBe(
      15_500 + cardDurationMs('The collapse') - CHAPTER_OVERLAP_MS,
    )
    expect(timeline.music?.cuePoints.map((c) => c.tMs)).toEqual([0, 15_500])
  })

  it('none mode: no overlay, a held break of lead plus hold, the cue at the lead point', () => {
    const timeline = compileTimeline({ ...goldenInput(), chapterMarking: 'none' })
    expect(timeline.overlays).toEqual([])
    expect(timeline.narration[2]!.startMs).toBe(14_700 + CHAPTER_LEAD_MS + CHAPTER_HOLD_MS)
    expect(timeline.music?.cuePoints.map((c) => c.tMs)).toEqual([0, 15_500])
    // The outgoing shot holds through the break to the resumed words.
    const still = timeline.slots[1]!
    expect(still.startMs + still.durationMs).toBe(timeline.narration[2]!.startMs)
  })

  it('none mode: the held break clears the ducking rise threshold, so the bed rises inside it', () => {
    expect(CHAPTER_LEAD_MS + CHAPTER_HOLD_MS).toBeGreaterThanOrEqual(DEFAULT_RISE_THRESHOLD_MS)
    const timeline = compileTimeline({ ...goldenInput(), chapterMarking: 'none' })
    const secondEnd = timeline.narration[1]!.startMs + timeline.narration[1]!.durationMs
    const thirdStart = timeline.narration[2]!.startMs
    const bed = resolveBrandKit(DEFAULT_SETTINGS).music.bedGainDb
    const risen = timeline.music!.duckingCurve.filter(
      (point) => point.gainDb === bed && point.tMs > secondEnd && point.tMs < thirdStart,
    )
    expect(risen.length).toBeGreaterThan(0)
  })

  it('title mode: the film title once at chapter two, later chapters unmarked', () => {
    const input = threeChapterInput({ chapterMarking: 'title' })
    const timeline = compileTimeline(input)
    expect(timeline.overlays).toEqual([
      {
        kind: 'titleCard',
        startMs: 15_500,
        durationMs: cardDurationMs('The Wirecard Hole'),
        props: { title: 'The Wirecard Hole' },
      },
    ])
    const third = timeline.narration[3]!
    const second = timeline.narration[2]!
    expect(third.startMs).toBe(
      second.startMs + second.durationMs + CHAPTER_LEAD_MS + CHAPTER_HOLD_MS,
    )
    expect(timeline.music?.cuePoints.map((c) => c.tMs)).toEqual([
      0,
      15_500,
      second.startMs + second.durationMs + CHAPTER_LEAD_MS,
    ])
  })

  it('a single-chapter film gets no card in any mode', () => {
    for (const chapterMarking of ['cards', 'title', 'none'] as const) {
      const input = { ...goldenInput(), chapterMarking }
      input.paragraphs = input.paragraphs.filter((p) => p.chapterId === CHAPTER_ONE)
      expect(compileTimeline(input).overlays).toEqual([])
    }
  })

  it('cardWords times each title word at the silent reading pace', () => {
    expect(cardWords("The Money That Wasn't There")).toEqual([
      { text: 'The', atMs: 300 },
      { text: 'Money', atMs: 550 },
      { text: 'That', atMs: 800 },
      { text: "Wasn't", atMs: 1050 },
      { text: 'There', atMs: 1300 },
    ])
  })

  it('cardDurationMs: a one-word card passes the floor, a five-word title is longer', () => {
    expect(cardDurationMs('Fraud')).toBe(3400)
    expect(cardDurationMs("The Money That Wasn't There")).toBe(4400)
  })

  it('lengthens a chapter break for a long title', () => {
    const title = "The Money That Wasn't There"
    const input = goldenInput()
    input.paragraphs = input.paragraphs.map((p) =>
      p.chapterId === CHAPTER_TWO ? { ...p, chapterTitle: title } : p,
    )
    const timeline = compileTimeline(input)
    const card = timeline.overlays[0]!
    expect(card.durationMs).toBe(cardDurationMs(title))
    expect(card.durationMs).toBe(4400)
    expect(timeline.narration[2]!.startMs).toBe(card.startMs + card.durationMs - CHAPTER_OVERLAP_MS)
  })

  it('attaches card code with reading-paced words', () => {
    const chapter = { version: 1, compiled: 'export default 1', title: 'The collapse' }
    const timeline = compileTimeline({ ...goldenInput(), cardCode: { chapter } })
    const card = timeline.overlays[0]!
    expect(card.kind).toBe('chapterCard')
    if (card.kind !== 'chapterCard') return
    expect(card.code).toEqual({
      ...chapter,
      words: cardWords('The collapse'),
      durationMs: card.durationMs,
    })
    expect(compileTimeline(goldenInput()).overlays[0]).not.toHaveProperty('code')
  })

  it('card code for a title with an abbreviation has no word but the last ending in a full stop', () => {
    const chapter = { version: 1, compiled: 'export default 1', title: "Dr. Braun's Empire" }
    const input = goldenInput()
    input.paragraphs = input.paragraphs.map((p) =>
      p.chapterId === CHAPTER_TWO ? { ...p, chapterTitle: "Dr. Braun's Empire" } : p,
    )
    const card = compileTimeline({ ...input, cardCode: { chapter } }).overlays[0]!
    if (card.kind !== 'chapterCard' || !card.code) throw new Error('expected card code')
    expect(card.code.words).toHaveLength(2)
    expect(card.code.words.slice(0, -1).some((word) => word.text.endsWith('.'))).toBe(false)
  })

  it('title card uses the title code, and carries none without it', () => {
    const title = { version: 1, compiled: 'export default 2', title: 'The Wirecard Hole' }
    const withCode = compileTimeline(
      threeChapterInput({ chapterMarking: 'title', cardCode: { title } }),
    )
    const card = withCode.overlays[0]!
    expect(card.kind).toBe('titleCard')
    if (card.kind !== 'titleCard') return
    expect(card.code).toEqual({
      ...title,
      words: cardWords('The Wirecard Hole'),
      durationMs: card.durationMs,
    })
    const without = compileTimeline(threeChapterInput({ chapterMarking: 'title' }))
    expect(without.overlays[0]).not.toHaveProperty('code')
  })

  it('breathes between paragraphs and pauses before a chapter card', () => {
    const timeline = compileTimeline(goldenInput())
    const [first, second, third] = timeline.narration
    // A beat between paragraphs of the same chapter.
    expect(second!.startMs - (first!.startMs + first!.durationMs)).toBe(PARAGRAPH_GAP_MS)
    // The second chapter's card starts a lead after the last word, and its
    // narration resumes while the card is still opaque.
    const card = timeline.overlays[0]!
    expect(card.startMs).toBe(second!.startMs + second!.durationMs + CHAPTER_LEAD_MS)
    expect(third!.startMs).toBe(card.startMs + card.durationMs - CHAPTER_OVERLAP_MS)
  })

  it('shifts and stretches the other tracks by the same clock', () => {
    const timeline = compileTimeline(goldenInput())
    const resume = timeline.narration[2]!.startMs
    // The slot that ended at the old chapter boundary holds under the card
    // until the new chapter's first slot begins with its words.
    const still = timeline.slots[1]!
    expect(still.startMs + still.durationMs).toBe(resume)
    expect(timeline.slots[2]!.startMs).toBe(resume)
    // Caption words ride their paragraph: the third paragraph's first word
    // starts when its narration does.
    expect(
      timeline.captions.words.some((word) => word.text === 'The' && word.startMs === resume),
    ).toBe(true)
  })

  it('closes rounding seams so every slot holds until the next one starts', () => {
    const input = goldenInput()
    // The board routinely leaves rounding seams between consecutive slots.
    // Widen one across a paragraph boundary and one across a chapter
    // boundary: the inserted pauses turned exactly these into visible black
    // frames in production (2026-09-07 preview review).
    input.slots[0]!.durationMs = 7960 // 40ms seam before the paragraph pause
    input.slots[1]!.durationMs = 5950 // 50ms seam before the chapter card
    const timeline = compileTimeline(input)
    for (let i = 0; i < timeline.slots.length - 1; i += 1) {
      const slot = timeline.slots[i]!
      expect(slot.startMs + slot.durationMs).toBe(timeline.slots[i + 1]!.startMs)
    }
    // The held shot still reaches the resumed narration under the card.
    expect(timeline.slots[2]!.startMs).toBe(timeline.narration[2]!.startMs)
  })

  it('ducks the music with the Brand Kit gains', () => {
    const timeline = compileTimeline(goldenInput())
    const brand = resolveBrandKit(DEFAULT_SETTINGS)
    expect(timeline.music?.gainDb).toBe(brand.music.bedGainDb)
    const curve = timeline.music!.duckingCurve
    // Words start at 0 (decision 457), so the bed opens already ducked.
    expect(curve[0]?.gainDb).toBe(brand.music.bedGainDb + brand.music.duckDepthDb)
    expect(Math.min(...curve.map((point) => point.gainDb))).toBe(
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

  it('maps a punch brief to the rule book punch', () => {
    expect(resolveMotion({ kind: 'punch' }, still)).toEqual({
      kind: 'punch',
      scale: SHORT_RULES.punchScale,
      durationMs: SHORT_RULES.punchMs,
    })
  })

  it('turns a worded pan into a medium push-in rather than a frozen frame', () => {
    expect(resolveMotion({ kind: 'pan', path: 'left to right' }, still)).toEqual({
      kind: 'kenburns',
      direction: 'in',
      intensity: KENBURNS_INTENSITY.medium,
    })
  })

  it('compiles a headline card to a payload that needs nothing else', () => {
    const timeline = compileTimeline({
      ...goldenInput(),
      slots: [
        {
          type: 'headline',
          startMs: 0,
          durationMs: 6000,
          transition: 'cut',
          motion: { kind: 'static' },
          headline: {
            outlet: 'The Financial Record',
            headline: 'Auditors cannot find the $1.9 billion the company says it holds',
            publishedAt: '2023-03-14',
            author: 'Elena Marsh',
            emphasis: '$1.9 billion',
            sourceLabel: 'financialrecord.example/2023/03/14',
            sourceUrl: 'https://financialrecord.example/2023/03/14',
            claimId: CLAIM,
          },
        },
      ],
    })

    const slot = timeline.slots[0]
    expect(slot?.type).toBe('headline')
    expect(slot?.payload).toMatchObject({
      kind: 'headline',
      outlet: 'The Financial Record',
      publishedAt: '2023-03-14',
      claimId: CLAIM,
    })
  })

  it('compiles a graphic to a payload embedding its scene, logos and claims', () => {
    const slot: CompileSlot = {
      type: 'graphic',
      startMs: 0,
      durationMs: 6000,
      transition: 'cut',
      motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
      coversText: 'It raised four billion dollars.',
      graphic: {
        scene: {
          elements: [
            {
              kind: 'text',
              id: 't',
              cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
              content: 'Raised',
              role: 'heading',
              color: 'textPrimary',
              align: 'start',
              enter: { kind: 'fade', atMs: 0 },
            },
          ],
        },
        logos: { l1: { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 } },
        claimIds: ['01HQ00000000000000000000A1'],
      },
    }
    const timeline = compileTimeline({ ...goldenInput(), slots: [slot] })
    const compiled = timeline.slots[0]!
    expect(compiled.type).toBe('graphic')
    expect(compiled.payload).toMatchObject({
      kind: 'graphic',
      claimIds: ['01HQ00000000000000000000A1'],
    })
    expect(compiled.motion).toEqual({ kind: 'static' })
  })

  it('compiles a social post to a payload that parses, with its own static motion', () => {
    const timeline = compileTimeline({
      ...goldenInput(),
      slots: [
        {
          type: 'social',
          startMs: 0,
          durationMs: 6000,
          transition: 'cut',
          motion: { kind: 'kenburns', direction: 'in', speed: 'medium' },
          social: {
            platform: 'x',
            authorName: 'Emad',
            handle: 'EMostaque',
            text: 'As my notifications are RIP some notes',
            cutBefore: false,
            cutAfter: true,
            postedAt: '2024-03-23',
            initials: 'E',
            avatar: { r2Key: 'boom-busters/cast/p1/avatar.png' },
            media: { r2Key: 'boom-busters/social/p1/media.png' },
            sourceLabel: 'x.com/EMostaque/status/1771400218170519741',
            sourceUrl: 'https://x.com/EMostaque/status/1771400218170519741',
            claimId: CLAIM,
          },
        },
      ],
    })

    const slot = timeline.slots[0]
    expect(slot?.type).toBe('social')
    expect(slot?.motion).toEqual({ kind: 'static' })
    expect(slot?.payload).toMatchObject({
      kind: 'social',
      handle: 'EMostaque',
      avatar: { r2Key: 'boom-busters/cast/p1/avatar.png' },
      media: { r2Key: 'boom-busters/social/p1/media.png' },
      claimId: CLAIM,
    })
    expect(canonicalTimelineIssues(timeline)).toEqual([])
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

  /** A stored design as the assembly hands it over (decision 295). */
  const CODE: Omit<GraphicCodePayload, 'kind'> = {
    version: 1,
    compiled: 'function Graphic(props) {\n  return null;\n}\n',
    title: 'Raised in one round',
    words: [{ text: 'four', atMs: 900 }],
    durationMs: 6000,
    logos: { 'Stability AI': { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 } },
    claimIds: ['01HQ00000000000000000000A1'],
  }

  it('compiles a graphic carrying code to a graphic-code payload, whatever scene it also holds (decision 295)', () => {
    const slot: CompileSlot = {
      type: 'graphic',
      startMs: 0,
      durationMs: 6000,
      transition: 'cut',
      motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
      coversText: 'It raised four billion dollars.',
      // The scene a Redesign left beside the code: the code wins.
      graphic: {
        scene: {
          elements: [
            {
              kind: 'text',
              id: 't',
              cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
              content: 'Raised',
              role: 'heading',
              color: 'textPrimary',
              align: 'start',
              enter: { kind: 'fade', atMs: 0 },
            },
          ],
        },
        logos: {},
        claimIds: [],
      },
      graphicCode: CODE,
    }
    const timeline = compileTimeline({ ...goldenInput(), slots: [slot] })
    const compiled = timeline.slots[0]!
    // The slot keeps its board type; only the payload says how it is drawn.
    expect(compiled.type).toBe('graphic')
    expect(compiled.payload).toEqual({ kind: 'graphic-code', ...CODE })
    // The code animates itself: no Ken Burns on top of it.
    expect(compiled.motion).toEqual({ kind: 'static' })
    expect(canonicalTimelineIssues(timeline)).toEqual([])
  })

  it('compiles a chart carrying code to a graphic-code payload on a chart slot, its series as data (decision 295)', () => {
    const series = [
      {
        label: 'Share price',
        unit: 'EUR',
        points: [
          { x: '2020-06-17', y: 104.5 },
          { x: '2020-06-26', y: 1.28 },
        ],
      },
    ]
    const slot: CompileSlot = {
      ...still,
      type: 'chart',
      chart: {
        chartKind: 'line',
        series,
        dataRefs: [CLAIM],
        takeaway: 'The nine-day collapse.',
        reveal: 'draw-on',
      },
      graphicCode: {
        ...CODE,
        logos: {},
        claimIds: [CLAIM],
        data: { series, takeaway: 'The nine-day collapse.' },
      },
    }
    const timeline = compileTimeline({ ...goldenInput(), slots: [slot] })
    const compiled = timeline.slots[0]!
    expect(compiled.type).toBe('chart')
    expect(compiled.payload).toMatchObject({
      kind: 'graphic-code',
      claimIds: [CLAIM],
      data: { series, takeaway: 'The nine-day collapse.' },
    })
    // The draw-on belongs to the chart's own reveal, which this slot no longer plays.
    expect(compiled.motion).toEqual({ kind: 'static' })
  })

  it('still compiles a chart without code to its own reveal', () => {
    const timeline = compileTimeline(goldenInput())
    const chart = timeline.slots.find((slot) => slot.type === 'chart')!
    expect(chart.payload.kind).toBe('chart')
    expect(chart.motion).toEqual({ kind: 'draw-on' })
  })
})

describe('the reading pause', () => {
  const GRAPHIC: Omit<GraphicCodePayload, 'kind'> = {
    version: 1,
    compiled: 'function Graphic(props) { return null; }',
    title: 'A graphic',
    words: [{ text: 'June', atMs: 400 }],
    durationMs: 6000,
    logos: {},
    claimIds: [],
  }

  /**
   * The first paragraph is "By June, the auditors could not find the money." at
   * 400 ms a word. Two graphics end on a comma ("June," and "auditors,") with
   * the next shot a word or two behind, so each is given a capped pause.
   */
  function pausedInput(withHolds: boolean): CompileInput {
    const input = goldenInput()
    const still = input.slots[1]!
    const hold = withHolds ? { holdMs: 2000 } : {}
    input.captions.words = input.captions.words.map((w) =>
      w.text === 'auditors' ? { ...w, text: 'auditors,' } : w,
    )
    const code = (startMs: number, coversText: string): CompileSlot => ({
      ...still,
      type: 'graphic',
      startMs,
      durationMs: 1000,
      coversText,
      graphicCode: GRAPHIC,
      ...hold,
    })
    input.slots = [
      code(0, 'By June,'),
      code(800, 'the auditors'),
      { ...still, startMs: 1600, durationMs: 3000, coversText: 'could not find the money.' },
    ]
    return input
  }

  it('splits a paragraph at two pauses into three pieces', () => {
    const timeline = compileTimeline(pausedInput(true))
    const pieces = timeline.narration.filter(
      (s) => s.paragraphIndex === 0 && s.chapterId === CHAPTER_ONE,
    )
    expect(pieces.map((p) => p.trimStartMs)).toEqual([undefined, 775, 1575])
    expect(pieces.map((p) => p.durationMs)).toEqual([775, 800, 6425])
    // Each piece starts where its first word does, less the word's offset into it.
    const words = timeline.captions.words
    const the = words.find((w) => w.text === 'the')!
    const could = words.find((w) => w.text === 'could')!
    expect(pieces[1]!.startMs).toBe(the.startMs - (800 - 775))
    expect(pieces[2]!.startMs).toBe(could.startMs - (1600 - 1575))
    expect(pieces.every((p) => p.r2Key === pieces[0]!.r2Key)).toBe(true)
  })

  it('stretches the graphic across its pause', () => {
    const plain = compileTimeline(pausedInput(false))
    const held = compileTimeline(pausedInput(true))
    // The next shot's words were 800 ms in; the pause carries them 1500 later, and
    // the graphic holds the screen until they arrive.
    expect(held.slots[0]!.durationMs).toBe(800 + 1500)
    expect(held.slots[0]!.durationMs).toBeGreaterThan(plain.slots[0]!.durationMs)
    expect(held.slots[1]!.startMs).toBe(plain.slots[1]!.startMs + 1500)
    expect(held.slots[2]!.startMs).toBe(plain.slots[2]!.startMs + 3000)
  })

  it('shifts captions after a pause and not before', () => {
    const plain = compileTimeline(pausedInput(false)).captions.words
    const held = compileTimeline(pausedInput(true)).captions.words
    const start = (words: typeof held, text: string) => words.find((w) => w.text === text)!.startMs
    expect(start(held, 'June,')).toBe(start(plain, 'June,'))
    expect(start(held, 'the')).toBe(start(plain, 'the') + 1500)
    expect(start(held, 'could')).toBe(start(plain, 'could') + 3000)
    expect(start(held, 'EY')).toBe(start(plain, 'EY') + 3000)
  })

  it('moves a chapter card that follows a pause', () => {
    const plain = compileTimeline(pausedInput(false))
    const held = compileTimeline(pausedInput(true))
    expect(held.overlays[0]!.startMs).toBe(plain.overlays[0]!.startMs + 3000)
  })

  it('adds no pause when the next shot is unanchored and starts before the cut', () => {
    const input = pausedInput(true)
    // No quote, so it keeps its planned start: 500 ms, ahead of the 775 ms cut.
    input.slots = [input.slots[0]!, { ...input.slots[2]!, startMs: 500, coversText: undefined }]
    delete input.slots[1]!.coversText
    const { timeline, readingHold } = compileTimelineWithReport(input)
    expect(readingHold).toEqual({ pauses: 0, addedMs: 0, midClause: 0, overlapped: 1 })
    expect(timeline.narration).toHaveLength(3)
    expect(timeline.narration.every((s) => s.trimStartMs === undefined)).toBe(true)
  })

  it('reports pauses and added time', () => {
    const { readingHold, timeline } = compileTimelineWithReport(pausedInput(true))
    expect(readingHold).toEqual({ pauses: 2, addedMs: 3000, midClause: 0, overlapped: 0 })
    expect(timeline).toEqual(compileTimeline(pausedInput(true)))
  })

  it('extends the film last graphic to its hold', () => {
    const build = (withHold: boolean): CompileInput => {
      const input = goldenInput()
      // "in nine days." ends the film; its last word leaves 900 ms of planned screen time.
      input.slots = [
        input.slots[1]!,
        {
          ...input.slots[1]!,
          type: 'graphic',
          startMs: 15_200,
          durationMs: 1700,
          coversText: 'in nine days.',
          graphicCode: GRAPHIC,
          ...(withHold ? { holdMs: 2000 } : {}),
        },
      ]
      input.slots[0] = { ...input.slots[0]!, startMs: 0 }
      return input
    }
    const plain = compileTimeline(build(false)).slots[1]!
    const held = compileTimeline(build(true)).slots[1]!
    expect(held.durationMs).toBe(plain.durationMs + 1100)
  })

  /**
   * Chapter one's last graphic covers "EY refused to sign the accounts." and its
   * last word starts late in the paragraph, so a card at the chapter break
   * (paragraph end plus the lead) would cover it too soon.
   */
  function carriedGraphicInput(over: Partial<CompileInput> = {}): CompileInput {
    const input = threeChapterInput(over)
    const still = input.slots[1]!
    input.captions.words = input.captions.words.map((w) => {
      if (w.text === 'accounts.') return { ...w, startMs: 13_000, endMs: 13_350 }
      if (w.text === 'days.') return { ...w, startMs: 20_000, endMs: 20_350 }
      return w
    })
    const graphic = (startMs: number, durationMs: number, coversText: string): CompileSlot => ({
      ...still,
      type: 'graphic',
      startMs,
      durationMs,
      coversText,
      graphicCode: GRAPHIC,
      holdMs: 2000,
    })
    input.slots = [
      input.slots[0]!,
      graphic(8000, 6000, 'EY refused to sign the accounts.'),
      graphic(14_000, 7000, 'The shares collapsed in nine days.'),
      { ...still, startMs: 21_000, durationMs: 4000 },
    ]
    return input
  }

  it('cards: a graphic closing a chapter is held against the card, not the next shot', () => {
    const plain = compileTimeline({
      ...carriedGraphicInput(),
      slots: carriedGraphicInput().slots.map((slot) => ({ ...slot, holdMs: undefined })),
    })
    const { timeline, readingHold } = compileTimelineWithReport(carriedGraphicInput())
    // 'accounts.' starts 13700 shifted and the card opens at 15500: 1800 of the
    // 2000 needed, so 200 is added at the break. The next shot (14000, shifted
    // to 18000) would have counted the whole card as reading time.
    expect(readingHold.pauses).toBe(2)
    const [chapterOne, chapterTwo] = timeline.overlays
    expect(chapterOne!.startMs).toBe(plain.overlays[0]!.startMs + 200)
    // The second break is held the same way, and carries the first pause with it.
    expect(chapterTwo!.startMs).toBe(plain.overlays[1]!.startMs + 400)
    expect(timeline.music?.cuePoints.map((c) => c.tMs)).toEqual([
      0,
      chapterOne!.startMs,
      chapterTwo!.startMs,
    ])
  })

  it('cards: the pause lands at the chapter boundary, so the break is the pause', () => {
    const { readingHold } = compileTimelineWithReport(carriedGraphicInput())
    expect(readingHold.addedMs).toBe(400)
    const timeline = compileTimeline(carriedGraphicInput())
    const secondEnd = timeline.narration[1]!.startMs + timeline.narration[1]!.durationMs
    expect(timeline.overlays[0]!.startMs).toBe(secondEnd + CHAPTER_LEAD_MS + 200)
  })

  it('none: a graphic closing a chapter keeps its measurement to the next shot', () => {
    const { readingHold } = compileTimelineWithReport(
      carriedGraphicInput({ chapterMarking: 'none' }),
    )
    expect(readingHold.pauses).toBe(0)
  })

  it('title: only the second chapter has a card to be held against', () => {
    const { timeline, readingHold } = compileTimelineWithReport(
      carriedGraphicInput({ chapterMarking: 'title' }),
    )
    expect(readingHold.pauses).toBe(1)
    expect(readingHold.addedMs).toBe(200)
    expect(timeline.overlays).toHaveLength(1)
    expect(timeline.music?.cuePoints[1]!.tMs).toBe(timeline.overlays[0]!.startMs)
  })

  it('caps a paragraph-end pause inside a chapter below the ducking rise', () => {
    const input = goldenInput()
    const still = input.slots[1]!
    input.captions.words = input.captions.words.map((w) =>
      w.text === 'money.' ? { ...w, startMs: 7900, endMs: 7950 } : w,
    )
    input.slots = [
      {
        ...still,
        type: 'graphic',
        startMs: 0,
        durationMs: 8000,
        coversText: 'By June, the auditors could not find the money.',
        graphicCode: GRAPHIC,
        // A 1500 ms shortfall once the 700 ms paragraph gap is counted.
        holdMs: 2300,
      },
      { ...still, startMs: 8000, durationMs: 6000 },
    ]
    const { timeline, readingHold } = compileTimelineWithReport(input)
    expect(readingHold.addedMs).toBe(DEFAULT_RISE_THRESHOLD_MS - PARAGRAPH_GAP_MS - 1)
    const [first, second] = timeline.narration
    const firstEnd = first!.startMs + first!.durationMs
    expect(second!.startMs - firstEnd).toBeLessThan(DEFAULT_RISE_THRESHOLD_MS)
    const bed = resolveBrandKit(DEFAULT_SETTINGS).music.bedGainDb
    const risen = timeline.music!.duckingCurve.filter(
      (point) => point.gainDb === bed && point.tMs > firstEnd && point.tMs < second!.startMs,
    )
    expect(risen).toEqual([])
  })

  it('a mid-paragraph pause keeps the full cap', () => {
    const { readingHold } = compileTimelineWithReport(pausedInput(true))
    expect(readingHold.addedMs).toBe(2 * 1500)
  })

  it('leaves a timeline without holds unchanged', () => {
    const input = goldenInput()
    expect(compileTimelineWithReport(input).readingHold).toEqual({
      pauses: 0,
      addedMs: 0,
      midClause: 0,
      overlapped: 0,
    })
    const withRoom = goldenInput()
    withRoom.slots = withRoom.slots.map((slot) => ({ ...slot, holdMs: 2000 }))
    expect(compileTimeline(withRoom)).toEqual(compileTimeline(input))
  })
})
