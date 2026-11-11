import { describe, expect, it } from 'vitest'
import { CHAPTER_OVERLAP_MS, compileTimeline } from './compile'
import { CHAPTER_TWO, goldenInput, threeChapterInput } from './compile.test'
import { chapterCuePoints, swapMusicBed } from './music'

describe('swapMusicBed', () => {
  it('swaps the bed and keeps the curve — the curve is a function of the narration', () => {
    const original = compileTimeline(goldenInput())
    expect(original.music).not.toBeNull()

    const swapped = swapMusicBed(original, { r2Key: 'boom-busters/music/other.mp3' })
    expect(swapped.music?.r2Key).toBe('boom-busters/music/other.mp3')
    expect(swapped.music?.duckingCurve).toEqual(original.music?.duckingCurve)
    expect(swapped.music?.cuePoints).toEqual(original.music?.cuePoints)
    // Everything that is not the music is untouched.
    expect(swapped.narration).toEqual(original.narration)
    expect(swapped.slots).toEqual(original.slots)
  })

  it('carries the bed’s own length, which is what lets the loop overlap', () => {
    const original = compileTimeline(goldenInput())
    const swapped = swapMusicBed(original, {
      r2Key: 'boom-busters/music/other.mp3',
      durationMs: 183_000,
    })
    expect(swapped.music?.durationMs).toBe(183_000)
    // A bed the library never measured leaves the field off rather than
    // inventing a length: the renderer falls back to a plain loop.
    const unmeasured = swapMusicBed(original, { r2Key: 'boom-busters/music/old.mp3' })
    expect(unmeasured.music?.durationMs).toBeUndefined()
  })

  it('builds a correct curve for a timeline first compiled with NO music', () => {
    const silent = compileTimeline({ ...goldenInput(), music: null })
    expect(silent.music).toBeNull()

    const withBed = swapMusicBed(silent, { r2Key: 'boom-busters/music/late.mp3' })
    const reference = compileTimeline({
      ...goldenInput(),
      music: { r2Key: 'boom-busters/music/late.mp3' },
    })
    // Same curve and cue points the compiler itself would have produced.
    expect(withBed.music).toEqual(reference.music)
  })

  it('removes the bed entirely when handed null', () => {
    const original = compileTimeline(goldenInput())
    expect(swapMusicBed(original, null).music).toBeNull()
  })

  it('never mutates the timeline it was handed', () => {
    const original = compileTimeline(goldenInput())
    const before = JSON.stringify(original)
    swapMusicBed(original, { r2Key: 'boom-busters/music/other.mp3' })
    swapMusicBed(original, null)
    expect(JSON.stringify(original)).toBe(before)
  })
})

describe('chapterCuePoints', () => {
  it('equals what the compiler wrote, in every mode', () => {
    for (const chapterMarking of ['cards', 'title', 'none'] as const) {
      const timeline = compileTimeline(threeChapterInput({ chapterMarking }))
      expect(chapterCuePoints(timeline)).toEqual(timeline.music?.cuePoints)
    }
  })

  it('a timeline without a chapters list keeps the old rule: every card, else every first word', () => {
    const compiled = compileTimeline(goldenInput())
    const { chapters: _c, ...legacy } = compiled
    const withCards = {
      ...legacy,
      overlays: [
        {
          kind: 'chapterCard' as const,
          startMs: 0,
          durationMs: 3200,
          props: { index: 1, title: 'The audit' },
        },
        ...legacy.overlays,
      ],
    }
    expect(chapterCuePoints(withCards).map((c) => c.tMs)).toEqual([0, 15_500])
    const cardless = { ...legacy, overlays: [] }
    expect(chapterCuePoints(cardless).map((c) => c.tMs)).toEqual([0, 18_250])
  })

  it('swapMusicBed on a none-mode timeline compiled without a bed lands the cue at the lead point', () => {
    const silent = compileTimeline({ ...goldenInput(), chapterMarking: 'none', music: null })
    const swapped = swapMusicBed(silent, { r2Key: 'boom-busters/music/other.mp3' })
    expect(swapped.music?.cuePoints.map((c) => c.tMs)).toEqual([0, 15_500])
  })

  it('finds a card by when it resumes, not by the source chapter index', () => {
    const input = goldenInput()
    const timeline = compileTimeline({
      ...input,
      chapterMarking: 'cards',
      paragraphs: input.paragraphs.map((p) =>
        p.chapterIndex === 1 ? { ...p, chapterIndex: 5 } : p,
      ),
    })
    const card = timeline.overlays.find((o) => o.kind === 'chapterCard')
    expect(card?.kind === 'chapterCard' && card.props.index).toBe(6)
    expect(chapterCuePoints(timeline).map((c) => c.tMs)).toEqual([0, 15_500])
    expect(chapterCuePoints(timeline).map((c) => c.tMs)).toEqual(
      timeline.music?.cuePoints.map((c) => c.tMs),
    )
  })

  it('cues music at an old 3200 ms card', () => {
    const compiled = compileTimeline(goldenInput())
    const old = {
      ...compiled,
      narration: compiled.narration.map((segment, i) =>
        i === 2 ? { ...segment, startMs: 15_500 + 3200 - CHAPTER_OVERLAP_MS } : segment,
      ),
      overlays: [
        {
          kind: 'chapterCard' as const,
          startMs: 15_500,
          durationMs: 3200,
          props: { index: 2, title: 'The collapse' },
        },
      ],
    }
    expect(chapterCuePoints(old).map((c) => c.tMs)).toEqual([0, 15_500])
  })

  it('cues music at a lengthened card', () => {
    const input = goldenInput()
    input.paragraphs = input.paragraphs.map((p) =>
      p.chapterId === CHAPTER_TWO ? { ...p, chapterTitle: "The Money That Wasn't There" } : p,
    )
    const timeline = compileTimeline(input)
    expect(timeline.overlays[0]!.durationMs).toBe(4400)
    expect(chapterCuePoints(timeline).map((c) => c.tMs)).toEqual([0, 15_500])
    expect(chapterCuePoints(timeline)).toEqual(timeline.music?.cuePoints)
  })
})
