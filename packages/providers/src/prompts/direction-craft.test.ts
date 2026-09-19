import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BANNED_PROMPT_WORDS, DIRECTION_CRAFT } from './direction-craft'

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
  })
})
