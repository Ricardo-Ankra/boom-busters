import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRAPHIC_CODE_FIXTURE_SOURCE } from './graphic-code-fixture'

/**
 * The fixture text lives in two places, here and in compositions
 * (`GRAPHIC_CODE_SOURCE`), because providers may not depend on compositions
 * (ruling 10: this is the one text, and compositions holds a copy). Both hold
 * it as a template literal with no backslash, backtick or `${`, so the text
 * between the backticks on disk is the value.
 */
const COMPOSITIONS_FIXTURE = new URL(
  '../../../compositions/src/fixtures/graphic-code.ts',
  import.meta.url,
)

describe('GRAPHIC_CODE_FIXTURE_SOURCE (decision 295)', () => {
  it('is the compositions fixture, character for character', () => {
    const file = readFileSync(COMPOSITIONS_FIXTURE, 'utf8')
    const theirs = /GRAPHIC_CODE_SOURCE(?:: string)? = `([^`]*)`/.exec(file)?.[1]
    expect(theirs).toBe(GRAPHIC_CODE_FIXTURE_SOURCE)
  })

  it('is plain JavaScript a template literal holds verbatim', () => {
    expect(GRAPHIC_CODE_FIXTURE_SOURCE).not.toMatch(/[`\\]|\$\{/)
    expect(GRAPHIC_CODE_FIXTURE_SOURCE).toMatch(/^function Graphic\(props\) \{$/m)
    expect(GRAPHIC_CODE_FIXTURE_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|<[a-zA-Z]/)
  })
})
