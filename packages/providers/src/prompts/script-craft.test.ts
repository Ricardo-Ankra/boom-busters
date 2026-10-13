import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SCRIPT_CRAFT } from './script-craft'

describe('SCRIPT_CRAFT', () => {
  it('is byte-identical to script-craft.md, the human-editable source', () => {
    const markdown = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'script-craft.md'),
      'utf8',
    )
    // Editing the markdown without re-embedding it here must fail CI —
    // otherwise the prompt that ships is silently the stale one. Line
    // endings are normalised so a CRLF checkout cannot fake a drift.
    expect(SCRIPT_CRAFT.replace(/\r\n/g, '\n')).toBe(markdown.replace(/\r\n/g, '\n'))
  })

  it('never overrides the hard rules, in its own words', () => {
    expect(SCRIPT_CRAFT).toContain('claim list does not')
    expect(SCRIPT_CRAFT).toContain('legal hedges are never sacrificed')
  })

  /**
   * Decision 296: the Stability script told its cold open twice, re-explained
   * the paper in three chapters and opened chapter four on chapter three's
   * ending. The craft file now says, in so many words, what a callback is and
   * that a recap is never written, where a fact lives, and what the return to
   * the opening may say.
   */
  it('teaches callbacks, one home per fact, and the return to the cold open', () => {
    expect(SCRIPT_CRAFT).toContain('## One home per fact')
    expect(SCRIPT_CRAFT).toContain('## Callbacks, not recaps')
    expect(SCRIPT_CRAFT).toContain('The opening is never told twice.')
    expect(SCRIPT_CRAFT).toContain('Never open a chapter by restating the previous chapter')
    expect(SCRIPT_CRAFT).toContain('revealed in exactly one chapter')
    expect(SCRIPT_CRAFT).toContain('40 to 60 per cent of the runtime')
  })
})
