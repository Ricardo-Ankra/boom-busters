import { describe, expect, it } from 'vitest'
import { compileTimeline } from './compile'
import { goldenInput } from './compile.test'
import { swapMusicBed } from './music'

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
