import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BANNED_PROMPT_WORDS,
  DIRECTION_CRAFT,
  stripBannedWords,
  withoutBannedWords,
} from './direction-craft'

describe('DIRECTION_CRAFT', () => {
  it('is byte-identical to direction-craft.md, the human-editable source', () => {
    const markdown = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'direction-craft.md'),
      'utf8',
    )
    // Editing the markdown without re-embedding it here must fail CI, or the
    // prompt that ships is silently the stale one (the decision 216 pattern).
    expect(DIRECTION_CRAFT.replace(/\r\n/g, '\n')).toBe(markdown.replace(/\r\n/g, '\n'))
  })

  it('sits below the hard rules, in its own words', () => {
    expect(DIRECTION_CRAFT).toContain('claim list does not')
    expect(DIRECTION_CRAFT).toContain('legal hedges')
  })

  it('names the people guardrail and the banned words', () => {
    expect(DIRECTION_CRAFT).toContain('shown by likeness, and the')
    expect(DIRECTION_CRAFT).toContain('a specific act the claims do not establish')
    expect(DIRECTION_CRAFT).toContain('never fences a person away from ordinary')
    expect(DIRECTION_CRAFT).toContain('No guardrail text appears')
    expect(DIRECTION_CRAFT).toContain("A real company's own marks belong in frame")
    expect(DIRECTION_CRAFT).toContain('a generated wordmark is a wrong one')
    expect(DIRECTION_CRAFT).toContain('set by the compositor, never by the image model')
    expect(DIRECTION_CRAFT).toContain('by name alone, no role after it')
    expect(DIRECTION_CRAFT).toContain('the person in the reference')
    expect(DIRECTION_CRAFT).toContain('no caricature')
    for (const word of BANNED_PROMPT_WORDS) expect(DIRECTION_CRAFT).toContain(word)
  })

  it('never asks the renderer for a pan it cannot do', () => {
    expect(DIRECTION_CRAFT).toContain('Never plan a pan')
  })

  it('carries no dashes the house style forbids', () => {
    expect(DIRECTION_CRAFT).not.toMatch(/[\u2013\u2014]/)
  })

  it('puts the sentence before the checklist, and caps the motifs (decision 260)', () => {
    expect(DIRECTION_CRAFT).toContain('The sentence decides the frame')
    expect(DIRECTION_CRAFT).toContain('sound off')
    expect(DIRECTION_CRAFT).toContain('each motif at most once per chapter')
    expect(DIRECTION_CRAFT).toContain('one detail drawn from the sentence itself')
    // The clause that put a motif into every still is gone.
    expect(DIRECTION_CRAFT).not.toContain('and one motif from the director')
    // The fallback no longer canonises one picture.
    expect(DIRECTION_CRAFT).not.toContain('(the empty chair,')
    expect(DIRECTION_CRAFT).toContain('A set is a room the film returns to')
    expect(DIRECTION_CRAFT).toContain("the photographs give the room's design")
    expect(DIRECTION_CRAFT).toContain('A room on every slot is a motif on every slot')
  })

  it('moves the camera around a set, and puts people in it rather than on it (decision 273)', () => {
    expect(DIRECTION_CRAFT).toContain(
      'They never give the picture: every still in a set is a new photograph from its own camera position.',
    )
    expect(DIRECTION_CRAFT).toContain('Two stills of the same room never share a camera position.')
    expect(DIRECTION_CRAFT).toContain('A person is photographed in the room, never pasted onto it')
  })

  it('gives anonymous figures and extras realistic, visible faces (decision 273)', () => {
    expect(DIRECTION_CRAFT).toContain(
      'clothing, with natural, realistic faces, visible and in focus.',
    )
    expect(DIRECTION_CRAFT).toContain(
      'A face is never blurred, smeared, hidden or turned away as a device.',
    )
    expect(DIRECTION_CRAFT).not.toContain('face turned away or in shadow')
  })

  it('stages people in place rather than symbols, and drops the motif floor (decision 271)', () => {
    expect(DIRECTION_CRAFT).toContain('The people, in the rooms where it happened')
    expect(DIRECTION_CRAFT).not.toContain('Rooms after the people have left')
    expect(DIRECTION_CRAFT).not.toContain('never the face')
    expect(DIRECTION_CRAFT).toContain('An abstract sentence is staged, not symbolised.')
    expect(DIRECTION_CRAFT).toContain('the principals at the boardroom table')
    expect(DIRECTION_CRAFT).not.toContain('each chapter shows at least one of them')
    expect(DIRECTION_CRAFT).not.toContain('Every chapter shows at least one motif')
    expect(DIRECTION_CRAFT).not.toContain('may stand in for the third fact')
    expect(DIRECTION_CRAFT).toContain("Never copy the era lock's list into a prompt")
    expect(DIRECTION_CRAFT).not.toContain("Append the director's book invariants verbatim")
  })
})

describe('stripBannedWords (decision 271)', () => {
  it('removes a banned word and the comma it leaves behind', () => {
    expect(stripBannedWords('a stunning, cold room')).toBe('a cold room')
    expect(stripBannedWords('a cold, stunning room')).toBe('a cold room')
    expect(stripBannedWords('cold, stunning, quiet room')).toBe('cold, quiet room')
  })

  it('removes phrases, ignoring case', () => {
    expect(stripBannedWords('Dramatic Lighting over a desk, 50mm lens')).toBe(
      'over a desk, 50mm lens',
    )
  })

  it('leaves words that only contain a banned one', () => {
    expect(stripBannedWords('an unprofessional, moodily lit hall')).toBe(
      'an unprofessional, moodily lit hall',
    )
  })

  it('tidies the space a removal leaves before punctuation', () => {
    expect(stripBannedWords('the room, cinematic.')).toBe('the room.')
  })

  it('returns clean text unchanged', () => {
    expect(stripBannedWords('A boardroom at dusk, 35mm lens.')).toBe(
      'A boardroom at dusk, 35mm lens.',
    )
  })
})

describe('withoutBannedWords', () => {
  it('cleans a still prompt and leaves its description alone', () => {
    expect(
      withoutBannedWords({
        type: 'still',
        prompt: 'A cinematic boardroom',
        description: 'A cinematic moment',
      }),
    ).toEqual({ type: 'still', prompt: 'A boardroom', description: 'A cinematic moment' })
  })

  it('returns the same object when there is nothing to clean or no prompt', () => {
    const stock = { type: 'stock', query: 'cinematic office' }
    expect(withoutBannedWords(stock)).toBe(stock)
    const clean = { type: 'still', prompt: 'A boardroom' }
    expect(withoutBannedWords(clean)).toBe(clean)
  })
})
