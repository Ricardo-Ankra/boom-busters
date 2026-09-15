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
    expect(DIRECTION_CRAFT).toContain('Never in an invented act')
    expect(DIRECTION_CRAFT).toContain('no caricature')
    for (const word of BANNED_PROMPT_WORDS) expect(DIRECTION_CRAFT).toContain(word)
  })

  it('never asks the renderer for a pan it cannot do', () => {
    expect(DIRECTION_CRAFT).toContain('Never plan a pan')
  })

  it('carries no dashes the house style forbids', () => {
    expect(DIRECTION_CRAFT).not.toMatch(/[\u2013\u2014]/)
  })
})
