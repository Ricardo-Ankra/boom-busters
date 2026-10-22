import { describe, expect, it } from 'vitest'
import { tenKSections } from './extract-tenk'
import { fixture } from './test-fixtures'

describe('tenKSections', () => {
  it('cuts a 10-K to items 1 and 7 after the table of contents', () => {
    const out = tenKSections(fixture('tenk.txt'))
    expect(out).toContain('We operate')
    expect(out).toContain('Results of operations')
    expect(out).not.toContain('Risk factors body')
    expect(out).not.toContain('Statements go here')
    expect(out).not.toContain('TABLE OF CONTENTS')
  })

  it('falls back to the opening of the text when no heading matches', () => {
    expect(tenKSections('nothing to see')).toBe('nothing to see')
  })
})
