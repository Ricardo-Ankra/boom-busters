import { SHORT_RULES, TimelineSchema } from '@boom-busters/schemas'
import type { TimelineSlot } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { compileShortMaster, layoutPointNarration } from './point'
import { pacePointShots } from './point-pictures'
import { pointFixtureInput } from './point.fixture'
import { checkShortRules } from './point-rules'
import {
  graphicCueWords,
  isCuedGraphic,
  paceGraphicShots,
  pointGraphicWindow,
  sameGraphic,
} from './point-graphics'
import type { PaceableShot } from './point-graphics'

const R = SHORT_RULES
/** The fixture's even word clock: word i starts at i * 372 ms. */
const WORD_MS = 372
const words = Array.from({ length: 140 }, (_, i) => ({ text: `w${i}`, startMs: i * WORD_MS }))
const END_MS = 140 * WORD_MS

function graphic(title: string, compiled = `/* ${title} */`): TimelineSlot {
  return {
    type: 'chart',
    startMs: 0,
    durationMs: 20_000,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: {
      kind: 'graphic-code',
      version: 1,
      compiled,
      title,
      words: [{ text: 'long-form', atMs: 5_000 }],
      durationMs: 20_000,
      logos: {},
      claimIds: [],
    },
  }
}

function photo(name: string): TimelineSlot {
  return {
    type: 'still',
    startMs: 0,
    durationMs: 3_000,
    transition: 'cut',
    motion: { kind: 'kenburns', direction: 'in', intensity: 0.3 },
    payload: { kind: 'image', src: { r2Key: `stills/${name}.png` } },
  }
}

const shot = (startWord: number, slot: TimelineSlot): PaceableShot => ({ startWord, slot })
/** The word a hold from `cueWord` ends on: the first word at or after its end. */
const holdWord = (cueWord: number) =>
  Math.ceil((cueWord * WORD_MS + R.graphicSettleMs + R.graphicHoldMs) / WORD_MS)

describe('isCuedGraphic and sameGraphic', () => {
  it('knows a designed graphic and tells two apart by their code, title and data', () => {
    expect(isCuedGraphic(graphic('a'))).toBe(true)
    expect(isCuedGraphic(photo('a'))).toBe(false)
    expect(isCuedGraphic(null)).toBe(false)
    expect(sameGraphic(graphic('a'), graphic('a'))).toBe(true)
    expect(sameGraphic(graphic('a'), graphic('b'))).toBe(false)
    expect(sameGraphic(graphic('a', 'x'), graphic('a', 'y'))).toBe(false)
    expect(sameGraphic(photo('a'), photo('a'))).toBe(false)
  })
})

describe('paceGraphicShots', () => {
  it('leaves photos alone and a graphic whose next cut already gives it its hold', () => {
    const input = [
      shot(0, photo('a')),
      { ...shot(4, graphic('g')), cueEndWord: 9 },
      shot(holdWord(9), photo('b')),
    ]
    const { shots, report } = paceGraphicShots(input, words, END_MS)
    expect(shots).toEqual(input)
    expect(report).toEqual({ merged: 0, held: 0, dropped: 0, moved: 0 })
  })

  it('holds after the last word before the planned cut when no cue end is stored', () => {
    const input = [shot(4, graphic('g')), shot(10, photo('b')), shot(80, photo('c'))]
    const { shots } = paceGraphicShots(input, words, END_MS)
    expect(shots[0]!.cueEndWord).toBe(9)
    expect(shots[1]!.startWord).toBe(holdWord(9))
  })

  it('moves a cut that comes before the graphic has landed and been held', () => {
    // The graphic's cues are words 4 to 9; the planner cut at word 10, far too soon.
    const input = [
      shot(0, photo('a')),
      shot(4, graphic('g')),
      shot(10, photo('b')),
      shot(40, photo('c')),
    ]
    const { shots, report } = paceGraphicShots(input, words, END_MS)
    expect(shots[1]!.cueEndWord).toBe(9)
    expect(shots[2]!.startWord).toBe(holdWord(9))
    expect(words[shots[2]!.startWord]!.startMs).toBeGreaterThanOrEqual(
      9 * WORD_MS + R.graphicSettleMs + R.graphicHoldMs,
    )
    expect(report).toEqual({ merged: 0, held: 1, dropped: 0, moved: 1 })
  })

  it('drops a shot that would be left shorter than the rule book minimum', () => {
    const cut = holdWord(9)
    // Photo b starts inside the hold and photo c starts one word after it ends.
    const input = [shot(4, graphic('g')), shot(10, photo('b')), shot(cut + 1, photo('c'))]
    const { shots, report } = paceGraphicShots(input, words, END_MS)
    expect(shots.map((s) => s.startWord)).toEqual([4, cut + 1])
    expect(report).toEqual({ merged: 0, held: 1, dropped: 1, moved: 0 })
  })

  it('joins back-to-back shots of one graphic, so its entrance plays once', () => {
    const input = [
      shot(0, photo('a')),
      shot(4, graphic('g')),
      shot(10, { ...graphic('g'), motion: { kind: 'punch', scale: 1.15, durationMs: 250 } }),
      shot(30, photo('b')),
    ]
    const { shots, report } = paceGraphicShots(input, words, END_MS)
    expect(shots).toHaveLength(3)
    // Both shots' words are cues: the joined graphic runs to the next picture.
    expect(shots[1]!.cueEndWord).toBe(29)
    expect(report.merged).toBe(1)
  })

  it('takes the same graphic back when it comes again inside the hold', () => {
    const input = [
      shot(4, graphic('g')),
      shot(10, photo('b')),
      shot(12, graphic('g')),
      shot(60, photo('c')),
    ]
    const { shots, report } = paceGraphicShots(input, words, END_MS)
    expect(shots.map((s) => s.startWord)).toEqual([4, holdWord(59)])
    expect(shots[0]!.cueEndWord).toBe(59)
    expect(report.merged).toBe(1)
  })

  it('joins the same graphic when a dropped shot was all that stood between them', () => {
    const cut = holdWord(9)
    // Photo b starts in the hold and is too short to keep; the graphic comes back two words after the hold.
    const input = [
      shot(4, graphic('g')),
      shot(10, photo('b')),
      shot(cut + 2, graphic('g')),
      shot(70, photo('c')),
    ]
    const { shots, report } = paceGraphicShots(input, words, END_MS)
    expect(shots.map((s) => s.startWord)).toEqual([4, holdWord(69)])
    expect(shots[0]!.cueEndWord).toBe(69)
    expect(report.merged).toBe(1)
  })

  it('gives a long graphic its whole hold: a graphic has no longest time', () => {
    // Cues end at word 40 (14.9 s); the hold after it is given whole.
    const input = [shot(0, graphic('g')), shot(41, photo('b')), shot(100, photo('c'))]
    const { shots } = paceGraphicShots(input, words, END_MS)
    expect(shots[1]!.startWord).toBe(holdWord(40))
  })

  it('changes nothing when run on its own output', () => {
    const input = [
      shot(0, graphic('h')),
      shot(3, photo('a')),
      shot(8, graphic('g')),
      shot(11, graphic('g')),
      shot(14, photo('b')),
      shot(18, graphic('k')),
      shot(20, photo('c')),
      shot(70, photo('d')),
    ]
    const once = paceGraphicShots(input, words, END_MS).shots
    const twice = paceGraphicShots(once, words, END_MS)
    expect(twice.shots).toEqual(once)
    expect(twice.report).toEqual({ merged: 0, held: 0, dropped: 0, moved: 0 })
  })

  it('does not change its input', () => {
    const input = [shot(4, graphic('g')), shot(10, photo('b')), shot(40, photo('c'))]
    const before = JSON.stringify(input)
    paceGraphicShots(input, words, END_MS)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('graphicCueWords', () => {
  it('times the cue words from the shot’s start, earlier appearances first at 0', () => {
    expect(
      graphicCueWords({
        words,
        firstWord: 10,
        cueEndWord: 12,
        startMs: 10 * WORD_MS,
        earlier: ['w3'],
      }),
    ).toEqual([
      { text: 'w3', atMs: 0 },
      { text: 'w10', atMs: 0 },
      { text: 'w11', atMs: WORD_MS },
      { text: 'w12', atMs: 2 * WORD_MS },
    ])
  })
})

describe('pointGraphicWindow (decision 476)', () => {
  const plan = [shot(0, photo('a')), shot(10, graphic('g')), shot(30, photo('b'))]

  it('spans the shot and cues to the word before the next shot, planned no longer than the shot', () => {
    // The last cue's settle would run past the cut, so the plan ends with the shot.
    expect(pointGraphicWindow(plan, 1, words, END_MS)).toEqual({
      startMs: 10 * WORD_MS,
      endMs: 30 * WORD_MS,
      firstWord: 10,
      cueEndWord: 29,
      plannedMs: 20 * WORD_MS,
    })
  })

  it('ends the plan at its stored last cue, and the first shot starts at word 0', () => {
    const paced = [{ ...shot(4, graphic('g')), cueEndWord: 8 }, shot(30, photo('b'))]
    expect(pointGraphicWindow(paced, 0, words, END_MS)).toMatchObject({
      startMs: 0,
      firstWord: 0,
      cueEndWord: 8,
      plannedMs: 8 * WORD_MS + R.graphicSettleMs,
    })
  })

  it('never plans past the shot, nor cues past the narration for the last shot', () => {
    const last = [shot(0, photo('a')), { ...shot(138, graphic('g')), cueEndWord: 500 }]
    const window = pointGraphicWindow(last, 1, words, END_MS)
    expect(window.cueEndWord).toBe(139)
    expect(window.endMs).toBe(END_MS)
    expect(window.plannedMs).toBe(END_MS - 138 * WORD_MS)
  })

  it('is the window the compile times the code on', () => {
    const input = pointFixtureInput()
    input.shots[5] = { ...input.shots[5]!, slot: graphic('Cash pile') }
    const timeline = compileShortMaster(input)
    const at = timeline.slots.findIndex((s) => s.payload.kind === 'graphic-code')
    const slot = timeline.slots[at]!
    if (slot.payload.kind !== 'graphic-code') throw new Error('not a graphic')
    // The compile paces the plan first; the window is read on the paced shots.
    const { words: said, narrationEndMs } = layoutPointNarration(input.paragraphs)
    const paced = pacePointShots(input.shots, said, narrationEndMs).shots
    const window = pointGraphicWindow(paced, at, said, narrationEndMs)
    expect(slot.startMs).toBe(window.startMs)
    expect(slot.startMs + slot.durationMs).toBe(window.endMs)
    expect(slot.payload.durationMs).toBe(window.plannedMs)
    expect(slot.payload.words).toHaveLength(window.cueEndWord - window.firstWord + 1)
  })
})

describe('compileShortMaster with a designed graphic', () => {
  function withGraphic() {
    const input = pointFixtureInput()
    // Shot 5 becomes a graphic the planner cut short and then showed again.
    const g = graphic('Cash pile')
    input.shots[5] = { ...input.shots[5]!, slot: g, motion: 'static' }
    input.shots[6] = { ...input.shots[6]!, slot: g, motion: 'punch' }
    return input
  }

  it('plays the graphic once, on the Short’s words, then holds its ending', () => {
    const input = withGraphic()
    const timeline = compileShortMaster(input)
    expect(TimelineSchema.safeParse(timeline).success).toBe(true)
    const shown = timeline.slots.filter((slot) => slot.payload.kind === 'graphic-code')
    expect(shown).toHaveLength(1)
    const slot = shown[0]!
    if (slot.payload.kind !== 'graphic-code') throw new Error('not a graphic')
    // Its first cue is the Short's word at the shot's start, at 0 ms.
    const first = timeline.captions.words.find((word) => word.startMs === slot.startMs)!
    expect(slot.payload.words[0]).toEqual({ text: first.text, atMs: 0 })
    expect(slot.payload.words.some((word) => word.text === 'long-form')).toBe(false)
    // Its planned length ends when its last cue has landed, as the long form's
    // ends near its last word: the code's own closing beats land there, and the
    // shot holds the finished graphic after it.
    const lastCue = slot.payload.words.at(-1)!
    expect(slot.payload.durationMs).toBe(lastCue.atMs + R.graphicSettleMs)
    expect(slot.durationMs - slot.payload.durationMs).toBeGreaterThanOrEqual(R.graphicHoldMs)
  })

  it('reports no length finding for a long graphic', () => {
    const input = pointFixtureInput()
    const g = graphic('Long graphic')
    // Shots 5 to 9 all show it: one graphic over about seventeen seconds of words.
    for (let at = 5; at <= 9; at += 1) input.shots[at] = { ...input.shots[at]!, slot: g }
    const timeline = compileShortMaster(input)
    const shown = timeline.slots.find((slot) => slot.payload.kind === 'graphic-code')!
    expect(shown.durationMs).toBeGreaterThan(15_000)
    const findings = checkShortRules({ timeline, paragraphs: input.paragraphs, newImageCount: 0 })
    expect(findings.filter((finding) => finding.rule === 'shot-length')).toEqual([])
  })

  it('is measured against the graphic limit, not the picture limit', () => {
    const input = withGraphic()
    const timeline = compileShortMaster(input)
    const findings = checkShortRules({
      timeline,
      paragraphs: input.paragraphs,
      newImageCount: 0,
    })
    expect(findings.filter((finding) => finding.rule === 'shot-length')).toEqual([])
  })
})
