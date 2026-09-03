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
})
