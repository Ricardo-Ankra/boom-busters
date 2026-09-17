import { describe, expect, it } from 'vitest'
import type { Caption } from '@boom-busters/schemas'
import { anchorSlots } from './anchor'

/**
 * One paragraph of narration, one word every 500ms, so a word's index is its
 * position on the clock: word 6 starts at 3000ms.
 */
const SCRIPT =
  'The board met on a Friday. Prem Akkaraju had already agreed terms. ' +
  'Nobody in the room said so out loud.'

function spokenWords(text: string, fromMs = 0, stepMs = 500): Caption[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => ({
      text: word,
      startMs: fromMs + index * stepMs,
      endMs: fromMs + (index + 1) * stepMs,
      timestampMs: null,
      confidence: null,
    }))
}

const words = spokenWords(SCRIPT)
const spans = [{ startMs: 0, endMs: words.length * 500 }]

describe('anchorSlots', () => {
  it('moves a shot onto the first word of the text it covers', () => {
    // The planner gave the opening shot 6 seconds; the narration spends 3 on
    // it, so the second shot was landing three seconds after its own name.
    const anchored = anchorSlots(
      [
        { startMs: 0, durationMs: 6000, coversText: 'The board met on a Friday.' },
        { startMs: 6000, durationMs: 6000, coversText: 'Prem Akkaraju had already agreed terms.' },
      ],
      words,
      spans,
    )
    expect(anchored[0]!.startMs).toBe(0)
    // "Prem" is the seventh word: six words of 500ms before it.
    expect(anchored[1]!.startMs).toBe(3000)
  })

  it('matches through punctuation, case and a performance tag', () => {
    const anchored = anchorSlots(
      [{ startMs: 9000, durationMs: 4000, coversText: '[pause] prem akkaraju had already agreed' }],
      words,
      spans,
    )
    expect(anchored[0]!.startMs).toBe(3000)
  })

  it('falls back to the opening words when the quote was not copied exactly', () => {
    const anchored = anchorSlots(
      [
        {
          startMs: 9000,
          durationMs: 4000,
          coversText: 'Prem Akkaraju had, by then, already agreed terms with the board.',
        },
      ],
      words,
      spans,
    )
    expect(anchored[0]!.startMs).toBe(3000)
  })

  it('leaves a slot where it was planned when the quote is not there at all', () => {
    const anchored = anchorSlots(
      [{ startMs: 7000, durationMs: 4000, coversText: 'A sentence from a different film.' }],
      words,
      spans,
    )
    expect(anchored[0]!.startMs).toBe(7000)
  })

  it('leaves a slot alone when it has no quote', () => {
    const anchored = anchorSlots([{ startMs: 7000, durationMs: 4000 }], words, spans)
    expect(anchored[0]!.startMs).toBe(7000)
  })

  it('never pulls a shot behind the one before it, even on a repeated line', () => {
    const repeated = spokenWords('Nobody said so. The money was gone. Nobody said so.')
    const anchored = anchorSlots(
      [
        { startMs: 0, durationMs: 3000, coversText: 'Nobody said so.' },
        { startMs: 3000, durationMs: 3000, coversText: 'The money was gone.' },
        { startMs: 6000, durationMs: 3000, coversText: 'Nobody said so.' },
      ],
      repeated,
      [{ startMs: 0, endMs: repeated.length * 500 }],
    )
    // The third slot takes the SECOND occurrence: the first is behind it.
    expect(anchored.map((slot) => slot.startMs)).toEqual([0, 1500, 3500])
  })

  it('searches only inside the slot’s own paragraph', () => {
    // The same sentence opens both paragraphs; a slot planned into the second
    // must not be dragged back into the first.
    const two = [...spokenWords('It happened again.'), ...spokenWords('It happened again.', 5000)]
    const anchored = anchorSlots(
      [{ startMs: 5000, durationMs: 2000, coversText: 'It happened again.' }],
      two,
      [
        { startMs: 0, endMs: 5000 },
        { startMs: 5000, endMs: 6500 },
      ],
    )
    expect(anchored[0]!.startMs).toBe(5000)
  })

  it('keeps every planned start when the narration was never timed', () => {
    const planned = [{ startMs: 4000, durationMs: 4000, coversText: 'The board met on a Friday.' }]
    expect(anchorSlots(planned, [], spans)).toEqual(planned)
  })
})
