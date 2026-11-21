import { SHORT_RULES } from '@boom-busters/schemas'
import type { TimelineSlot } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import type { PaceableShot } from './point-graphics'
import { pacePictureShots, pacePointShots, PHRASE_SNAP_WORDS } from './point-pictures'

const R = SHORT_RULES
/** An even word clock: word i starts at i * 400 ms, so 2.5 s is about six words. */
const WORD_MS = 400
/** Every fifth word ends a clause, so words 0, 5, 10, ... open a phrase. */
const words = Array.from({ length: 120 }, (_, i) => ({
  text: i % 5 === 4 ? `w${i},` : `w${i}`,
  startMs: i * WORD_MS,
}))
const END_MS = 120 * WORD_MS

function photo(name: string): TimelineSlot {
  return {
    type: 'still',
    startMs: 0,
    durationMs: 3_000,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: { kind: 'image', src: { r2Key: `stills/${name}.png` } },
  }
}

function graphic(title: string): TimelineSlot {
  return {
    type: 'chart',
    startMs: 0,
    durationMs: 9_000,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: {
      kind: 'graphic-code',
      version: 1,
      compiled: `/* ${title} */`,
      title,
      words: [],
      durationMs: 9_000,
      logos: {},
      claimIds: [],
    },
  }
}

const shot = (startWord: number, slot: TimelineSlot): PaceableShot => ({ startWord, slot })
const starts = (shots: readonly PaceableShot[]) => shots.map((s) => s.startWord)

describe('pacePictureShots', () => {
  it('leaves pictures that start on a phrase and run long enough', () => {
    const input = [shot(0, photo('a')), shot(10, photo('b')), shot(20, photo('c'))]
    const { shots, report } = pacePictureShots(input, words, END_MS)
    expect(shots).toEqual(input)
    expect(report).toEqual({ snapped: 0, folded: 0 })
  })

  it('moves a cut made mid-phrase to the nearest phrase start', () => {
    // Word 11 is one past a phrase start (10); word 14 is one before the next (15).
    const input = [shot(0, photo('a')), shot(11, photo('b')), shot(24, photo('c'))]
    const { shots, report } = pacePictureShots(input, words, END_MS)
    expect(starts(shots)).toEqual([0, 10, 25])
    expect(report.snapped).toBe(2)
  })

  it('takes the later phrase start on a tie', () => {
    // Only words 15 and 19 open phrases near 17, both two words away.
    const tie = words.map((w, i) =>
      i === 14 || i === 18 ? { ...w, text: `w${i},` } : { ...w, text: `w${i}` },
    )
    const input = [shot(0, photo('a')), shot(17, photo('b')), shot(40, photo('c'))]
    const { shots } = pacePictureShots(input, tie, END_MS)
    expect(shots[1]!.startWord).toBe(19)
    expect(PHRASE_SNAP_WORDS).toBe(3)
  })

  it('keeps a cut where it is when no phrase starts near it', () => {
    const flat = words.map((w, i) => ({ ...w, text: `w${i}` }))
    const input = [shot(0, photo('a')), shot(12, photo('b')), shot(30, photo('c'))]
    const { shots, report } = pacePictureShots(input, flat, END_MS)
    expect(starts(shots)).toEqual([0, 12, 30])
    expect(report.snapped).toBe(0)
  })

  it('never moves a picture earlier into the graphic before it', () => {
    // After a graphic, word 22 may only move later: to 25, never back to 20.
    const input = [shot(0, graphic('g')), shot(22, photo('b')), shot(40, photo('c'))]
    const { shots } = pacePictureShots(input, words, END_MS)
    expect(shots[1]!.startWord).toBe(25)
  })

  it('folds a picture shorter than the least into the shot before it', () => {
    // Picture b runs words 10 to 14, 2 s: under 2.5 s.
    const input = [shot(0, photo('a')), shot(10, photo('b')), shot(15, photo('c'))]
    const { shots, report } = pacePictureShots(input, words, END_MS)
    expect(starts(shots)).toEqual([0, 15])
    expect(shots.map((s) => s.slot)).toEqual([photo('a'), photo('c')])
    expect(report.folded).toBe(1)
  })

  it('lets a graphic run on over a short picture after it', () => {
    const input = [shot(0, graphic('g')), shot(20, photo('b')), shot(25, photo('c'))]
    const { shots } = pacePictureShots(input, words, END_MS)
    expect(starts(shots)).toEqual([0, 25])
  })

  it('folds the picture after a short first picture into it', () => {
    const input = [shot(0, photo('a')), shot(5, photo('b')), shot(20, photo('c'))]
    const { shots } = pacePictureShots(input, words, END_MS)
    expect(shots.map((s) => s.slot)).toEqual([photo('a'), photo('c')])
    expect(starts(shots)).toEqual([0, 20])
  })

  it('folds a short last picture', () => {
    const input = [shot(0, photo('a')), shot(115, photo('z'))]
    const { shots } = pacePictureShots(input, words, END_MS)
    expect(starts(shots)).toEqual([0])
  })

  it('leaves every picture at least the least long, the last included', () => {
    const input = [0, 3, 7, 9, 13, 18, 21, 26, 29, 33, 41, 44, 52, 56, 60, 61, 70].map((w, i) =>
      shot(w, photo(`p${i}`)),
    )
    const { shots } = pacePictureShots(input, words, END_MS)
    const startMs = (s: PaceableShot, i: number) => (i === 0 ? 0 : words[s.startWord]!.startMs)
    shots.forEach((s, i) => {
      const endMs = i + 1 < shots.length ? startMs(shots[i + 1]!, i + 1) : END_MS
      expect(endMs - startMs(s, i)).toBeGreaterThanOrEqual(R.shotMinMs)
    })
  })

  it('does not change its input', () => {
    const input = [shot(0, photo('a')), shot(11, photo('b')), shot(15, photo('c'))]
    const before = JSON.stringify(input)
    pacePictureShots(input, words, END_MS)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('pacePointShots', () => {
  it('joins a graphic whose two shots a folded picture stood between', () => {
    // The graphic's cues end at word 9; the hold ends by word 16, where photo b
    // starts. Photo b runs two words, so it folds, and the graphic comes next.
    const input = [
      { ...shot(0, graphic('g')), cueEndWord: 9 },
      shot(16, photo('b')),
      shot(18, graphic('g')),
      shot(60, photo('c')),
    ]
    const { shots, report } = pacePointShots(input, words, END_MS)
    expect(shots.map((s) => s.slot?.payload.kind)).toEqual(['graphic-code', 'image'])
    expect(report.folded).toBeGreaterThanOrEqual(1)
    expect(report.merged).toBeGreaterThanOrEqual(1)
  })

  it('changes nothing when run on its own output', () => {
    const input = [
      shot(0, photo('a')),
      shot(4, photo('b')),
      shot(11, graphic('g')),
      shot(17, photo('c')),
      shot(19, photo('d')),
      shot(23, graphic('h')),
      shot(31, photo('e')),
      shot(33, photo('f')),
      shot(47, photo('g')),
      shot(118, photo('h')),
    ]
    const once = pacePointShots(input, words, END_MS).shots
    const twice = pacePointShots(once, words, END_MS)
    expect(twice.shots).toEqual(once)
    expect(twice.report).toEqual({
      merged: 0,
      held: 0,
      dropped: 0,
      moved: 0,
      snapped: 0,
      folded: 0,
    })
  })
})
